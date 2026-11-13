import { describe, expect, it } from 'vitest'
import type { AccountDto } from '../../platform/types'
import { builtInAdapterVersion, hasCompatibleStandardImportAccount, importAccountDescriptionId, STANDARD_IMPORT_ACCOUNT_REQUIREMENTS } from './importAccountRequirements'
import type { ImportPreview } from './importService'

const account = (accountKind: string, accountSubtype: string) => ({ id: `${accountKind}-${accountSubtype}`, accountKind, accountSubtype }) as unknown as AccountDto

describe('import account requirements', () => {
  it('requires an explicit bank account for OFX/QFX and QIF imports', () => {
    expect(STANDARD_IMPORT_ACCOUNT_REQUIREMENTS['ofx-bank-statement-v1']).toMatchObject({ kind: 'ASSET', subtype: 'BANK' })
    expect(STANDARD_IMPORT_ACCOUNT_REQUIREMENTS['qif-bank-v1']).toMatchObject({ kind: 'ASSET', subtype: 'BANK' })
  })

  it('reports a missing compatible account and passes adapters without a requirement', () => {
    expect(hasCompatibleStandardImportAccount('ofx-bank-statement-v1', [account('LIABILITY', 'CREDIT_CARD')])).toBe(false)
    expect(hasCompatibleStandardImportAccount('ofx-bank-statement-v1', [account('ASSET', 'BANK')])).toBe(true)
    expect(hasCompatibleStandardImportAccount('securities-asset-snapshot-v1', [])).toBe(true)
    expect(hasCompatibleStandardImportAccount(undefined, [])).toBe(true)
    expect(importAccountDescriptionId({ id: 'p1', detectedAdapterId: 'qif-bank-v1' } as ImportPreview, [])).toBe('standard-account-empty-p1')
  })

  it('keeps the two-version adapters on adapter version 2', () => {
    expect(builtInAdapterVersion('personal-japanese-bank-ledger-v2')).toBe('2')
    expect(builtInAdapterVersion('paypay-history-v2')).toBe('2')
    expect(builtInAdapterVersion('ofx-bank-statement-v1')).toBe('1')
  })
})
