-- KakeFlow deterministic demo household dump.
-- Synthetic data only. All people, identifiers and financial events are fictional.
-- Target schema: all migrations through 0065_card_payment_link_corrections.sql.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

INSERT INTO households (id, name, base_currency, created_at, updated_at)
VALUES ('demo-tanaka-family', '田中家', 'JPY', '2025-07-31T00:00:00.000Z', '2026-07-16T00:00:00.000Z');

UPDATE household_members
SET display_name='田中 健太', relationship_label='父', sort_order=0,
    updated_at='2026-07-16T00:00:00.000Z'
WHERE id='demo-tanaka-family-member-primary';

INSERT INTO household_members
  (id, household_id, display_name, relationship_label, status, sort_order, created_at, updated_at)
VALUES
  ('demo-member-mother','demo-tanaka-family','田中 美咲','母','ACTIVE',1,'2025-07-31T00:00:00.000Z','2026-07-16T00:00:00.000Z'),
  ('demo-member-son','demo-tanaka-family','田中 悠真','長男・中学2年','ACTIVE',2,'2025-07-31T00:00:00.000Z','2026-07-16T00:00:00.000Z'),
  ('demo-member-daughter','demo-tanaka-family','田中 陽菜','長女・小学5年','ACTIVE',3,'2025-07-31T00:00:00.000Z','2026-07-16T00:00:00.000Z');

INSERT INTO accounts
  (id, household_id, name, account_kind, account_subtype, currency, institution_name,
   masked_identifier, owner_member_id, ownership_kind, visibility)
VALUES
  ('demo-bank-father','demo-tanaka-family','三菱UFJ銀行・健太','ASSET','BANK','JPY','三菱UFJ銀行','****1842','demo-tanaka-family-member-primary','MEMBER','SHARED'),
  ('demo-bank-mother','demo-tanaka-family','三菱UFJ銀行・美咲','ASSET','BANK','JPY','三菱UFJ銀行','****5270','demo-member-mother','MEMBER','SHARED'),
  ('demo-bank-joint','demo-tanaka-family','三井住友銀行・家計','ASSET','BANK','JPY','三井住友銀行','****4031',NULL,'HOUSEHOLD','SHARED'),
  ('demo-cash','demo-tanaka-family','家計現金','ASSET','CASH','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-paypay','demo-tanaka-family','PayPay残高','ASSET','WALLET','JPY','PayPay',NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-stock','demo-tanaka-family','楽天証券・株式','ASSET','SECURITIES','JPY','楽天証券','****7721','demo-tanaka-family-member-primary','MEMBER','SHARED'),
  ('demo-metals','demo-tanaka-family','SBI証券・金銀','ASSET','SECURITIES','JPY','SBI証券','****6350','demo-member-mother','MEMBER','SHARED'),
  ('demo-reit','demo-tanaka-family','みずほ証券・不動産投資','ASSET','SECURITIES','JPY','みずほ証券','****8914',NULL,'HOUSEHOLD','SHARED'),
  ('demo-home','demo-tanaka-family','自宅不動産','ASSET','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-card-rakuten','demo-tanaka-family','楽天カード','LIABILITY','CREDIT_CARD','JPY','楽天カード','****8106','demo-tanaka-family-member-primary','MEMBER','SHARED'),
  ('demo-card-paypay','demo-tanaka-family','PayPayカード','LIABILITY','CREDIT_CARD','JPY','PayPayカード','****2841','demo-member-mother','MEMBER','SHARED'),
  ('demo-mortgage','demo-tanaka-family','住宅ローン','LIABILITY','OTHER','JPY','三井住友銀行','契約****2098',NULL,'HOUSEHOLD','SHARED'),
  ('demo-opening-equity','demo-tanaka-family','開始残高','EQUITY','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-income-father','demo-tanaka-family','健太・給与','INCOME','OTHER','JPY','架空テクノロジー株式会社',NULL,'demo-tanaka-family-member-primary','MEMBER','SHARED'),
  ('demo-income-mother','demo-tanaka-family','美咲・給与','INCOME','OTHER','JPY','架空メディカル株式会社',NULL,'demo-member-mother','MEMBER','SHARED'),
  ('demo-exp-groceries','demo-tanaka-family','食費・食料品','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-dining','demo-tanaka-family','食費・外食','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-utilities','demo-tanaka-family','住居・光熱','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-communications','demo-tanaka-family','通信費','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-insurance','demo-tanaka-family','保険','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-education','demo-tanaka-family','教育・子ども','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-transport','demo-tanaka-family','交通・自動車','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-medical','demo-tanaka-family','医療・健康','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-household','demo-tanaka-family','日用品・家事','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-subscription','demo-tanaka-family','娯楽・サブスク','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-tax','demo-tanaka-family','税金・社会保険','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-interest','demo-tanaka-family','住宅ローン利息','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED'),
  ('demo-exp-special','demo-tanaka-family','旅行・特別支出','EXPENSE','OTHER','JPY',NULL,NULL,NULL,'HOUSEHOLD','SHARED');

INSERT INTO account_groups (id,household_id,name,group_kind,sort_order) VALUES
  ('demo-group-daily','demo-tanaka-family','日常家計','DAILY_SPENDING',0),
  ('demo-group-investment','demo-tanaka-family','投資資産','INVESTMENT',1),
  ('demo-group-education','demo-tanaka-family','子ども・教育','EDUCATION',2);
INSERT INTO account_group_members (household_id,account_group_id,account_id,sort_order) VALUES
  ('demo-tanaka-family','demo-group-daily','demo-bank-father',0),
  ('demo-tanaka-family','demo-group-daily','demo-bank-mother',1),
  ('demo-tanaka-family','demo-group-daily','demo-bank-joint',2),
  ('demo-tanaka-family','demo-group-daily','demo-cash',3),
  ('demo-tanaka-family','demo-group-daily','demo-paypay',4),
  ('demo-tanaka-family','demo-group-daily','demo-card-rakuten',5),
  ('demo-tanaka-family','demo-group-daily','demo-card-paypay',6),
  ('demo-tanaka-family','demo-group-investment','demo-stock',0),
  ('demo-tanaka-family','demo-group-investment','demo-metals',1),
  ('demo-tanaka-family','demo-group-investment','demo-reit',2),
  ('demo-tanaka-family','demo-group-education','demo-exp-education',0);

INSERT INTO dashboard_preferences
  (household_id,dashboard_template,theme,density,widget_order,hidden_widgets)
VALUES
  ('demo-tanaka-family','FINANCIAL_OVERVIEW','LIGHT','COMFORTABLE',
   '["TREND","SPENDING","RECENT","CARDS"]','[]');

-- Opening balance: JPY 76.78m assets, JPY 28.8m mortgage, JPY 47.98m equity.
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
VALUES
  ('demo-opening','demo-tanaka-family','2025-07-31','2025-07-31','ADJUSTMENT',
   '開始残高','デモ世帯の開始時点残高','POSTED',0);
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number) VALUES
  ('demo-opening-01','demo-opening','demo-bank-father','DEBIT',4000000,1),
  ('demo-opening-02','demo-opening','demo-bank-mother','DEBIT',2000000,2),
  ('demo-opening-03','demo-opening','demo-bank-joint','DEBIT',2500000,3),
  ('demo-opening-04','demo-opening','demo-cash','DEBIT',200000,4),
  ('demo-opening-05','demo-opening','demo-paypay','DEBIT',80000,5),
  ('demo-opening-06','demo-opening','demo-stock','DEBIT',12000000,6),
  ('demo-opening-07','demo-opening','demo-metals','DEBIT',4000000,7),
  ('demo-opening-08','demo-opening','demo-reit','DEBIT',4000000,8),
  ('demo-opening-09','demo-opening','demo-home','DEBIT',48000000,9),
  ('demo-opening-10','demo-opening','demo-mortgage','CREDIT',28800000,10),
  ('demo-opening-11','demo-opening','demo-opening-equity','CREDIT',47980000,11);

