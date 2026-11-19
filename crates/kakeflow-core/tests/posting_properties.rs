//! Property tests for the double-entry invariant: whatever the amounts, order and entry counts,
//! an approved posting is valid exactly when debits equal credits equal the candidate amount.

use kakeflow_core::{
    canonical_posting_hash, validate_posting, EntrySide, PostingEntry, PostingInput, ValidationCode,
};
use proptest::prelude::*;

const TYPES: [&str; 9] = [
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    "CARD_PURCHASE",
    "CARD_PAYMENT",
    "REFUND",
    "FEE",
    "INTEREST",
    "ADJUSTMENT",
];

/// Positive amounts split into the same total on each side, so the journal always balances.
fn balanced_posting() -> impl Strategy<Value = PostingInput> {
    (
        proptest::collection::vec(1_i64..=1_000_000, 1..=20),
        proptest::collection::vec(1_i64..=1_000_000, 1..=20),
        0..TYPES.len(),
    )
        .prop_map(|(debits, credits, kind)| {
            // Make both sides sum to the same total by padding the shorter side's last entry.
            let debit_total: i64 = debits.iter().sum();
            let credit_total: i64 = credits.iter().sum();
            let (mut debits, mut credits) = (debits, credits);
            if debit_total > credit_total {
                *credits.last_mut().expect("non-empty") += debit_total - credit_total;
            } else {
                *debits.last_mut().expect("non-empty") += credit_total - debit_total;
            }
            let total: i64 = debits.iter().sum();
            let entries = debits
                .iter()
                .map(|amount| (EntrySide::Debit, *amount))
                .chain(credits.iter().map(|amount| (EntrySide::Credit, *amount)))
                .enumerate()
                .map(|(index, (side, amount_jpy))| PostingEntry {
                    id: format!("entry-{index}"),
                    account_id: format!("account-{}", index % 7),
                    side,
                    amount_jpy,
                })
                .collect();
            PostingInput {
                candidate_id: "candidate".into(),
                transaction_id: "transaction".into(),
                transaction_type: TYPES[kind].into(),
                candidate_amount_jpy: total,
                approved: true,
                entries,
            }
        })
}

proptest! {
    #[test]
    fn every_balanced_approved_posting_is_valid(input in balanced_posting()) {
        let validation = validate_posting(&input);
        prop_assert!(validation.valid, "{:?}", validation.codes);
        prop_assert_eq!(validation.debit_total_jpy, validation.credit_total_jpy);
        prop_assert_eq!(validation.debit_total_jpy, input.candidate_amount_jpy);
    }

    #[test]
    fn entry_order_never_changes_the_canonical_hash(input in balanced_posting(), seed in any::<u64>()) {
        let mut shuffled = input.clone();
        // Deterministic rotation and reversal: enough to reorder without extra dependencies.
        let length = shuffled.entries.len();
        shuffled.entries.rotate_left((seed as usize) % length);
        if seed % 2 == 0 {
            shuffled.entries.reverse();
        }
        prop_assert_eq!(canonical_posting_hash(&input).unwrap(), canonical_posting_hash(&shuffled).unwrap());
    }

    #[test]
    fn nudging_any_entry_breaks_the_balance(input in balanced_posting(), index in any::<prop::sample::Index>(), delta in 1_i64..=1_000) {
        let mut broken = input;
        let target = index.index(broken.entries.len());
        broken.entries[target].amount_jpy += delta;
        let validation = validate_posting(&broken);
        prop_assert!(!validation.valid);
        prop_assert!(validation.codes.contains(&ValidationCode::UnbalancedJournal));
        prop_assert!(canonical_posting_hash(&broken).is_err());
    }

    #[test]
    fn an_unapproved_posting_is_never_valid(mut input in balanced_posting()) {
        input.approved = false;
        let validation = validate_posting(&input);
        prop_assert!(!validation.valid);
        prop_assert!(validation.codes.contains(&ValidationCode::ApprovalRequired));
    }

    #[test]
    fn validation_never_panics_and_valid_means_balanced(
        amounts in proptest::collection::vec((any::<bool>(), any::<i64>()), 0..40),
        candidate in any::<i64>(),
        approved in any::<bool>(),
    ) {
        let entries = amounts
            .iter()
            .enumerate()
            .map(|(index, (debit, amount_jpy))| PostingEntry {
                id: format!("e{index}"),
                account_id: "a".into(),
                side: if *debit { EntrySide::Debit } else { EntrySide::Credit },
                amount_jpy: *amount_jpy,
            })
            .collect();
        let input = PostingInput {
            candidate_id: "c".into(),
            transaction_id: "t".into(),
            transaction_type: "EXPENSE".into(),
            candidate_amount_jpy: candidate,
            approved,
            entries,
        };
        let validation = validate_posting(&input);
        if validation.valid {
            prop_assert!(approved);
            prop_assert!(candidate > 0);
            prop_assert_eq!(validation.debit_total_jpy, validation.credit_total_jpy);
            prop_assert_eq!(validation.debit_total_jpy, candidate);
        }
    }

    #[test]
    fn overflowing_totals_are_rejected_not_wrapped(extra in 1_i64..=1_000) {
        let input = PostingInput {
            candidate_id: "c".into(),
            transaction_id: "t".into(),
            transaction_type: "EXPENSE".into(),
            candidate_amount_jpy: i64::MAX,
            approved: true,
            entries: vec![
                PostingEntry { id: "d1".into(), account_id: "a".into(), side: EntrySide::Debit, amount_jpy: i64::MAX },
                PostingEntry { id: "d2".into(), account_id: "a".into(), side: EntrySide::Debit, amount_jpy: extra },
                PostingEntry { id: "c1".into(), account_id: "b".into(), side: EntrySide::Credit, amount_jpy: i64::MAX },
            ],
        };
        let validation = validate_posting(&input);
        prop_assert!(!validation.valid);
        prop_assert!(validation.codes.contains(&ValidationCode::AmountOverflow));
    }
}
