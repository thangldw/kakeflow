// SQL-level compatibility evidence only; this does not exercise Keychain or an installed upgrade.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const oldFiles = git('ls-tree', '-r', '--name-only', 'v1.2.1', 'src-tauri/migrations').trim().split('\n').filter(p => p.endsWith('.sql')).sort()
assert.equal(oldFiles.length, 69)
const db = new DatabaseSync(':memory:')
try {
  // Historical migrations edit writable_schema, as the native migration runner permits.
  db.enableDefensive?.(false)
  db.exec('PRAGMA foreign_keys=ON')
  for (const file of oldFiles) {
    const oldSql = git('show', `v1.2.1:${file}`)
    assert.equal(readFileSync(file, 'utf8'), oldSql, `Historical migration changed: ${file}`)
    db.exec(oldSql)
  }
  db.exec("INSERT INTO households(id,name) VALUES('rotation-fixture','Upgrade fixture'); INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('rotation-account','rotation-fixture','Fixture bank','ASSET','BANK')")
  const before = JSON.stringify({ households: db.prepare('SELECT * FROM households ORDER BY id').all(), accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all() })
  const additions = readdirSync('src-tauri/migrations').filter(p => p.endsWith('.sql') && Number(p.slice(0,4)) > 69).sort()
  assert.equal(additions.length, 3)
  for (const file of additions) db.exec(readFileSync(`src-tauri/migrations/${file}`, 'utf8'))
  const after = JSON.stringify({ households: db.prepare('SELECT * FROM households ORDER BY id').all(), accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all() })
  assert.equal(after, before, 'Existing household/account rows changed')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  const oldConfig = JSON.parse(git('show', 'v1.2.1:src-tauri/tauri.conf.json'))
  const newConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  assert.equal(newConfig.identifier, oldConfig.identifier)
  assert.equal(readFileSync('src-tauri/src/key_store.rs', 'utf8'), git('show', 'v1.2.1:src-tauri/src/key_store.rs'))
  console.log('PASS: unchanged 69 historical migrations; 70–72 preserve synthetic household/account rows; integrity and foreign keys valid; app identifier and key-store source unchanged.')
  console.log('LIMIT: SQL fixture test, not SQLCipher, OS Keychain, document vault, or full installer upgrade proof.')
} finally {
  db.close()
}