CREATE TEMP TABLE demo_months(month TEXT PRIMARY KEY, month_start TEXT, month_index INTEGER) STRICT;
WITH RECURSIVE m(i,d) AS (
  VALUES(0,date('2025-08-01'))
  UNION ALL SELECT i+1,date(d,'+1 month') FROM m WHERE i<11
)
INSERT INTO demo_months SELECT strftime('%Y-%m',d),d,i FROM m;

-- Gross annual household income: father JPY 8.4m + mother JPY 5.6m = JPY 14m.
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
   attribution_kind,attributed_member_id,calculation_target)
SELECT 'demo-salary-father-'||month,'demo-tanaka-family',date(month_start,'+24 days'),
       date(month_start,'+24 days'),'INCOME','架空テクノロジー株式会社','月例給与','POSTED',
       'MEMBER','demo-tanaka-family-member-primary',1 FROM demo_months
UNION ALL
SELECT 'demo-salary-mother-'||month,'demo-tanaka-family',date(month_start,'+24 days'),
       date(month_start,'+24 days'),'INCOME','架空メディカル株式会社','月例給与','POSTED',
       'MEMBER','demo-member-mother',1 FROM demo_months;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,bank,'DEBIT',amount,1 FROM (
  SELECT 'demo-salary-father-'||month id,'demo-bank-father' bank,600000 amount FROM demo_months
  UNION ALL SELECT 'demo-salary-mother-'||month,'demo-bank-mother',400000 FROM demo_months
)
UNION ALL
SELECT 'je-'||id||'-2',id,income_account,'CREDIT',amount,2 FROM (
  SELECT 'demo-salary-father-'||month id,'demo-income-father' income_account,600000 amount FROM demo_months
  UNION ALL SELECT 'demo-salary-mother-'||month,'demo-income-mother',400000 FROM demo_months
);

INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
   attribution_kind,attributed_member_id,calculation_target)
