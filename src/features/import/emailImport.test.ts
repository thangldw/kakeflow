import { describe, expect, it } from 'vitest'
import { EmailImportError, extractSingleEmailTabularAttachment, qualifyEmailParsedImport } from './emailImport'

function eml(attachments: readonly { name: string; type?: string; content: string; disposition?: string }[]): Uint8Array {
  const boundary = 'kakeflow-test-boundary'
  const parts = attachments.map((attachment) => [
    `--${boundary}`,
    `Content-Type: ${attachment.type ?? 'text/csv'}; name="${attachment.name}"`,
    `Content-Disposition: ${attachment.disposition ?? 'attachment'}; filename="${attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(attachment.content).toString('base64'),
  ].join('\r\n'))
  return new TextEncoder().encode([
    'From: statements@example.test',
    'To: household@example.test',
    'Subject: Statement',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts,
    `--${boundary}--`,
    '',
  ].join('\r\n'))
}

describe('email attachment ingestion', () => {
  it('extracts one tabular attachment without changing its bytes', async () => {
    const content = '日付,摘要\n2026/07/01,給与'
    const attachment = await extractSingleEmailTabularAttachment(eml([{ name: 'statement.csv', content }]))
    expect(attachment).toMatchObject({ name: 'statement.csv', mediaType: 'text/csv' })
    expect(new TextDecoder().decode(attachment.bytes)).toBe(content)
  })

  it('ignores inline presentation assets but never auto-selects between financial attachments', async () => {
    const bytes = eml([
      { name: 'logo.png', type: 'image/png', disposition: 'inline', content: 'image' },
      { name: 'bank.csv', content: 'a,b' },
      { name: 'card.tsv', type: 'text/tab-separated-values', content: 'a\tb' },
    ])
    await expect(extractSingleEmailTabularAttachment(bytes)).rejects.toMatchObject({ code: 'EMAIL_MULTIPLE_SUPPORTED_ATTACHMENTS' } satisfies Partial<EmailImportError>)
  })

  it('ignores an unnamed inline MIME part without weakening attachment selection', async () => {
    const boundary = 'unnamed-inline'
    const source = [
      'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: image/png', 'Content-Disposition: inline', '', 'image',
      `--${boundary}`, 'Content-Type: text/csv; name="bank.csv"', 'Content-Disposition: attachment; filename="bank.csv"', '', 'a,b',
      `--${boundary}--`, '',
    ].join('\r\n')
    const attachment = await extractSingleEmailTabularAttachment(new TextEncoder().encode(source))
    expect(attachment.name).toBe('bank.csv')
  })

  it('qualifies every nested source lineage with its attachment part', () => {
    const parsed = qualifyEmailParsedImport({
      adapterId: 'paypay-history-v1', issues: [], metadata: {}, records: [{
        kind: 'wallet-event', transactionId: 'x', occurredAt: null, counterparty: '', eventType: '', totalOutgoing: 0, totalIncoming: 0,
        legs: [{ lineage: { sourceRow: 2, sourceRowEnd: 2, rawFields: ['x'] }, transactionType: '', outgoingAmount: null, incomingAmount: null, paymentOption: '', funding: [] }],
      }],
    }, 'paypay.csv')
    expect((parsed.records[0] as { legs: { lineage: { sourcePart?: string } }[] }).legs[0].lineage.sourcePart).toBe('paypay.csv')
    expect(parsed.metadata).toMatchObject({ container: 'RFC5322_EMAIL', attachmentName: 'paypay.csv' })
  })
})
