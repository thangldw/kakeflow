import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export type DelimitedParserDelimiter = 'AUTO' | 'COMMA' | 'TAB' | 'SEMICOLON'
export type DelimitedParserEncoding = 'AUTO' | 'UTF8' | 'CP932'
export type DelimitedParserDateFormat = 'AUTO' | 'YYYY_MM_DD' | 'YYYYMMDD' | 'MM_DD_YYYY' | 'DD_MM_YYYY'
export type DelimitedParserAmountMode = 'SIGNED' | 'DEBIT_CREDIT'

export interface DelimitedParserProfileDto {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly delimiter: DelimitedParserDelimiter
  readonly encoding: DelimitedParserEncoding
  readonly headerRow: number
  readonly dateColumn: string
  readonly dateFormat: DelimitedParserDateFormat
  readonly descriptionColumn: string | null
  readonly payeeColumn: string | null
  readonly amountMode: DelimitedParserAmountMode
  readonly signedPositiveDirection: 'IN' | 'OUT' | null
  readonly signedAmountColumn: string | null
  readonly debitColumn: string | null
  readonly creditColumn: string | null
  readonly externalIdColumn: string | null
  readonly accountHintColumn: string | null
  readonly isEnabled: boolean
  readonly priority: number
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type DelimitedParserProfileDraft = Omit<DelimitedParserProfileDto, 'version' | 'createdAt' | 'updatedAt'>
export type CreateDelimitedParserProfileInputDto = DelimitedParserProfileDraft
export type UpdateDelimitedParserProfileInputDto = Omit<DelimitedParserProfileDraft, 'id'> & { readonly profileId: string; readonly expectedVersion: number }
export interface DeleteDelimitedParserProfileInputDto { readonly householdId: string; readonly profileId: string; readonly expectedVersion: number }

export function delimitedParserProfileDraft(profile: DelimitedParserProfileDto): CreateDelimitedParserProfileInputDto {
  return {
    id: profile.id, householdId: profile.householdId, name: profile.name, delimiter: profile.delimiter, encoding: profile.encoding,
    headerRow: profile.headerRow, dateColumn: profile.dateColumn, dateFormat: profile.dateFormat,
    descriptionColumn: profile.descriptionColumn, payeeColumn: profile.payeeColumn, amountMode: profile.amountMode,
    signedPositiveDirection: profile.signedPositiveDirection, signedAmountColumn: profile.signedAmountColumn,
    debitColumn: profile.debitColumn, creditColumn: profile.creditColumn, externalIdColumn: profile.externalIdColumn,
    accountHintColumn: profile.accountHintColumn, isEnabled: profile.isEnabled, priority: profile.priority,
  }
}

export type DelimitedParserProfileInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createDelimitedParserProfilePlatform(invoke: DelimitedParserProfileInvoke = tauriInvoke) {
  return {
    list: async (householdId: string): Promise<readonly DelimitedParserProfileDto[]> => parseProfiles(await invoke('delimited_parser_profiles_list', { householdId })),
    create: async (input: CreateDelimitedParserProfileInputDto): Promise<DelimitedParserProfileDto> => parseProfile(await invoke('delimited_parser_profile_create', { input })),
    update: async (input: UpdateDelimitedParserProfileInputDto): Promise<DelimitedParserProfileDto> => parseProfile(await invoke('delimited_parser_profile_update', { input })),
    delete: async (input: DeleteDelimitedParserProfileInputDto): Promise<void> => {
      const value = await invoke('delimited_parser_profile_delete', { input })
      if (value !== null && value !== undefined) throw new TypeError('delimited parser profile delete')
    },
  }
}

const delimiters: readonly DelimitedParserDelimiter[] = ['AUTO', 'COMMA', 'TAB', 'SEMICOLON']
const encodings: readonly DelimitedParserEncoding[] = ['AUTO', 'UTF8', 'CP932']
const dateFormats: readonly DelimitedParserDateFormat[] = ['AUTO', 'YYYY_MM_DD', 'YYYYMMDD', 'MM_DD_YYYY', 'DD_MM_YYYY']
const amountModes: readonly DelimitedParserAmountMode[] = ['SIGNED', 'DEBIT_CREDIT']

function parseProfiles(value: unknown): readonly DelimitedParserProfileDto[] {
  if (!Array.isArray(value)) throw new TypeError('delimited parser profiles')
  return Object.freeze(value.map(parseProfile))
}

function parseProfile(value: unknown): DelimitedParserProfileDto {
  const item = record(value)
  if (!delimiters.includes(item.delimiter as DelimitedParserDelimiter) || !encodings.includes(item.encoding as DelimitedParserEncoding) || !dateFormats.includes(item.dateFormat as DelimitedParserDateFormat) || !amountModes.includes(item.amountMode as DelimitedParserAmountMode)) throw new TypeError('delimited parser profile')
  const profile: DelimitedParserProfileDto = {
    id: string(item.id), householdId: string(item.householdId), name: string(item.name),
    delimiter: item.delimiter as DelimitedParserDelimiter, encoding: item.encoding as DelimitedParserEncoding,
    headerRow: boundedInteger(item.headerRow, 1, 1000), dateColumn: string(item.dateColumn), dateFormat: item.dateFormat as DelimitedParserDateFormat,
    descriptionColumn: nullableString(item.descriptionColumn), payeeColumn: nullableString(item.payeeColumn), amountMode: item.amountMode as DelimitedParserAmountMode,
    signedPositiveDirection: item.signedPositiveDirection === null ? null : enumValue<'IN' | 'OUT'>(item.signedPositiveDirection, ['IN', 'OUT']),
    signedAmountColumn: nullableString(item.signedAmountColumn), debitColumn: nullableString(item.debitColumn), creditColumn: nullableString(item.creditColumn),
    externalIdColumn: nullableString(item.externalIdColumn), accountHintColumn: nullableString(item.accountHintColumn), isEnabled: boolean(item.isEnabled),
    priority: boundedInteger(item.priority, 0, 10000), version: positiveInteger(item.version), createdAt: string(item.createdAt), updatedAt: string(item.updatedAt),
  }
  if (!profile.name.trim() || !profile.dateColumn.trim() || (!profile.descriptionColumn?.trim() && !profile.payeeColumn?.trim())) throw new TypeError('delimited parser profile')
  const validAmountTuple = profile.amountMode === 'SIGNED'
    ? Boolean(profile.signedPositiveDirection && profile.signedAmountColumn?.trim() && !profile.debitColumn && !profile.creditColumn)
    : Boolean(profile.signedPositiveDirection === null && !profile.signedAmountColumn && profile.debitColumn?.trim() && profile.creditColumn?.trim())
  if (!validAmountTuple) throw new TypeError('delimited parser profile')
  const mappedColumns = [profile.dateColumn, profile.descriptionColumn, profile.payeeColumn, profile.signedAmountColumn, profile.debitColumn, profile.creditColumn, profile.externalIdColumn, profile.accountHintColumn]
    .filter((column): column is string => Boolean(column?.trim())).map((column) => column.trim())
  if (new Set(mappedColumns).size !== mappedColumns.length) throw new TypeError('delimited parser profile')
  return Object.freeze(profile)
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('delimited parser profile')
  return value as Record<string, unknown>
}
function string(value: unknown): string { if (typeof value !== 'string') throw new TypeError('delimited parser profile'); return value }
function nullableString(value: unknown): string | null { if (value === null) return null; return string(value) }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new TypeError('delimited parser profile'); return value }
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T { if (typeof value !== 'string' || !allowed.includes(value as T)) throw new TypeError('delimited parser profile'); return value as T }
function integer(value: unknown): number { if (!Number.isSafeInteger(value)) throw new TypeError('delimited parser profile'); return value as number }
function positiveInteger(value: unknown): number { const parsed = integer(value); if (parsed < 1) throw new TypeError('delimited parser profile'); return parsed }
function boundedInteger(value: unknown, minimum: number, maximum: number): number { const parsed = integer(value); if (parsed < minimum || parsed > maximum) throw new TypeError('delimited parser profile'); return parsed }

export const delimitedParserProfilePlatform = createDelimitedParserProfilePlatform()
