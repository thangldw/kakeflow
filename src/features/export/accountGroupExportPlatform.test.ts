import { describe, expect, it, vi } from 'vitest'

import { createAccountGroupExportPlatform, type ExportCsvRequestDto } from './accountGroupExportPlatform'

const group = {
  id: 'daily', householdId: 'home', name: 'Daily spending', groupKind: 'DAILY_SPENDING',
  sortOrder: 0, accountIds: ['bank', 'food'], createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z',
} as const

const request: ExportCsvRequestDto = {
  householdId: 'home', exportKind: 'TRANSACTIONS', accountingBasis: 'ACCRUAL',
  groupId: 'daily', fromDate: '2026-07-01', toDate: '2026-07-31',
}

describe('account group and export platform', () => {
  it('maps ordered CRUD commands without broadening their household scope', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'account_group_delete') return null
      if (command === 'account_groups_list' || command === 'account_groups_reorder') return [group]
      return group
    })
    const platform = createAccountGroupExportPlatform(invoke)

    await expect(platform.listGroups('home')).resolves.toEqual([group])
    await expect(platform.createGroup({ id: 'daily', householdId: 'home', name: 'Daily spending', groupKind: 'DAILY_SPENDING', accountIds: ['bank', 'food'] })).resolves.toEqual(group)
    await expect(platform.updateGroup({ groupId: 'daily', householdId: 'home', name: 'Daily spending', groupKind: 'DAILY_SPENDING', accountIds: ['bank', 'food'] })).resolves.toEqual(group)
    await expect(platform.reorderGroups({ householdId: 'home', orderedGroupIds: ['daily'] })).resolves.toEqual([group])
    await expect(platform.deleteGroup('home', 'daily')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('account_groups_list', { householdId: 'home' })
    expect(invoke).toHaveBeenCalledWith('account_group_delete', { householdId: 'home', groupId: 'daily' })
  })

  it('validates generated BOM CSV and native save summaries', async () => {
    const csv = '\uFEFFid,name\r\n1,Tokyo\r\n'
    const encodedSize = new TextEncoder().encode(csv).byteLength
    const invoke = vi.fn(async (command: string) => command === 'export_csv_generate'
      ? { fileName: 'transactions.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1, byteSize: encodedSize, utf8BomCsv: csv }
      : { fileName: 'transactions.csv', rowCount: 1, byteSize: encodedSize })
    const platform = createAccountGroupExportPlatform(invoke)

    await expect(platform.generateCsv(request)).resolves.toMatchObject({ rowCount: 1, utf8BomCsv: csv })
    await expect(platform.saveCsv(request)).resolves.toEqual({ fileName: 'transactions.csv', rowCount: 1, byteSize: encodedSize })
    expect(invoke).toHaveBeenCalledWith('export_csv_generate', { request })
    expect(invoke).toHaveBeenCalledWith('export_csv_save', { request })
  })

  it('rejects malformed group and CSV responses', async () => {
    const malformedGroup = createAccountGroupExportPlatform(async () => [{ ...group, groupKind: 'ALL' }])
    await expect(malformedGroup.listGroups('home')).rejects.toThrow(TypeError)

    const missingBom = createAccountGroupExportPlatform(async () => ({
      fileName: 'bad.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 0, byteSize: 0, utf8BomCsv: '',
    }))
    await expect(missingBom.generateCsv(request)).rejects.toThrow(TypeError)
  })

  it('preserves a cancelled native save', async () => {
    const platform = createAccountGroupExportPlatform(async () => null)
    await expect(platform.saveCsv(request)).resolves.toBeNull()
  })
})
