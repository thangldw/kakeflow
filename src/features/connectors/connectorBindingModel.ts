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
  const { identities, unresolvedExplicitIdentity } = collectReviewConnectorIdentities(source, inbox)
  const expectedKind = connectorKindForSourceType(source.sourceType)
  if (expectedKind === 'MANUAL_IMPORT') identities.push({ connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import' })
  if (unresolvedExplicitIdentity || expectedKind === null) return null
  const unique = uniqueConnectorIdentities(identities)
  if (unique.size !== 1) return null
  const identity = [...unique.values()][0]
  return typeof expectedKind === 'undefined' || identity.connectorKind === expectedKind ? identity : null
}

export function isReviewConnectorResolutionValid(source: ReviewSourceIdentity, inbox: ReviewInboxRows): boolean {
  const expectedKind = connectorKindForSourceType(source.sourceType)
  if (expectedKind === null) {
    const collected = collectReviewConnectorIdentities(source, inbox)
    return !collected.unresolvedExplicitIdentity && uniqueConnectorIdentities(collected.identities).size === 0
  }
  const hasIdentityHint = Boolean(source.driveInboxItemId || source.gmailInboxItemId || source.folderInboxItemId || source.watchedFolderId || source.importRunId)
  return (typeof expectedKind !== 'undefined' || hasIdentityHint) ? resolveReviewConnector(source, inbox) !== null : true
}

function collectReviewConnectorIdentities(source: ReviewSourceIdentity, inbox: ReviewInboxRows): {
  identities: ReviewConnectorIdentity[]
  unresolvedExplicitIdentity: boolean
} {
  const identities: ReviewConnectorIdentity[] = []
  let unresolvedExplicitIdentity = false
  if (source.driveInboxItemId) {
    const row = inbox.drive.find(({ id }) => id === source.driveInboxItemId)
    if (row) identities.push({ connectorKind: 'GOOGLE_DRIVE', connectionKey: row.connectionId })
    else unresolvedExplicitIdentity = true
  }
  if (source.gmailInboxItemId) {
    const row = inbox.gmail.find(({ id }) => id === source.gmailInboxItemId)
    if (row) identities.push({ connectorKind: 'GMAIL', connectionKey: row.connectionId })
    else unresolvedExplicitIdentity = true
  }
  if (source.folderInboxItemId) {
    const row = inbox.watched.find(({ id }) => id === source.folderInboxItemId)
    if (row) identities.push({ connectorKind: 'WATCHED_FOLDER', connectionKey: row.watchedFolderId })
    else unresolvedExplicitIdentity = true
  }
  if (source.watchedFolderId) {
    identities.push({ connectorKind: 'WATCHED_FOLDER', connectionKey: source.watchedFolderId })
  }
  if (source.importRunId) {
    identities.push(
      ...inbox.drive.filter(({ importRunId }) => importRunId === source.importRunId).map((row) => ({ connectorKind: 'GOOGLE_DRIVE' as const, connectionKey: row.connectionId })),
      ...inbox.gmail.filter(({ importRunId }) => importRunId === source.importRunId).map((row) => ({ connectorKind: 'GMAIL' as const, connectionKey: row.connectionId })),
      ...inbox.watched.filter(({ importRunId }) => importRunId === source.importRunId).map((row) => ({ connectorKind: 'WATCHED_FOLDER' as const, connectionKey: row.watchedFolderId })),
    )
  }
  return { identities, unresolvedExplicitIdentity }
}

function uniqueConnectorIdentities(identities: readonly ReviewConnectorIdentity[]): Map<string, ReviewConnectorIdentity> {
  return new Map(identities.map((identity) => [`${identity.connectorKind}\u0000${identity.connectionKey}`, identity]))
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
  if (!isReviewConnectorResolutionValid(source, inbox)) return []
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
  if (!isReviewConnectorResolutionValid(source, inbox)) return []
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

function connectorKindForSourceType(sourceType: string | null | undefined): ConnectorKindDto | null | undefined {
  if (sourceType === 'GOOGLE_DRIVE') return 'GOOGLE_DRIVE'
  if (sourceType === 'GMAIL') return 'GMAIL'
  if (sourceType === 'LOCAL_FOLDER' || sourceType === 'ICLOUD_PICKER') return 'WATCHED_FOLDER'
  if (sourceType === 'MANUAL_UPLOAD') return 'MANUAL_IMPORT'
  return sourceType == null ? undefined : null
}