VALUES
  ('demo-bonus-father-2025-12','demo-tanaka-family','2025-12-10','2025-12-10','INCOME','架空テクノロジー株式会社','冬季賞与','POSTED','MEMBER','demo-tanaka-family-member-primary',1),
  ('demo-bonus-father-2026-06','demo-tanaka-family','2026-06-10','2026-06-10','INCOME','架空テクノロジー株式会社','夏季賞与','POSTED','MEMBER','demo-tanaka-family-member-primary',1),
  ('demo-bonus-mother-2025-12','demo-tanaka-family','2025-12-12','2025-12-12','INCOME','架空メディカル株式会社','冬季賞与','POSTED','MEMBER','demo-member-mother',1),
  ('demo-bonus-mother-2026-06','demo-tanaka-family','2026-06-12','2026-06-12','INCOME','架空メディカル株式会社','夏季賞与','POSTED','MEMBER','demo-member-mother',1);
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number) VALUES
  ('je-demo-bonus-father-2025-12-1','demo-bonus-father-2025-12','demo-bank-father','DEBIT',600000,1),
  ('je-demo-bonus-father-2025-12-2','demo-bonus-father-2025-12','demo-income-father','CREDIT',600000,2),
  ('je-demo-bonus-father-2026-06-1','demo-bonus-father-2026-06','demo-bank-father','DEBIT',600000,1),
  ('je-demo-bonus-father-2026-06-2','demo-bonus-father-2026-06','demo-income-father','CREDIT',600000,2),
  ('je-demo-bonus-mother-2025-12-1','demo-bonus-mother-2025-12','demo-bank-mother','DEBIT',400000,1),
  ('je-demo-bonus-mother-2025-12-2','demo-bonus-mother-2025-12','demo-income-mother','CREDIT',400000,2),
  ('je-demo-bonus-mother-2026-06-1','demo-bonus-mother-2026-06','demo-bank-mother','DEBIT',400000,1),
  ('je-demo-bonus-mother-2026-06-2','demo-bonus-mother-2026-06','demo-income-mother','CREDIT',400000,2);

-- Payroll deductions keep gross-income reporting explicit and cash realistic.
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
   attribution_kind,attributed_member_id,calculation_target)
SELECT 'demo-tax-father-'||month,'demo-tanaka-family',date(month_start,'+24 days'),
       date(month_start,'+24 days'),'EXPENSE','給与天引き','所得税・住民税・社会保険','POSTED',
       'MEMBER','demo-tanaka-family-member-primary',1 FROM demo_months
UNION ALL
SELECT 'demo-tax-mother-'||month,'demo-tanaka-family',date(month_start,'+24 days'),
       date(month_start,'+24 days'),'EXPENSE','給与天引き','所得税・住民税・社会保険','POSTED',
       'MEMBER','demo-member-mother',1 FROM demo_months;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,'demo-exp-tax','DEBIT',amount,1 FROM (
  SELECT 'demo-tax-father-'||month id,150000 amount FROM demo_months
  UNION ALL SELECT 'demo-tax-mother-'||month,90000 FROM demo_months
)
UNION ALL
SELECT 'je-'||id||'-2',id,bank,'CREDIT',amount,2 FROM (
  SELECT 'demo-tax-father-'||month id,'demo-bank-father' bank,150000 amount FROM demo_months
  UNION ALL SELECT 'demo-tax-mother-'||month,'demo-bank-mother',90000 FROM demo_months
);

-- One bank debit of JPY 150k/month: JPY 120k principal + JPY 30k interest.
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
SELECT 'demo-mortgage-'||month,'demo-tanaka-family',date(month_start,'+26 days'),
       date(month_start,'+26 days'),'EXPENSE','三井住友銀行 住宅ローン',
       '毎月返済 150,000円（元金120,000円・利息30,000円）','POSTED',1
FROM demo_months;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-demo-mortgage-'||month||'-1','demo-mortgage-'||month,'demo-mortgage','DEBIT',120000,1 FROM demo_months
UNION ALL
SELECT 'je-demo-mortgage-'||month||'-2','demo-mortgage-'||month,'demo-exp-interest','DEBIT',30000,2 FROM demo_months
UNION ALL
SELECT 'je-demo-mortgage-'||month||'-3','demo-mortgage-'||month,'demo-bank-joint','CREDIT',150000,3 FROM demo_months;

CREATE TEMP TABLE demo_monthly_expenses (
  id TEXT PRIMARY KEY, occurred_on TEXT, payee TEXT, description TEXT,
  category_id TEXT, amount_jpy INTEGER, source_account_id TEXT,
  attribution_kind TEXT, member_id TEXT
) STRICT;
INSERT INTO demo_monthly_expenses
SELECT 'demo-exp-internet-'||month,date(month_start,'+9 days'),'NURO 光','光回線',
       'demo-exp-communications',6380,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-mobile-'||month,date(month_start,'+11 days'),'NTTドコモ','家族スマホ3回線',
       'demo-exp-communications',15300,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-insurance-'||month,date(month_start,'+14 days'),'県民共済・医療保険','家族保険料',
       'demo-exp-insurance',24800,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-education-'||month,date(month_start,'+7 days'),'学校・学習塾','給食・教材・学習塾',
       'demo-exp-education',92000,'demo-bank-joint','MEMBER',
       CASE WHEN month_index%2=0 THEN 'demo-member-son' ELSE 'demo-member-daughter' END FROM demo_months
