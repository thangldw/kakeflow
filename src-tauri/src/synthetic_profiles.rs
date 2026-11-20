//! Synthetic household profiles for regression testing at realistic scale.
//!
//! Each profile generates two years of deterministic, varied activity (salary or irregular income, many
//! small expenses, card purchases, refunds, transfers, drafts and voids, receipts on a share of purchases)
//! straight into the real migrated schema. An independent in-memory model of the same data is the oracle:
//! the ledger audit, the category history and the evidence summary must agree with it exactly. Nothing here is
//! real data, and the generator uses a fixed seed so any failure reproduces.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};

use crate::category_history::category_history;
use crate::data_confidence::{confidence_for_month, missing_receipts};
use crate::ledger_audit::audit_household;
use crate::persistence::AppState;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }
}

const CATEGORIES: [(&str, &str); 8] = [
    ("food", "食費"),
    ("rent", "住居費"),
    ("util", "水道光熱費"),
    ("fun", "娯楽"),
    ("transport", "交通費"),
    ("health", "医療費"),
    ("edu", "教育費"),
    ("misc", "雑費"),
];

struct Profile {
    name: &'static str,
    household: &'static str,
    seed: u64,
    expenses_per_month: u64,
    card_share_percent: u64,
    receipt_share_percent: u64,
    refund_every: u64,
    irregular_income: bool,
    drafts_and_voids: bool,
}

const PROFILES: [Profile; 3] = [
    Profile {
        name: "single",
        household: "p-single",
        seed: 11,
        expenses_per_month: 35,
        card_share_percent: 40,
        receipt_share_percent: 25,
        refund_every: 40,
        irregular_income: false,
        drafts_and_voids: false,
    },
    Profile {
        name: "family",
        household: "p-family",
        seed: 22,
        expenses_per_month: 110,
        card_share_percent: 60,
        receipt_share_percent: 35,
        refund_every: 25,
        irregular_income: false,
        drafts_and_voids: true,
    },
    Profile {
        name: "freelancer",
        household: "p-free",
        seed: 33,
        expenses_per_month: 70,
        card_share_percent: 30,
        receipt_share_percent: 60,
        refund_every: 60,
        irregular_income: true,
        drafts_and_voids: true,
    },
];

