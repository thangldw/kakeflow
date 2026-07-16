import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const migrationsDirectory = resolve(repositoryRoot, 'src-tauri/migrations')
const dumpPath = resolve(scriptDirectory, 'jp-middle-class-family-2026.sql')

function sqlite(databasePath, sql) {
  return execFileSync('sqlite3', ['-bail', databasePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

export function readDemoSummary(databasePath) {
  const rows = sqlite(databasePath, `
    SELECT json_object(
      'members', (SELECT count(*) FROM household_members WHERE household_id='demo-tanaka-family'),
      'transactions', (SELECT count(*) FROM transactions WHERE household_id='demo-tanaka-family'),
      'journalEntries', (SELECT count(*) FROM journal_entries WHERE transaction_id IN (
        SELECT id FROM transactions WHERE household_id='demo-tanaka-family'
      )),
      'annualIncomeJpy', (SELECT COALESCE(SUM(
        CASE je.entry_side WHEN 'CREDIT' THEN je.amount_jpy ELSE -je.amount_jpy END
      ),0) FROM journal_entries je
        JOIN transactions t ON t.id=je.transaction_id
        JOIN accounts a ON a.id=je.account_id
        WHERE t.household_id='demo-tanaka-family'
          AND t.occurred_on>='2025-08-01' AND t.occurred_on<'2026-08-01'
          AND a.account_kind='INCOME'),
      'investmentJpy', (SELECT COALESCE(SUM(market_value_jpy),0) FROM portfolio_snapshots
        WHERE household_id='demo-tanaka-family'),
      'stockJpy', (SELECT market_value_jpy FROM portfolio_snapshots WHERE account_id='demo-stock'),
      'metalsJpy', (SELECT market_value_jpy FROM portfolio_snapshots WHERE account_id='demo-metals'),
      'realEstateJpy', (SELECT market_value_jpy FROM portfolio_snapshots WHERE account_id='demo-reit'),
      'mortgageMonths', (SELECT count(*) FROM transactions WHERE id LIKE 'demo-mortgage-%'),
      'mortgagePaymentJpy', (SELECT min(payment) FROM (
        SELECT SUM(CASE WHEN je.account_id='demo-bank-joint' AND je.entry_side='CREDIT'
          THEN je.amount_jpy ELSE 0 END) payment
        FROM transactions t JOIN journal_entries je ON je.transaction_id=t.id
        WHERE t.id LIKE 'demo-mortgage-%' GROUP BY t.id
      )),
      'unbalancedTransactions', (SELECT count(*) FROM (
        SELECT t.id FROM transactions t JOIN journal_entries je ON je.transaction_id=t.id
        WHERE t.household_id='demo-tanaka-family'
        GROUP BY t.id
        HAVING SUM(CASE je.entry_side WHEN 'DEBIT' THEN je.amount_jpy ELSE -je.amount_jpy END)<>0
      )),
      'reconciledCardStatements', (SELECT count(*) FROM card_statements
        WHERE household_id='demo-tanaka-family' AND reconciliation_status='FULLY_RECONCILED'),
      'institutionMappingMismatches', (SELECT count(*) FROM (
        SELECT id FROM accounts WHERE id='demo-bank-father' AND institution_name<>'三菱UFJ銀行'
        UNION ALL SELECT id FROM accounts WHERE id='demo-bank-mother' AND institution_name<>'三菱UFJ銀行'
        UNION ALL SELECT id FROM accounts WHERE id='demo-bank-joint' AND institution_name<>'三井住友銀行'
        UNION ALL SELECT id FROM accounts WHERE id='demo-card-rakuten' AND institution_name<>'楽天カード'
        UNION ALL SELECT id FROM accounts WHERE id='demo-card-paypay' AND institution_name<>'PayPayカード'
        UNION ALL SELECT id FROM accounts WHERE id='demo-paypay' AND institution_name<>'PayPay'
        UNION ALL SELECT id FROM accounts WHERE id='demo-stock' AND institution_name<>'楽天証券'
        UNION ALL SELECT id FROM accounts WHERE id='demo-metals' AND institution_name<>'SBI証券'
        UNION ALL SELECT id FROM accounts WHERE id='demo-reit' AND institution_name<>'みずほ証券'
      )),
      'salaryDestinationMismatches', (SELECT count(DISTINCT t.id)
        FROM transactions t
        JOIN journal_entries je ON je.transaction_id=t.id AND je.entry_side='DEBIT'
        JOIN accounts a ON a.id=je.account_id
        WHERE (t.id LIKE 'demo-salary-%' OR t.id LIKE 'demo-bonus-%')
          AND a.institution_name<>'三菱UFJ銀行'),
      'paypayQrPayments', (SELECT count(DISTINCT t.id)
        FROM transactions t JOIN journal_entries je ON je.transaction_id=t.id
        WHERE t.household_id='demo-tanaka-family' AND t.transaction_type='EXPENSE'
          AND je.account_id='demo-paypay' AND je.entry_side='CREDIT')
    );
  `)
  return JSON.parse(rows)
}

export function assertDemoSummary(summary) {
  const expected = {
    members: 4,
    annualIncomeJpy: 14_000_000,
    investmentJpy: 20_000_000,
    stockJpy: 12_000_000,
    metalsJpy: 4_000_000,
    realEstateJpy: 4_000_000,
    mortgageMonths: 12,
    mortgagePaymentJpy: 150_000,
    unbalancedTransactions: 0,
    reconciledCardStatements: 2,
    institutionMappingMismatches: 0,
    salaryDestinationMismatches: 0,
    paypayQrPayments: 36,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) throw new Error(`${key}: expected ${value}, received ${summary[key]}`)
  }
  if (summary.transactions < 300 || summary.journalEntries < 600) {
    throw new Error('demo dump does not contain enough transaction history')
  }
}

export function buildDemoHouseholdDb(outputPath, { force = false } = {}) {
  const databasePath = resolve(outputPath)
  if (existsSync(databasePath)) {
    if (!force) throw new Error(`output already exists: ${databasePath}`)
    rmSync(databasePath)
  }
  mkdirSync(dirname(databasePath), { recursive: true })
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  try {
    for (const migration of migrations) {
      sqlite(databasePath, readFileSync(resolve(migrationsDirectory, migration), 'utf8'))
    }
    sqlite(databasePath, readFileSync(dumpPath, 'utf8'))
    const summary = readDemoSummary(databasePath)
    assertDemoSummary(summary)
    return { databasePath, summary }
  } catch (error) {
    rmSync(databasePath, { force: true })
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv.find((argument) => !argument.startsWith('--') && argument !== process.argv[0] && argument !== process.argv[1])
    ?? resolve(repositoryRoot, 'tmp/demo-tanaka-family.sqlite')
  const result = buildDemoHouseholdDb(outputPath, { force: process.argv.includes('--force') })
  console.log(JSON.stringify(result, null, 2))
}