UNION ALL SELECT 'demo-exp-transport-'||month,date(month_start,'+5 days'),'交通系IC・ガソリン','通勤・家族移動',
       'demo-exp-transport',36000,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-medical-'||month,date(month_start,'+18 days'),'クリニック・薬局','診療・医薬品',
       'demo-exp-medical',12000,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-household-'||month,date(month_start,'+16 days'),'無印良品・ドラッグストア','日用品',
       'demo-exp-household',25000,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-subscription-'||month,date(month_start,'+2 days'),'動画・音楽サービス','Netflix・Spotify',
       'demo-exp-subscription',5480,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-electric-'||month,date(month_start,'+20 days'),'東京電力','電気料金',
       'demo-exp-utilities',
       CASE CAST(substr(month,6,2) AS INTEGER)
         WHEN 1 THEN 29800 WHEN 2 THEN 28600 WHEN 7 THEN 26400 WHEN 8 THEN 27900
         WHEN 12 THEN 25300 ELSE 19800 END,
       'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-gas-'||month,date(month_start,'+21 days'),'東京ガス','ガス料金',
       'demo-exp-utilities',
       CASE WHEN CAST(substr(month,6,2) AS INTEGER) IN (12,1,2,3) THEN 16200 ELSE 8900 END,
       'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months
UNION ALL SELECT 'demo-exp-water-'||month,date(month_start,'+22 days'),'東京都水道局','上下水道',
       'demo-exp-utilities',7600,'demo-bank-joint','HOUSEHOLD',NULL FROM demo_months WHERE month_index%2=0;

INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
   attribution_kind,attributed_member_id,calculation_target)
SELECT id,'demo-tanaka-family',occurred_on,occurred_on,
       CASE WHEN source_account_id LIKE 'demo-card-%' THEN 'CARD_PURCHASE' ELSE 'EXPENSE' END,
       payee,description,'POSTED',attribution_kind,member_id,1
FROM demo_monthly_expenses;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,category_id,'DEBIT',amount_jpy,1 FROM demo_monthly_expenses
UNION ALL
SELECT 'je-'||id||'-2',id,source_account_id,'CREDIT',amount_jpy,2 FROM demo_monthly_expenses;

-- PayPay top-ups are transfers, not household expense.
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
SELECT 'demo-paypay-topup-'||month,'demo-tanaka-family',date(month_start,'+1 day'),
       date(month_start,'+1 day'),'TRANSFER','PayPayチャージ','家計口座から残高へ','POSTED',1 FROM demo_months;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-demo-paypay-topup-'||month||'-1','demo-paypay-topup-'||month,'demo-paypay','DEBIT',60000,1 FROM demo_months
UNION ALL
SELECT 'je-demo-paypay-topup-'||month||'-2','demo-paypay-topup-'||month,'demo-bank-joint','CREDIT',60000,2 FROM demo_months;

CREATE TEMP TABLE demo_groceries (id TEXT PRIMARY KEY, occurred_on TEXT, payee TEXT, amount_jpy INTEGER) STRICT;
WITH RECURSIVE d(n,day) AS (
  VALUES(0,date('2025-08-02'))
  UNION ALL SELECT n+1,date(day,'+3 days') FROM d WHERE day<'2026-07-29'
)
INSERT INTO demo_groceries
SELECT 'demo-grocery-'||printf('%03d',n),day,
       CASE n%3 WHEN 0 THEN 'ライフ' WHEN 1 THEN 'イトーヨーカドー' ELSE 'コープみらい' END,
       6200+((n*137)%4200) FROM d WHERE day<='2026-07-31';
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
SELECT id,'demo-tanaka-family',occurred_on,occurred_on,'EXPENSE',payee,'家族4人の食料品','POSTED',1 FROM demo_groceries;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,'demo-exp-groceries','DEBIT',amount_jpy,1 FROM demo_groceries
UNION ALL SELECT 'je-'||id||'-2',id,'demo-bank-joint','CREDIT',amount_jpy,2 FROM demo_groceries;

CREATE TEMP TABLE demo_dining (id TEXT PRIMARY KEY, occurred_on TEXT, payee TEXT, amount_jpy INTEGER) STRICT;
WITH RECURSIVE d(n,day) AS (
  VALUES(0,date('2025-08-09'))
  UNION ALL SELECT n+1,date(day,'+10 days') FROM d WHERE day<'2026-07-25'
)
INSERT INTO demo_dining
SELECT 'demo-dining-'||printf('%03d',n),day,
       CASE n%4 WHEN 0 THEN 'サイゼリヤ' WHEN 1 THEN 'スシロー' WHEN 2 THEN '丸亀製麺' ELSE '町の焼肉店' END,
       6500+((n*811)%7500) FROM d WHERE day<='2026-07-31';
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
SELECT id,'demo-tanaka-family',occurred_on,occurred_on,'EXPENSE',payee,'家族外食','POSTED',1 FROM demo_dining;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,'demo-exp-dining','DEBIT',amount_jpy,1 FROM demo_dining
UNION ALL SELECT 'je-'||id||'-2',id,'demo-paypay','CREDIT',amount_jpy,2 FROM demo_dining;

