import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { importAdapters } from './index'
import type { ImportAdapter, ImportInput, ParsedImport } from './types'

/**
 * Bank and card exports are messy and sometimes hostile. Whatever text an adapter is handed, it must not throw:
 * it either recognises the file and parses it, or reports issues (fail-closed). detect() must give a score in [0, 1].
 */
const adapters = importAdapters as readonly ImportAdapter<unknown>[]
const fixtureDir = join(__dirname, 'fixtures')
const fixtures = readdirSync(fixtureDir).map((name) => readFileSync(join(fixtureDir, name), 'utf8'))

function assertWellFormed(result: ParsedImport<unknown>, adapterId: string) {
  expect(result.adapterId).toBe(adapterId)
  expect(Array.isArray(result.records)).toBe(true)
  expect(Array.isArray(result.issues)).toBe(true)
  for (const issue of result.issues) {
    expect(['warning', 'error']).toContain(issue.severity)
    expect(typeof issue.code).toBe('string')
  }
}

function exercise(adapter: ImportAdapter<unknown>, input: ImportInput) {
  const detection = adapter.detect(input)
  expect(detection.score).toBeGreaterThanOrEqual(0)
  expect(detection.score).toBeLessThanOrEqual(1)
  assertWellFormed(adapter.parse(input), adapter.id)
}

/** Corrupts a real fixture: drops, duplicates, swaps lines and cuts or garbles characters. */
const mutatedFixture = fc.tuple(
  fc.constantFrom(...fixtures),
  fc.array(fc.tuple(fc.constantFrom('drop', 'dup', 'swap', 'cut', 'garble'), fc.nat(), fc.string({ maxLength: 6 })), { maxLength: 6 }),
).map(([text, edits]) => {
  let lines = text.split('\n')
  for (const [kind, seed, noise] of edits) {
    if (lines.length === 0) break
    const index = seed % lines.length
    if (kind === 'drop') lines.splice(index, 1)
    else if (kind === 'dup') lines.splice(index, 0, lines[index])
    else if (kind === 'swap') { const other = (index + 1) % lines.length; [lines[index], lines[other]] = [lines[other], lines[index]] }
    else if (kind === 'cut') lines[index] = lines[index].slice(0, seed % (lines[index].length + 1))
    else lines[index] = lines[index].slice(0, seed % (lines[index].length + 1)) + noise + lines[index].slice(seed % (lines[index].length + 1))
  }
  return lines.join('\n')
})

describe('import adapters never throw on arbitrary input', () => {
  it.each(adapters.map((adapter) => [adapter.id, adapter] as const))('%s: random text', (_id, adapter) => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (text) => { exercise(adapter, { text }) }), { numRuns: 60 })
  })

  it.each(adapters.map((adapter) => [adapter.id, adapter] as const))('%s: delimited random rows', (_id, adapter) => {
    const row = fc.array(fc.oneof(fc.string({ maxLength: 12 }), fc.integer().map(String), fc.constantFrom('', '2026/11/19', '2026-11-19', '¥1,000', '-500', '１２３')), { minLength: 1, maxLength: 12 }).map((cells) => cells.join(','))
    fc.assert(fc.property(fc.array(row, { maxLength: 15 }), (rows) => { exercise(adapter, { text: rows.join('\n') }) }), { numRuns: 60 })
  })

  it.each(adapters.map((adapter) => [adapter.id, adapter] as const))('%s: corrupted real fixtures', (_id, adapter) => {
    fc.assert(fc.property(mutatedFixture, (text) => { exercise(adapter, { text }) }), { numRuns: 60 })
  })

  it('handles empty and whitespace-only input, BOMs and very long lines', () => {
    for (const adapter of adapters) {
      for (const text of ['', ' ', '\n\n', '﻿', '﻿,\n', 'x'.repeat(200_000)]) exercise(adapter, { text })
    }
  })
})
