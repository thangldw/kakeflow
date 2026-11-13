import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapParsedImportToStartImport, type HashFn, type IdFactory } from './importMapper'
import { previewImportFile } from './importService'

function deps(): { ids: IdFactory; hash: HashFn } {
  let sequence = 0
  return { ids: { next: (kind) => `${kind}-${++sequence}` }, hash: async (value) => `h${value.length}`.padEnd(64, '0') }
}

describe('OFX and QIF import flow', () => {
  it.each([
    ['ofx-bank.synthetic.ofx', 'bank.ofx', 'ofx-bank-statement-v1', 'application/x-ofx'],
    ['qif-bank.synthetic.qif', 'bank.qif', 'qif-bank-v1', 'application/qif'],
  ])('previews %s as ready and maps it into a StartImport request', async (fixture, name, adapterId, type) => {
    const bytes = readFileSync(`src/ingestion/fixtures/${fixture}`)
    const preview = await previewImportFile(new File([bytes], name, { type }))
    expect(preview).toMatchObject({ status: 'ready', detectedAdapterId: adapterId, recordCount: 2 })

    const mapped = await mapParsedImportToStartImport({
      file: { householdId: 'h1', sourceType: 'MANUAL_UPLOAD', originalFilename: name, mediaType: type, byteSize: bytes.byteLength, sha256: 'a'.repeat(64), accountId: 'bank-1', adapterVersion: '1' },
      detectedAdapterId: preview.detectedAdapterId!, parsed: preview.parsed!,
    }, deps().ids, deps().hash)
    expect(mapped.issues).toEqual([])
    expect(mapped.request.candidates).toHaveLength(2)
    expect(mapped.request.candidates.map((candidate) => [candidate.direction, candidate.amountJpy])).toEqual([['OUT', 1200], ['IN', 250000]])
    if (adapterId === 'ofx-bank-statement-v1') expect(mapped.request.candidates[0].externalTransactionId).toBe('ofx:0001:1234567:20260105-001')
  })

  it('blocks a foreign-currency OFX file in preview', async () => {
    const text = readFileSync('src/ingestion/fixtures/ofx-bank.synthetic.ofx', 'utf8').replace('<CURDEF>JPY', '<CURDEF>USD')
    const preview = await previewImportFile(new File([text], 'usd.ofx'))
    expect(preview.status).toBe('error')
    expect(preview.issues.map((issue) => issue.code)).toContain('OFX_CURRENCY_UNSUPPORTED')
  })
})