/// What the generator put in, kept in memory as the independent oracle.
#[derive(Default)]
struct Oracle {
    /// (month, category id) -> net amount of posted, calculation-target activity on expense accounts.
    category: BTreeMap<(String, &'static str), i64>,
    /// month -> yen of posted EXPENSE / CARD_PURCHASE / FEE spending.
    spending: BTreeMap<String, i64>,
    /// month -> yen of that spending with a receipt/scan linked.
    documented: BTreeMap<String, i64>,
    /// month -> (transaction id, amount, has_document) of that spending.
    items: BTreeMap<String, Vec<(String, i64, bool)>>,
    posted: u64,
}

fn month_of(index: u64) -> String {
    // Twenty-four months ending 2026-11.
    let total = 2024 * 12 + 11 + index;
    format!("{:04}-{:02}", total / 12, total % 12 + 1)
}

fn generate(connection: &Connection, profile: &Profile) -> Oracle {
    let mut rng = Rng(profile.seed);
    let mut oracle = Oracle::default();
    let household = profile.household;
    connection
        .execute(
            "INSERT INTO households(id,name) VALUES(?1,?2)",
            params![household, profile.name],
        )
        .unwrap();
    let account = |suffix: &str| format!("{household}-{suffix}");
    for (suffix, name, kind, subtype) in [
        ("bank", "銀行", "ASSET", "BANK"),
        ("bank2", "貯蓄", "ASSET", "BANK"),
        ("cash", "現金", "ASSET", "CASH"),
        ("card", "カード", "LIABILITY", "CREDIT_CARD"),
        ("salary", "収入", "INCOME", "OTHER"),
    ] {
        connection
            .execute(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES(?1,?2,?3,?4,?5)",
                params![account(suffix), household, name, kind, subtype],
            )
            .unwrap();
    }
    for (id, name) in CATEGORIES {
        connection
            .execute(
                "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES(?1,?2,?3,'EXPENSE','OTHER')",
                params![format!("{household}-{id}"), household, name],
            )
            .unwrap();
    }
    connection
        .execute(
            "INSERT INTO import_runs(id,household_id,adapter_id,status) VALUES(?1,?2,'synthetic','POSTED')",
            params![format!("{household}-run"), household],
        )
        .unwrap();

    let mut counter = 0_u64;
    let mut insert = |kind: &str,
                      date: &str,
                      status: &str,
                      target: i64,
                      lines: &[(&str, &str, i64)]|
     -> String {
        counter += 1;
        let id = format!("{household}-t{counter}");
        connection
            .execute(
                "INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status,calculation_target) VALUES(?1,?2,?3,?4,?5,?6)",
                params![id, household, date, kind, status, target],
            )
            .unwrap();
        for (line, (account_id, side, amount)) in lines.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number) VALUES(?1,?2,?3,?4,?5,?6)",
                    params![format!("{id}-j{line}"), id, account_id, side, amount, line as i64 + 1],
                )
                .unwrap();
        }
        id
    };

    connection.execute_batch("BEGIN").unwrap();
    let mut docs = 0_u64;
    for index in 0..24 {
        let month = month_of(index);
        let day = |rng: &mut Rng| format!("{month}-{:02}", rng.below(28) + 1);

        // Income: a salary, or a few irregular invoices.
        let incomes: Vec<i64> = if profile.irregular_income {
            (0..rng.below(4) + 1)
                .map(|_| 80_000 + rng.below(400_000) as i64)
                .collect()
        } else {
            vec![280_000 + (index as i64 % 5) * 1_000]
        };
        for amount in incomes {
            insert(
                "INCOME",
                &format!("{month}-25"),
                "POSTED",
                1,
                &[
                    (&account("bank"), "DEBIT", amount),
                    (&account("salary"), "CREDIT", amount),
                ],
            );
            oracle.posted += 1;
        }
        // A transfer to savings (excluded from calculations).
        insert(
            "TRANSFER",
            &format!("{month}-26"),
            "POSTED",
            0,
            &[
                (&account("bank2"), "DEBIT", 20_000),
                (&account("bank"), "CREDIT", 20_000),
            ],
        );
        oracle.posted += 1;

        for n in 0..profile.expenses_per_month {
            let (category, _) = CATEGORIES[rng.below(CATEGORIES.len() as u64) as usize];
            let amount = 100 + rng.below(if category == "rent" { 90_000 } else { 12_000 }) as i64;
            let card = rng.below(100) < profile.card_share_percent;
            let (kind, funding) = if card {
                ("CARD_PURCHASE", account("card"))
            } else {
                ("EXPENSE", account("cash"))
            };
            let date = day(&mut rng);
            let status = if profile.drafts_and_voids && n % 29 == 0 {
                "DRAFT"
            } else if profile.drafts_and_voids && n % 37 == 0 {
                "VOID"
            } else {
                "POSTED"
            };
            let id = insert(
                kind,
                &date,
                status,
                1,
                &[
                    (&account(category), "DEBIT", amount),
                    (&funding, "CREDIT", amount),
                ],
            );
            let has_document = rng.below(100) < profile.receipt_share_percent;
            if has_document {
                docs += 1;
                let hash = format!("{:064x}", u128::from(profile.seed) << 64 | u128::from(docs));
                let source = format!("{household}-d{docs}");
                connection.execute("INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path) VALUES(?1,?2,?3,'CAMERA_SCAN','r.jpg','image/jpeg',10,?4,'x')", params![source, household, format!("{household}-run"), hash]).unwrap();
                connection.execute("INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json) VALUES(?1,?2,1,?3,'{}')", params![format!("{source}-r"), source, hash]).unwrap();
                connection.execute("INSERT INTO transaction_sources(transaction_id,source_record_id) VALUES(?1,?2)", params![id, format!("{source}-r")]).unwrap();
            }
            if status == "POSTED" {
                oracle.posted += 1;
                *oracle
                    .category
                    .entry((month.clone(), category))
                    .or_default() += amount;
                *oracle.spending.entry(month.clone()).or_default() += amount;
                if has_document {
                    *oracle.documented.entry(month.clone()).or_default() += amount;
                }
                oracle
                    .items
                    .entry(month.clone())
                    .or_default()
                    .push((id, amount, has_document));
            }
            // An occasional refund of part of a purchase, booked back to the category (not spending).
            if status == "POSTED" && (index * 1000 + n) % profile.refund_every == 0 {
                let refund = amount / 4 + 1;
                insert(
                    "REFUND",
                    &date,
                    "POSTED",
                    1,
                    &[
                        (&account("bank"), "DEBIT", refund),
                        (&account(category), "CREDIT", refund),
                    ],
                );
                oracle.posted += 1;
                *oracle
                    .category
                    .entry((month.clone(), category))
                    .or_default() -= refund;
            }
        }
    }
    connection.execute_batch("COMMIT").unwrap();
    oracle
}