CREATE TEMP TABLE demo_oneoff (
  id TEXT PRIMARY KEY, occurred_on TEXT, payee TEXT, description TEXT,
  category_id TEXT, amount_jpy INTEGER, source_account_id TEXT
) STRICT;
INSERT INTO demo_oneoff VALUES
  ('demo-trip-summer','2025-08-16','軽井沢ファミリーホテル','夏休み家族旅行','demo-exp-special',238000,'demo-bank-joint'),
  ('demo-trip-winter','2025-12-29','苗場スキーリゾート','冬休み家族旅行','demo-exp-special',196000,'demo-bank-joint'),
  ('demo-trip-spring','2026-03-27','京都ファミリーツアー','春休み家族旅行','demo-exp-special',268000,'demo-bank-joint'),
  ('demo-property-tax','2026-05-10','東京都主税局','固定資産税','demo-exp-tax',160000,'demo-bank-father'),
  ('demo-car-tax','2026-05-31','東京都自動車税','自動車税','demo-exp-tax',45000,'demo-bank-joint');
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
SELECT id,'demo-tanaka-family',occurred_on,occurred_on,
       CASE WHEN source_account_id LIKE 'demo-card-%' THEN 'CARD_PURCHASE' ELSE 'EXPENSE' END,
       payee,description,'POSTED',1 FROM demo_oneoff;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,category_id,'DEBIT',amount_jpy,1 FROM demo_oneoff
UNION ALL SELECT 'je-'||id||'-2',id,source_account_id,'CREDIT',amount_jpy,2 FROM demo_oneoff;

-- Imported source metadata for portfolio and latest card statements.
INSERT INTO import_runs (id,household_id,status,adapter_id,adapter_version,started_at,completed_at) VALUES
  ('demo-import-stock','demo-tanaka-family','POSTED','securities-asset-snapshot-v1','1.0','2026-07-12T05:47:56.000Z','2026-07-12T05:48:02.000Z'),
  ('demo-import-metals','demo-tanaka-family','POSTED','generic-portfolio-snapshot-v1','1.0','2026-07-12T05:48:10.000Z','2026-07-12T05:48:14.000Z'),
  ('demo-import-reit','demo-tanaka-family','POSTED','generic-portfolio-snapshot-v1','1.0','2026-07-12T05:48:20.000Z','2026-07-12T05:48:24.000Z'),
  ('demo-import-rakuten-card','demo-tanaka-family','POSTED','rakuten-enavi-v1','1.0','2026-07-01T02:00:00.000Z','2026-07-01T02:00:04.000Z'),
  ('demo-import-paypay-card','demo-tanaka-family','POSTED','paypay-card-v1','1.0','2026-07-01T02:01:00.000Z','2026-07-01T02:01:04.000Z');
INSERT INTO source_documents
  (id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path,source_modified_at,imported_at)
VALUES
  ('demo-source-stock','demo-tanaka-family','demo-import-stock','MANUAL_UPLOAD','assetbalance(all)_20260712_144756.csv','text/csv',18342,'1111111111111111111111111111111111111111111111111111111111111111','demo://portfolio/stock','2026-07-12T05:47:56.000Z','2026-07-12T05:48:02.000Z'),
  ('demo-source-metals','demo-tanaka-family','demo-import-metals','MANUAL_UPLOAD','precious_metals_20260712.csv','text/csv',4812,'2222222222222222222222222222222222222222222222222222222222222222','demo://portfolio/metals','2026-07-12T05:48:10.000Z','2026-07-12T05:48:14.000Z'),
  ('demo-source-reit','demo-tanaka-family','demo-import-reit','MANUAL_UPLOAD','reit_balance_20260712.csv','text/csv',3720,'3333333333333333333333333333333333333333333333333333333333333333','demo://portfolio/reit','2026-07-12T05:48:20.000Z','2026-07-12T05:48:24.000Z'),
  ('demo-source-rakuten-card','demo-tanaka-family','demo-import-rakuten-card','MANUAL_UPLOAD','enavi202607.csv','text/csv',9050,'4444444444444444444444444444444444444444444444444444444444444444','demo://cards/rakuten','2026-07-01T02:00:00.000Z','2026-07-01T02:00:04.000Z'),
  ('demo-source-paypay-card','demo-tanaka-family','demo-import-paypay-card','MANUAL_UPLOAD','paypay_card_202607.csv','text/csv',6220,'5555555555555555555555555555555555555555555555555555555555555555','demo://cards/paypay-card','2026-07-01T02:01:00.000Z','2026-07-01T02:01:04.000Z');
