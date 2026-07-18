import { describe, expect, it } from 'vitest'
import { accountKindLabel, accountSubtypeLabel, brokerageEventTypeLabel, canonicalAccountName, directionLabel, evidenceRoleLabel, memberRoleLabel, sourceTypeLabel, transactionTypeLabel } from './displayLabels'

const text = (source: string) => `translated:${source}`

describe('localized display labels', () => {
  it('localizes canonical categories without changing custom account names', () => {
    expect(canonicalAccountName({ id: 'family-taxes-social-security', name: 'Taxes' }, text)).toBe('translated:税・社会保障')
    expect(canonicalAccountName({ id: 'family-custom-id', name: '旅行積立' }, text)).toBe('translated:旅行積立')
  })

  it('hides internal enum codes behind translated labels', () => {
    expect(accountKindLabel('EXPENSE', text)).toBe('translated:支出')
    expect(accountSubtypeLabel('SECURITIES', text)).toBe('translated:証券')
    expect(transactionTypeLabel('ADJUSTMENT', text)).toBe('translated:調整')
    expect(directionLabel('OUT', text)).toBe('translated:出金')
    expect(sourceTypeLabel('MANUAL_UPLOAD', text)).toBe('translated:手動アップロード')
    expect(evidenceRoleLabel('PRIMARY', text)).toBe('translated:主要証跡')
    expect(brokerageEventTypeLabel('REVERSE_SPLIT', text)).toBe('translated:株式併合')
    expect(memberRoleLabel('OWNER', text)).toBe('translated:所有者')
  })
})
