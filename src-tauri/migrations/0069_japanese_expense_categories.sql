-- Add the standard top-level expense taxonomy used by Japanese household-ledger apps.
-- Existing accounts and user-renamed canonical accounts are never overwritten.
INSERT OR IGNORE INTO accounts
  (id, household_id, name, account_kind, account_subtype, currency,
   ownership_kind, owner_member_id, visibility)
SELECT h.id || '-' || c.suffix, h.id, c.name, 'EXPENSE', 'OTHER', 'JPY',
       'HOUSEHOLD', NULL, 'SHARED'
FROM households h
CROSS JOIN (
  SELECT 'household-goods' AS suffix, '日用品' AS name UNION ALL
  SELECT 'clothing-beauty', '衣服・美容' UNION ALL
  SELECT 'special-expense', '特別な支出' UNION ALL
  SELECT 'social', '交際費' UNION ALL
  SELECT 'automobile', '自動車' UNION ALL
  SELECT 'insurance', '保険' UNION ALL
  SELECT 'taxes-social-security', '税・社会保障' UNION ALL
  SELECT 'education', '教養・教育' UNION ALL
  SELECT 'communication', '通信費'
) c;

-- Translate untouched legacy defaults. UPDATE OR IGNORE preserves a user-created
-- account that already owns the translated name under the household uniqueness rule.
UPDATE OR IGNORE accounts SET name = '銀行' WHERE id = household_id || '-bank' AND name = 'Bank';
UPDATE OR IGNORE accounts SET name = '現金' WHERE id = household_id || '-cash' AND name = 'Cash';
UPDATE OR IGNORE accounts SET name = 'ウォレット' WHERE id = household_id || '-wallet' AND name = 'Wallet';
UPDATE OR IGNORE accounts SET name = 'クレジットカード' WHERE id = household_id || '-card' AND name = 'Credit Card';
UPDATE OR IGNORE accounts SET name = '収入' WHERE id = household_id || '-income' AND name = 'Income';
UPDATE OR IGNORE accounts SET name = '食費' WHERE id = household_id || '-groceries' AND name = 'Groceries';
UPDATE OR IGNORE accounts SET name = '住宅' WHERE id = household_id || '-housing' AND name = 'Housing';
UPDATE OR IGNORE accounts SET name = '水道・光熱費' WHERE id = household_id || '-utilities' AND name = 'Utilities';
UPDATE OR IGNORE accounts SET name = '交通費' WHERE id = household_id || '-transport' AND name = 'Transport';
UPDATE OR IGNORE accounts SET name = '健康・医療' WHERE id = household_id || '-healthcare' AND name = 'Healthcare';
UPDATE OR IGNORE accounts SET name = '趣味・娯楽' WHERE id = household_id || '-entertainment' AND name = 'Entertainment';
UPDATE OR IGNORE accounts SET name = 'その他' WHERE id = household_id || '-other-expense' AND name = 'Other Expense';