INSERT INTO source_records (id,source_document_id,row_number,record_hash,raw_payload_json) VALUES
  ('demo-record-stock-total','demo-source-stock',1,'6666666666666666666666666666666666666666666666666666666666666666','{"section":"資産合計欄","totalAssetsJpy":20000000}'),
  ('demo-record-metals-total','demo-source-metals',1,'7777777777777777777777777777777777777777777777777777777777777777','{"section":"precious-metals","marketValueJpy":4000000}'),
  ('demo-record-reit-total','demo-source-reit',1,'8888888888888888888888888888888888888888888888888888888888888888','{"section":"reit","marketValueJpy":4000000}'),
  ('demo-record-rakuten-total','demo-source-rakuten-card',1,'9999999999999999999999999999999999999999999999999999999999999999','{"statementAmountJpy":204987,"paymentDueOn":"2026-07-27"}'),
  ('demo-record-paypay-total','demo-source-paypay-card',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{"statementAmountJpy":20170,"paymentDueOn":"2026-07-27"}');

INSERT INTO portfolio_snapshots
  (id,household_id,account_id,source_document_id,as_of,market_value_jpy,cash_value_jpy,unrealized_pnl_jpy,realized_pnl_jpy)
VALUES
  ('demo-snapshot-stock','demo-tanaka-family','demo-stock','demo-source-stock','2026-07-12T14:47:56+09:00',12000000,0,2100000,320000),
  ('demo-snapshot-metals','demo-tanaka-family','demo-metals','demo-source-metals','2026-07-12T14:48:10+09:00',4000000,0,450000,0),
  ('demo-snapshot-reit','demo-tanaka-family','demo-reit','demo-source-reit','2026-07-12T14:48:20+09:00',4000000,0,300000,120000);
INSERT INTO portfolio_asset_classes
  (id,portfolio_snapshot_id,name,market_value_jpy,unrealized_pnl_jpy,source_row)
VALUES
  ('demo-class-jp-stock','demo-snapshot-stock','国内株式',4200000,800000,2),
  ('demo-class-global-stock','demo-snapshot-stock','海外株式',4800000,950000,3),
  ('demo-class-fund','demo-snapshot-stock','投資信託',3000000,350000,4),
  ('demo-class-gold','demo-snapshot-metals','金',3200000,400000,2),
  ('demo-class-silver','demo-snapshot-metals','銀',800000,50000,3),
  ('demo-class-reit','demo-snapshot-reit','国内REIT',4000000,300000,2);
INSERT INTO position_snapshots
  (id,portfolio_snapshot_id,product_type,account_type,instrument_code,instrument_name,
   quantity,average_cost,market_price,market_value_jpy,unrealized_pnl_jpy,realized_pnl_jpy,currency,source_row)
VALUES
  ('demo-pos-toyota','demo-snapshot-stock','国内株式','特定','7203','トヨタ自動車',800,2500,3000,2400000,400000,0,'JPY',10),
  ('demo-pos-mufg','demo-snapshot-stock','国内株式','NISA成長','8306','三菱UFJフィナンシャル・グループ',900,1600,2000,1800000,360000,0,'JPY',11),
  ('demo-pos-emaxis','demo-snapshot-stock','投資信託','NISAつみたて','EMAXIS-AC','eMAXIS Slim 全世界株式',1000000,2.65,3.00,3000000,350000,0,'JPY',12),
  ('demo-pos-voo','demo-snapshot-stock','米国ETF','特定','VOO','Vanguard S&P 500 ETF',50,330,379.27,3000000,390000,180000,'USD',13),
  ('demo-pos-vt','demo-snapshot-stock','米国ETF','NISA成長','VT','Vanguard Total World Stock ETF',100,92,113.78,1800000,600000,140000,'USD',14),
  ('demo-pos-gold','demo-snapshot-metals','貴金属','積立','GOLD-G','SBI証券 金',250,11200,12800,3200000,400000,0,'JPY',10),
  ('demo-pos-silver','demo-snapshot-metals','貴金属','積立','SILVER-G','SBI証券 銀',5000,150,160,800000,50000,0,'JPY',11),
  ('demo-pos-reit','demo-snapshot-reit','国内ETF','特定','1343','NEXT FUNDS 東証REIT指数連動型上場投信',2000,1850,2000,4000000,300000,120000,'JPY',10);
INSERT INTO portfolio_fx_rates (id,portfolio_snapshot_id,base_currency,quote_currency,rate,source_row)
VALUES ('demo-portfolio-usd-jpy','demo-snapshot-stock','USD','JPY',158.20,30);
INSERT INTO investment_fx_rates
  (id,household_id,rate_date,base_currency,quote_currency,rate,source_kind,provider,observed_at)
VALUES ('demo-fx-usd-jpy','demo-tanaka-family','2026-07-12','USD','JPY',158.20,'OFFICIAL_REFERENCE','デモ基準レート','2026-07-12T15:00:00+09:00');
INSERT INTO investment_market_prices
  (id,household_id,price_date,instrument_code,instrument_name,currency,unit_price,source_kind,provider,observed_at)
VALUES
  ('demo-price-7203','demo-tanaka-family','2026-07-12','7203','トヨタ自動車','JPY',3000,'MANUAL','デモ終値','2026-07-12T15:00:00+09:00'),
  ('demo-price-8306','demo-tanaka-family','2026-07-12','8306','三菱UFJフィナンシャル・グループ','JPY',2000,'MANUAL','デモ終値','2026-07-12T15:00:00+09:00'),
  ('demo-price-VOO','demo-tanaka-family','2026-07-12','VOO','Vanguard S&P 500 ETF','USD',379.27,'MANUAL','デモ終値','2026-07-12T15:00:00+09:00'),
  ('demo-price-VT','demo-tanaka-family','2026-07-12','VT','Vanguard Total World Stock ETF','USD',113.78,'MANUAL','デモ終値','2026-07-12T15:00:00+09:00'),
  ('demo-price-1343','demo-tanaka-family','2026-07-12','1343','NEXT FUNDS 東証REIT指数連動型上場投信','JPY',2000,'MANUAL','デモ終値','2026-07-12T15:00:00+09:00');

-- Investment allocation read model: 60% stocks, 20% precious metals, 20% real estate.
INSERT INTO aggregate_asset_snapshots
  (id,household_id,source_document_id,source_row,as_of,total_assets_jpy)
VALUES ('demo-aggregate-investment','demo-tanaka-family','demo-source-stock',1,'2026-07-12',20000000);
INSERT INTO aggregate_asset_components
  (aggregate_asset_snapshot_id,asset_class,official_header,value_jpy)
VALUES
  ('demo-aggregate-investment','LISTED_STOCKS','株式(現物)(円)',9000000),
  ('demo-aggregate-investment','INVESTMENT_TRUSTS','投資信託(円)',3000000),
  ('demo-aggregate-investment','REAL_ESTATE','不動産(円)',4000000),
  ('demo-aggregate-investment','OTHER_ASSETS','その他の資産(円)',4000000);

CREATE TEMP TABLE demo_card_purchases (
  id TEXT PRIMARY KEY, card_id TEXT, occurred_on TEXT, payee TEXT,
  category_id TEXT, amount_jpy INTEGER, statement_id TEXT, line_number INTEGER
) STRICT;
INSERT INTO demo_card_purchases VALUES
  ('demo-rakuten-01','demo-card-rakuten','2026-06-03','コストコ','demo-exp-groceries',82400,'demo-statement-rakuten',1),
  ('demo-rakuten-02','demo-card-rakuten','2026-06-08','東京電力・東京ガス','demo-exp-utilities',67900,'demo-statement-rakuten',2),
  ('demo-rakuten-03','demo-card-rakuten','2026-06-14','JR東日本・ENEOS','demo-exp-transport',43200,'demo-statement-rakuten',3),
  ('demo-rakuten-04','demo-card-rakuten','2026-06-22','家族レストラン','demo-exp-dining',11487,'demo-statement-rakuten',4),
  ('demo-paypay-card-01','demo-card-paypay','2026-06-05','Yahoo!ショッピング','demo-exp-household',8980,'demo-statement-paypay',1),
  ('demo-paypay-card-02','demo-card-paypay','2026-06-12','LOHACO 教材','demo-exp-education',7200,'demo-statement-paypay',2),
  ('demo-paypay-card-03','demo-card-paypay','2026-06-19','PayPayカード 継続課金','demo-exp-subscription',3990,'demo-statement-paypay',3);
INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
SELECT id,'demo-tanaka-family',occurred_on,occurred_on,'CARD_PURCHASE',payee,'2026年6月カード利用','POSTED',1
FROM demo_card_purchases;
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number)
SELECT 'je-'||id||'-1',id,category_id,'DEBIT',amount_jpy,1 FROM demo_card_purchases
UNION ALL SELECT 'je-'||id||'-2',id,card_id,'CREDIT',amount_jpy,2 FROM demo_card_purchases;
INSERT INTO card_statements
  (id,household_id,card_account_id,period_start,period_end,payment_due_on,
   statement_amount_jpy,reconciliation_status,source_document_id)
