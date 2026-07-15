import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { AttributionScopeDto } from '../../platform/types'

export type AccountGroupKindDto =
  | 'FAMILY' | 'PERSONAL' | 'DAILY_SPENDING' | 'INVESTMENT'
  | 'BUSINESS' | 'TAX' | 'EDUCATION' | 'CUSTOM'

export interface AccountGroupDto {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly groupKind: AccountGroupKindDto
  readonly sortOrder: number
  readonly accountIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateAccountGroupInputDto {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly groupKind: AccountGroupKindDto
  readonly accountIds: readonly string[]
}

export interface UpdateAccountGroupInputDto {
  readonly groupId: string
  readonly householdId: string
  readonly name: string
  readonly groupKind: AccountGroupKindDto
  readonly accountIds: readonly string[]
}

export interface ReorderAccountGroupsInputDto {
  readonly householdId: string
  readonly orderedGroupIds: readonly string[]
}

export type ExportKindDto = 'TRANSACTIONS' | 'PORTFOLIO_SNAPSHOTS'
export type ExportAccountingBasisDto = 'ACCRUAL' | 'CASH'

export interface ExportCsvRequestDto {
  readonly householdId: string
  readonly exportKind: ExportKindDto
  readonly accountingBasis: ExportAccountingBasisDto
  readonly groupId: string | null
  readonly attributionScope: AttributionScopeDto
  readonly fromDate: string
  readonly toDate: string
}

export interface ExportCsvDto {
  readonly fileName: string
  readonly mediaType: 'text/csv;charset=utf-8'
  readonly rowCount: number
  readonly byteSize: number
  readonly utf8BomCsv: string
}

export interface ExportSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
}

export interface TransactionLedgerXlsxSavedDto {
  readonly fileName: string
  readonly rowCount: number
  readonly byteSize: number
  readonly sheetCount: 2
}

export type AccountGroupExportInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createAccountGroupExportPlatform(invoke: AccountGroupExportInvoke = tauriInvoke) {
  return {
    listGroups: async (householdId: string): Promise<readonly AccountGroupDto[]> => {
      const value = await invoke('account_groups_list', { householdId })
      if (!Array.isArray(value)) throw new TypeError('account groups')
      return value.map(parseAccountGroup)
    },
    createGroup: async (input: CreateAccountGroupInputDto): Promise<AccountGroupDto> =>
      parseAccountGroup(await invoke('account_group_create', { input })),
    updateGroup: async (input: UpdateAccountGroupInputDto): Promise<AccountGroupDto> =>
      parseAccountGroup(await invoke('account_group_update', { input })),
    deleteGroup: async (householdId: string, groupId: string): Promise<void> => {
      const value = await invoke('account_group_delete', { householdId, groupId })
      if (value !== null && value !== undefined) throw new TypeError('account group delete')
    },
    reorderGroups: async (input: ReorderAccountGroupsInputDto): Promise<readonly AccountGroupDto[]> => {
      const value = await invoke('account_groups_reorder', { input })
      if (!Array.isArray(value)) throw new TypeError('account groups')
      return value.map(parseAccountGroup)
    },
    generateCsv: async (request: ExportCsvRequestDto): Promise<ExportCsvDto> =>
      parseExportCsv(await invoke('export_csv_generate', { request })),
    saveCsv: async (request: ExportCsvRequestDto): Promise<ExportSavedDto | null> => {
      const value = await invoke('export_csv_save', { request })
      return value === null ? null : parseExportSaved(value)
    },
    saveTransactionLedgerXlsx: async (request: ExportCsvRequestDto): Promise<TransactionLedgerXlsxSavedDto | null> => {
      const value = await invoke('transaction_ledger_xlsx_save', { request })
      return value === null ? null : parseTransactionLedgerXlsxSaved(value)
    },
  }
}

const GROUP_KINDS: readonly AccountGroupKindDto[] = [
  'FAMILY', 'PERSONAL', 'DAILY_SPENDING', 'INVESTMENT',
  'BUSINESS', 'TAX', 'EDUCATION', 'CUSTOM',
]

function parseAccountGroup(value: unknown): AccountGroupDto {
  const item = record(value, 'account group')
  if (!GROUP_KINDS.includes(item.groupKind as AccountGroupKindDto)) throw new TypeError('account group')
  if (!Number.isSafeInteger(item.sortOrder) || (item.sortOrder as number) < 0) throw new TypeError('account group')
  if (!Array.isArray(item.accountIds) || !item.accountIds.every(value => typeof value === 'string')) throw new TypeError('account group')
  return {
    id: string(item.id, 'account group'), householdId: string(item.householdId, 'account group'),
    name: string(item.name, 'account group'), groupKind: item.groupKind as AccountGroupKindDto,
    sortOrder: item.sortOrder as number, accountIds: Object.freeze([...item.accountIds]) as readonly string[],
    createdAt: string(item.createdAt, 'account group'), updatedAt: string(item.updatedAt, 'account group'),
  }
}

function parseExportCsv(value: unknown): ExportCsvDto {
  const item = record(value, 'CSV export')
  if (item.mediaType !== 'text/csv;charset=utf-8') throw new TypeError('CSV export')
  const rowCount = nonNegativeInteger(item.rowCount, 'CSV export')
  const byteSize = nonNegativeInteger(item.byteSize, 'CSV export')
  const utf8BomCsv = string(item.utf8BomCsv, 'CSV export')
  if (!utf8BomCsv.startsWith('\uFEFF') || new TextEncoder().encode(utf8BomCsv).byteLength !== byteSize) throw new TypeError('CSV export')
  return {
    fileName: string(item.fileName, 'CSV export'), mediaType: item.mediaType,
    rowCount, byteSize, utf8BomCsv,
  }
}

function parseExportSaved(value: unknown): ExportSavedDto {
  const item = record(value, 'saved export')
  return {
    fileName: string(item.fileName, 'saved export'),
    rowCount: nonNegativeInteger(item.rowCount, 'saved export'),
    byteSize: nonNegativeInteger(item.byteSize, 'saved export'),
  }
}

function parseTransactionLedgerXlsxSaved(value: unknown): TransactionLedgerXlsxSavedDto {
  const item = record(value, 'saved transaction ledger XLSX')
  const fileName = string(item.fileName, 'saved transaction ledger XLSX')
  const rowCount = nonNegativeInteger(item.rowCount, 'saved transaction ledger XLSX')
  const byteSize = nonNegativeInteger(item.byteSize, 'saved transaction ledger XLSX')
  if (!/\.xlsx$/i.test(fileName) || /[\\/]/.test(fileName) || fileName.length > 255 || byteSize === 0 || item.sheetCount !== 2) throw new TypeError('saved transaction ledger XLSX')
  return { fileName, rowCount, byteSize, sheetCount: 2 }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(label)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(label)
  return value as number
}
