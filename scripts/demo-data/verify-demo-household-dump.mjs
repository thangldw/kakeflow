import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildDemoHouseholdDb } from './build-demo-household-db.mjs'

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'kakeflow-demo-'))
try {
  const result = buildDemoHouseholdDb(resolve(temporaryDirectory, 'tanaka-family.sqlite'))
  console.log(JSON.stringify(result.summary, null, 2))
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