VALUES
  ('demo-statement-rakuten','demo-tanaka-family','demo-card-rakuten','2026-06-01','2026-06-30','2026-07-27',204987,'FULLY_RECONCILED','demo-source-rakuten-card'),
  ('demo-statement-paypay','demo-tanaka-family','demo-card-paypay','2026-06-01','2026-06-30','2026-07-27',20170,'FULLY_RECONCILED','demo-source-paypay-card');
INSERT INTO card_statement_transactions
  (statement_id,transaction_id,statement_line_number,billed_amount_jpy)
SELECT statement_id,id,line_number,amount_jpy FROM demo_card_purchases;

INSERT INTO transactions
  (id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,calculation_target)
VALUES
  ('demo-card-payment-rakuten','demo-tanaka-family','2026-07-27','2026-07-27','CARD_PAYMENT','楽天カード','6月利用分の口座引落','POSTED',1),
  ('demo-card-payment-paypay','demo-tanaka-family','2026-07-27','2026-07-27','CARD_PAYMENT','PayPayカード','6月利用分の口座引落','POSTED',1);
INSERT INTO journal_entries (id,transaction_id,account_id,entry_side,amount_jpy,line_number) VALUES
  ('je-demo-card-payment-rakuten-1','demo-card-payment-rakuten','demo-card-rakuten','DEBIT',204987,1),
  ('je-demo-card-payment-rakuten-2','demo-card-payment-rakuten','demo-bank-joint','CREDIT',204987,2),
  ('je-demo-card-payment-paypay-1','demo-card-payment-paypay','demo-card-paypay','DEBIT',20170,1),
  ('je-demo-card-payment-paypay-2','demo-card-payment-paypay','demo-bank-joint','CREDIT',20170,2);
