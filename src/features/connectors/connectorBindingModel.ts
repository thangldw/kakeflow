import type {
  AccountDto,
  ConnectorBindingDto,
  ConnectorKindDto,
  GmailInboxItemDto,
  GoogleDriveInboxItemDto,
  WatchedFileInboxItemDto,
} from '../../platform/types'

export interface ReviewSourceIdentity {
  readonly sourceType?: string | null
  readonly driveInboxItemId?: string | null
  readonly gmailInboxItemId?: string | null
  readonly folderInboxItemId?: string | null
  readonly watchedFolderId?: string | null
  readonly importRunId?: string | null
}

export interface ReviewInboxRows {
  readonly drive: readonly GoogleDriveInboxItemDto[]
  readonly gmail: readonly GmailInboxItemDto[]
  readonly watched: readonly WatchedFileInboxItemDto[]
}

export interface ReviewConnectorIdentity {
  readonly connectorKind: ConnectorKindDto
  readonly connectionKey: string
}

export interface VersionedParserOption {
  readonly id: string
  readonly version: number
}

export function resolveReviewConnector(source: ReviewSourceIdentity, inbox: ReviewInboxRows): ReviewConnectorIdentity | null {
  if (source.driveInboxItemId) {
    const row = inbox.drive.find(({ id }) => id === source.driveInboxItemId)
    return row ? { connectorKind: 'GOOGLE_DRIVE', connectionKey: row.connectionId } : null
  }
  if (source.gmailInboxItemId) {
    const row = inbox.gmail.find(({ id }) => id === source.gmailInboxItemId)
    return row ? { connectorKind: 'GMAIL', connectionKey: row.connectionId } : null
  }
  if (source.folderInboxItemId) {
    const row = inbox.watched.find(({ id }) => id === source.folderInboxItemId)
    return row ? { connectorKind: 'WATCHED_FOLDER', connectionKey: row.watchedFolderId } : null
  }
  if (source.watchedFolderId) {
    return { connectorKind: 'WATCHED_FOLDER', connectionKey: source.watchedFolderId }
  }
  if (source.importRunId) {
    const drive = inbox.drive.find(({ importRunId }) => importRunId === source.importRunId)
    if (drive) return { connectorKind: 'GOOGLE_DRIVE', connectionKey: drive.connectionId }
    const gmail = inbox.gmail.find(({ importRunId }) => importRunId === source.importRunId)
    if (gmail) return { connectorKind: 'GMAIL', connectionKey: gmail.connectionId }
    const watched = inbox.watched.find(({ importRunId }) => importRunId === source.importRunId)
    if (watched) return { connectorKind: 'WATCHED_FOLDER', connectionKey: watched.watchedFolderId }
  }
  return source.sourceType === 'MANUAL_UPLOAD'
    ? { connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import' }
    : null
}

export function bindingForReviewSource(
  source: ReviewSourceIdentity,
  bindings: readonly ConnectorBindingDto[],
  inbox: ReviewInboxRows,
): ConnectorBindingDto | null {
  const identity = resolveReviewConnector(source, inbox)
  if (!identity) return null
  return bindings.find((binding) => binding.connectorKind === identity.connectorKind && binding.connectionKey === identity.connectionKey) ?? null
}

export function filterReviewAccountOptions<T extends Pick<AccountDto, 'id'>>(
  source: ReviewSourceIdentity,
  accounts: readonly T[],
  bindings: readonly ConnectorBindingDto[],
  inbox: ReviewInboxRows,
): readonly T[] {
  const binding = bindingForReviewSource(source, bindings, inbox)
  if (!binding) return accounts
  const allowed = new Set(binding.allowedAccountIds)
  return accounts.filter(({ id }) => allowed.has(id))
}

export function filterReviewParserOptions<T extends VersionedParserOption>(
  source: ReviewSourceIdentity,
  profiles: readonly T[],
  bindings: readonly ConnectorBindingDto[],
  inbox: ReviewInboxRows,
): readonly T[] {
  const binding = bindingForReviewSource(source, bindings, inbox)
  if (!binding?.parserProfileId || binding.parserProfileVersion === null) return profiles
  return profiles.filter(({ id, version }) => id === binding.parserProfileId && version === binding.parserProfileVersion)
}

export function sanitizeReviewSelections<T extends VersionedParserOption>(input: {
  readonly source: ReviewSourceIdentity
  readonly accounts: readonly Pick<AccountDto, 'id'>[]
  readonly profiles: readonly T[]
  readonly bindings: readonly ConnectorBindingDto[]
  readonly inbox: ReviewInboxRows
  readonly selectedAccountIds: readonly string[]
  readonly selectedParser: VersionedParserOption | null
}): { readonly selectedAccountIds: readonly string[]; readonly selectedParser: VersionedParserOption | null; readonly needsRemapping: boolean } {
  const allowedAccounts = new Set(filterReviewAccountOptions(input.source, input.accounts, input.bindings, input.inbox).map(({ id }) => id))
  const selectedAccountIds = input.selectedAccountIds.filter((id) => allowedAccounts.has(id))
  const allowedProfiles = filterReviewParserOptions(input.source, input.profiles, input.bindings, input.inbox)
  const selectedParser = input.selectedParser && allowedProfiles.some(({ id, version }) => id === input.selectedParser?.id && version === input.selectedParser.version)
    ? input.selectedParser
    : null
  return {
    selectedAccountIds,
    selectedParser,
    needsRemapping: selectedAccountIds.length !== input.selectedAccountIds.length || (input.selectedParser !== null && selectedParser === null),
  }
}

export function isStagedReviewBindingValid(input: {
  readonly binding: ConnectorBindingDto | null
  readonly candidateAccountIds: readonly (string | null)[]
  readonly activeAccountIds: readonly string[]
  readonly adapterId: string | null
  readonly adapterVersion: string | null
}): boolean {
  if (!input.binding) return true
  const active = new Set(input.activeAccountIds)
  const allowed = new Set(input.binding.allowedAccountIds)
  if (input.candidateAccountIds.length === 0 || input.candidateAccountIds.some((id) => id === null || !active.has(id) || !allowed.has(id))) return false
  if (input.binding.parserProfileId === null || input.binding.parserProfileVersion === null) return true
  return input.adapterId === 'custom-delimited-v1'
    && input.adapterVersion === `${input.binding.parserProfileId}@${input.binding.parserProfileVersion}`
}