fn check(connection: &Connection, profile: &Profile, oracle: &Oracle) {
    let who = profile.name;
    let audit = audit_household(connection, profile.household).unwrap();
    assert!(
        audit.ok && audit.findings.is_empty(),
        "{who}: ledger audit found problems: {:?}",
        audit.findings.first()
    );
    assert_eq!(
        audit.posted_transactions, oracle.posted,
        "{who}: posted transaction count"
    );

    let history = category_history(connection, profile.household, "2026-11", 24).unwrap();
    assert_eq!(history.months.len(), 24);
    assert_eq!(history.months.first().map(String::as_str), Some("2024-12"));
    for row in &history.categories {
        let id = CATEGORIES
            .iter()
            .find(|(_, name)| *name == row.name)
            .map(|(id, _)| *id)
            .expect("known category");
        for (month, amount) in history.months.iter().zip(&row.monthly_jpy) {
            let expected = oracle
                .category
                .get(&(month.clone(), id))
                .copied()
                .unwrap_or(0);
            assert_eq!(*amount, expected, "{who}: {id} in {month}");
        }
    }
    let history_total: i64 = history.categories.iter().map(|row| row.total_jpy).sum();
    assert_eq!(
        history_total,
        oracle.category.values().sum::<i64>(),
        "{who}: history grand total"
    );

    for index in 0..24 {
        let month = month_of(index);
        let report = confidence_for_month(connection, profile.household, &month).unwrap();
        assert_eq!(
            report.total_amount_jpy,
            oracle.spending.get(&month).copied().unwrap_or(0),
            "{who}: spending in {month}"
        );
        let documented = oracle.documented.get(&month).copied().unwrap_or(0);
        let evidenced: i64 = report
            .buckets
            .iter()
            .filter(|bucket| {
                !matches!(
                    bucket.level,
                    crate::data_confidence::EvidenceLevel::Import
                        | crate::data_confidence::EvidenceLevel::Manual
                )
            })
            .map(|bucket| bucket.amount_jpy)
            .sum();
        assert_eq!(
            evidenced, documented,
            "{who}: documented spending in {month}"
        );
        let listed = missing_receipts(connection, profile.household, &month, 3_000, 50).unwrap();
        let mut expected: Vec<_> = oracle
            .items
            .get(&month)
            .into_iter()
            .flatten()
            .filter(|(_, amount, doc)| !doc && *amount >= 3_000)
            .cloned()
            .collect();
        expected.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        expected.truncate(50);
        let listed_amounts: Vec<i64> = listed.iter().map(|item| item.amount_jpy).collect();
        let expected_amounts: Vec<i64> = expected.iter().map(|item| item.1).collect();
        assert_eq!(
            listed_amounts, expected_amounts,
            "{who}: missing receipts in {month}"
        );
    }
}

#[test]
fn synthetic_profiles_agree_with_their_independent_oracle() {
    for profile in &PROFILES {
        let state = AppState::in_memory(&[3_u8; 32]).expect("migrations");
        state
            .with_connection(|connection| {
                let oracle = generate(connection, profile);
                assert!(
                    oracle.posted > 500,
                    "{}: profile should be substantial",
                    profile.name
                );
                check(connection, profile, &oracle);
                Ok(())
            })
            .expect(profile.name);
    }
}

#[test]
fn the_generator_is_deterministic() {
    let counts = |profile: &Profile| {
        let state = AppState::in_memory(&[3_u8; 32]).expect("migrations");
        let mut out = (0_u64, 0_i64);
        state
            .with_connection(|connection| {
                let oracle = generate(connection, profile);
                out = (oracle.posted, oracle.spending.values().sum());
                Ok(())
            })
            .unwrap();
        out
    };
    assert_eq!(counts(&PROFILES[1]), counts(&PROFILES[1]));
}