INSERT INTO card_payments
  (id,household_id,statement_id,bank_transaction_id,card_account_id,payment_amount_jpy,
   payment_on,match_score_bps,reconciliation_status,confirmed_at)
VALUES
  ('demo-payment-rakuten','demo-tanaka-family','demo-statement-rakuten','demo-card-payment-rakuten','demo-card-rakuten',204987,'2026-07-27',10000,'FULLY_RECONCILED','2026-07-27T01:00:00.000Z'),
  ('demo-payment-paypay','demo-tanaka-family','demo-statement-paypay','demo-card-payment-paypay','demo-card-paypay',20170,'2026-07-27',10000,'FULLY_RECONCILED','2026-07-27T01:01:00.000Z');
INSERT INTO card_settlement_bank_mappings (household_id,card_account_id,bank_account_id) VALUES
  ('demo-tanaka-family','demo-card-rakuten','demo-bank-joint'),
  ('demo-tanaka-family','demo-card-paypay','demo-bank-joint');

-- Planning, goals and recurring behavior.
INSERT INTO monthly_category_budgets (household_id,month,category_account_id,budget_jpy) VALUES
  ('demo-tanaka-family','2026-07','demo-exp-groceries',110000),
  ('demo-tanaka-family','2026-07','demo-exp-dining',45000),
  ('demo-tanaka-family','2026-07','demo-exp-utilities',60000),
  ('demo-tanaka-family','2026-07','demo-exp-communications',25000),
  ('demo-tanaka-family','2026-07','demo-exp-insurance',25000),
  ('demo-tanaka-family','2026-07','demo-exp-education',100000),
  ('demo-tanaka-family','2026-07','demo-exp-transport',45000),
  ('demo-tanaka-family','2026-07','demo-exp-medical',20000),
  ('demo-tanaka-family','2026-07','demo-exp-household',35000),
  ('demo-tanaka-family','2026-07','demo-exp-subscription',8000),
  ('demo-tanaka-family','2026-07','demo-exp-interest',30000),
  ('demo-tanaka-family','2026-07','demo-exp-tax',250000),
  ('demo-tanaka-family','2026-07','demo-exp-special',50000);
INSERT INTO savings_goals (id,household_id,name,target_jpy,saved_jpy,target_date,status) VALUES
  ('demo-goal-emergency','demo-tanaka-family','生活防衛資金',3000000,2400000,'2027-03-31','ACTIVE'),
  ('demo-goal-university','demo-tanaka-family','子ども2人の大学資金',10000000,4200000,'2032-03-31','ACTIVE'),
  ('demo-goal-travel','demo-tanaka-family','北海道家族旅行',600000,280000,'2027-08-01','ACTIVE');
INSERT INTO recurring_series_preferences (household_id,normalized_payee,decision) VALUES
  ('demo-tanaka-family','三井住友銀行 住宅ローン','CONFIRMED'),
  ('demo-tanaka-family','給与天引き','CONFIRMED'),
  ('demo-tanaka-family','東京電力','CONFIRMED'),
  ('demo-tanaka-family','東京ガス','CONFIRMED'),
  ('demo-tanaka-family','NURO 光','CONFIRMED'),
  ('demo-tanaka-family','動画・音楽サービス','CONFIRMED');

INSERT INTO transaction_labels (transaction_id,label)
SELECT id,'recurring' FROM transactions
WHERE household_id='demo-tanaka-family' AND (
  id LIKE 'demo-mortgage-%' OR id LIKE 'demo-tax-%' OR id LIKE 'demo-exp-internet-%'
  OR id LIKE 'demo-exp-electric-%' OR id LIKE 'demo-exp-gas-%'
);
INSERT INTO transaction_labels (transaction_id,label)
SELECT id,'loan-payment' FROM transactions WHERE id LIKE 'demo-mortgage-%';
INSERT INTO transaction_labels (transaction_id,label)
SELECT id,'tax-deducted' FROM transactions WHERE id LIKE 'demo-tax-%' OR id IN ('demo-property-tax','demo-car-tax');
INSERT INTO transaction_labels (transaction_id,label)
SELECT id,'subscription' FROM transactions WHERE id LIKE 'demo-exp-subscription-%';
INSERT INTO transaction_tags (transaction_id,tag)
SELECT id,'family' FROM transactions WHERE household_id='demo-tanaka-family' AND attribution_kind='HOUSEHOLD';
INSERT INTO transaction_tags (transaction_id,tag)
SELECT id,'travel' FROM transactions WHERE id LIKE 'demo-trip-%';
INSERT INTO transaction_tags (transaction_id,tag)
SELECT id,CASE attributed_member_id
  WHEN 'demo-member-son' THEN 'son' WHEN 'demo-member-daughter' THEN 'daughter' END
FROM transactions WHERE attributed_member_id IN ('demo-member-son','demo-member-daughter');

DROP TABLE demo_card_purchases;
DROP TABLE demo_oneoff;
DROP TABLE demo_dining;
DROP TABLE demo_groceries;
DROP TABLE demo_monthly_expenses;
DROP TABLE demo_months;

COMMIT;
