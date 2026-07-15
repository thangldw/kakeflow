export interface DatabaseStatusDto {
  readonly healthy: boolean
  readonly schemaVersion: number
}

export interface AppBootstrapDto {
  readonly application: string
  readonly database: DatabaseStatusDto
}

export interface AppHealthDto {
  readonly status: 'ok' | 'degraded'
  readonly database: DatabaseStatusDto
}

export interface AppStatusDto {
  readonly schemaVersion: number
  readonly integrity: 'ok' | 'failed'
}

export interface HouseholdDto {
  readonly id: string
  readonly name: string
  readonly baseCurrency: 'JPY'
  readonly createdAt: string
}

export interface CreateHouseholdInputDto {
  readonly id: string
  readonly name: string
}

export type HouseholdMemberStatusDto = 'ACTIVE' | 'ARCHIVED'
export interface HouseholdMemberDto {
  readonly id: string
  readonly householdId: string
  readonly displayName: string
  readonly relationshipLabel: string | null
  readonly status: HouseholdMemberStatusDto
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
}
export interface CreateHouseholdMemberInputDto {
  readonly id: string
  readonly householdId: string
  readonly displayName: string
  readonly relationshipLabel: string | null
}
export interface UpdateHouseholdMemberInputDto {
  readonly householdId: string
  readonly memberId: string
  readonly displayName: string
  readonly relationshipLabel: string | null
  readonly sortOrder: number
}

export type AccountOwnershipKindDto = 'HOUSEHOLD' | 'MEMBER'
export type AccountVisibilityDto = 'SHARED' | 'PERSONAL'
export type AudienceVisibilityDto = AccountVisibilityDto
export type AttributionKindDto = 'HOUSEHOLD' | 'MEMBER'
export type AttributionScopeDto =
  | { readonly kind: 'ALL' }
  | { readonly kind: 'HOUSEHOLD_COMMON' }
  | { readonly kind: 'MEMBER'; readonly memberId: string }
export interface AccountDto {
  readonly id: string
  readonly name: string
  readonly accountKind: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
  readonly accountSubtype: 'BANK' | 'CASH' | 'WALLET' | 'SECURITIES' | 'CREDIT_CARD' | 'RECEIVABLE' | 'OTHER'
  readonly currency: 'JPY'
  readonly ownershipKind: AccountOwnershipKindDto
  readonly ownerMemberId: string | null
  readonly ownerMemberName: string | null
  readonly visibility: AccountVisibilityDto
}
export interface CreateAccountInputDto { readonly id: string; readonly householdId: string; readonly name: string; readonly accountKind: AccountDto['accountKind']; readonly accountSubtype: AccountDto['accountSubtype']; readonly currency: 'JPY'; readonly ownershipKind: AccountOwnershipKindDto; readonly ownerMemberId: string | null; readonly visibility: AccountVisibilityDto }
export interface RenameAccountInputDto { readonly householdId: string; readonly accountId: string; readonly name: string }
export interface ArchiveAccountInputDto { readonly householdId: string; readonly accountId: string }
export interface UpdateAccountOwnershipInputDto { readonly householdId: string; readonly accountId: string; readonly ownershipKind: AccountOwnershipKindDto; readonly ownerMemberId: string | null; readonly visibility: AccountVisibilityDto }

export interface ImportSourceRecordDto { readonly id: string; readonly rowNumber: number; readonly recordHash: string; readonly payloadJson: string }
export interface ImportEvidenceDto { readonly sourceRecordId: string; readonly role: 'PRIMARY' | 'FUNDING_LEG' | 'REWARD_LEG' | 'CONTINUATION' | 'SUPPORTING' }
export interface NormalizedCandidateDto {
  readonly id: string; readonly accountId: string | null; readonly occurredOn: string; readonly postedOn: string | null
  readonly amountJpy: number; readonly direction: 'IN' | 'OUT'; readonly descriptionRaw: string | null
  readonly merchantRaw: string | null; readonly externalTransactionId: string | null
  readonly externalSource: 'MONEY_FORWARD_ME' | null; readonly externalFactHash: string | null
  readonly calculationTarget: boolean; readonly suggestedTransactionType: 'TRANSFER' | null
  readonly institutionRaw: string | null; readonly categoryMajorRaw: string | null; readonly categoryMinorRaw: string | null; readonly memoRaw: string | null
  readonly extractionConfidenceBps: number | null; readonly normalizationConfidenceBps: number | null
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly reviewStatus: 'PENDING' | 'READY' | 'DUPLICATE' | 'EXCLUDED'; readonly evidence: readonly ImportEvidenceDto[]
}
export interface StartImportDto {
  readonly runId: string; readonly documentId: string; readonly householdId: string
  readonly sourceType: 'LOCAL_FOLDER' | 'ICLOUD_PICKER' | 'GOOGLE_DRIVE' | 'GMAIL' | 'MANUAL_UPLOAD' | 'CAMERA_SCAN' | 'OTHER'
  readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly sourceModifiedAt: string | null; readonly adapterId: string | null; readonly adapterVersion: string | null
  readonly records: readonly ImportSourceRecordDto[]; readonly candidates: readonly NormalizedCandidateDto[]
  readonly cardStatements: readonly StartImportCardStatementDto[]
}
export interface StartImportCardStatementDto {
  readonly id: string; readonly cardAccountId: string; readonly issuer: string
  readonly periodStart: string; readonly periodEnd: string; readonly paymentDueOn: string | null
  readonly statementAmountJpy: number
  readonly lines: readonly { readonly candidateId: string; readonly statementLineNumber: number; readonly billedAmountJpy: number }[]
}
export interface ImportSummaryDto { readonly runId: string; readonly documentId: string; readonly status: string; readonly recordCount: number; readonly candidateCount: number; readonly reusedExisting: boolean }
export interface ReceiptReviewProvenanceDto { readonly lineNumber: number; readonly regionIndexes: readonly number[]; readonly method: 'TEXT_PATTERN' }
export interface ReceiptReviewItemDto { readonly description: string; readonly quantity: number | null; readonly amountJpy: number; readonly taxRatePercent: 8 | 10 | null; readonly confidenceBps: number; readonly provenance: ReceiptReviewProvenanceDto }
export interface ReceiptReviewTaxDto { readonly ratePercent: 8 | 10; readonly taxAmountJpy: number | null; readonly taxableAmountJpy: number | null; readonly confidenceBps: number; readonly provenance: ReceiptReviewProvenanceDto }
export interface ReceiptReviewAdjustmentDto { readonly amountJpy: number | null; readonly confidenceBps: number; readonly provenance: ReceiptReviewProvenanceDto }
export interface ReceiptReviewDto {
  readonly merchant: string | null; readonly occurredOn: string | null; readonly totalAmountJpy: number
  readonly items: readonly ReceiptReviewItemDto[]; readonly taxes: readonly ReceiptReviewTaxDto[]
  readonly couponAmountJpy: number | null; readonly pointsUsedJpy: number | null
  readonly couponEvidence: readonly ReceiptReviewAdjustmentDto[]; readonly pointsUsedEvidence: readonly ReceiptReviewAdjustmentDto[]
  readonly subtotalJpy: number | null; readonly changeJpy: number | null; readonly paymentMethod: string | null
  readonly taxMode: 'INCLUDED' | 'EXCLUDED' | 'MIXED' | null
  readonly reconciliation: { readonly status: 'EXACT' | 'DELTA' | 'NO_ITEMS'; readonly itemTotalJpy: number | null; readonly totalAmountJpy: number | null; readonly deltaJpy: number | null } | null
  readonly provenance: { readonly sourceRecordId: string; readonly sourceRowNumber: number; readonly documentPageNumber: number | null }
}
export interface PreviewCandidateDto extends Omit<NormalizedCandidateDto, 'evidence'> { readonly evidenceCount: number; readonly evidenceRoles: readonly string[]; readonly issues: readonly string[]; readonly receiptReview: ReceiptReviewDto | null }
export interface ImportPreviewDto {
  readonly summary: ImportSummaryDto
  readonly source: { readonly sourceType: string; readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string; readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null }
  readonly candidates: readonly PreviewCandidateDto[]
}
export interface PendingReviewRunDto {
  readonly runId: string
  readonly documentId: string
  readonly status: 'REVIEW_REQUIRED'
  readonly adapterId: string | null
  readonly adapterVersion: string | null
  readonly startedAt: string
  readonly sourceType: string
  readonly originalFilename: string
  readonly mediaType: string
  readonly byteSize: number
  readonly sourceModifiedAt: string | null
  readonly recordCount: number
  readonly candidateCount: number
  readonly completionState: 'CANDIDATE_REVIEW' | 'SOURCE_READY' | 'SOURCE_RESUME_REQUIRED'
}
export interface PendingReviewListDto {
  readonly householdId: string
  readonly runs: readonly PendingReviewRunDto[]
}
export interface JournalEntryDecisionDto { readonly id: string; readonly accountId: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number }
export interface PostingDecisionDto {
  readonly candidateId: string; readonly transactionId: string; readonly transactionType: string
  readonly payee: string | null; readonly description: string | null; readonly entries: readonly JournalEntryDecisionDto[]
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly calculationTarget: boolean
}
export interface CommitSummaryDto { readonly runId: string; readonly postedCount: number }
export interface ReceiptMatchSuggestionDto {
  readonly candidateId: string; readonly transactionId: string; readonly occurredOn: string
  readonly payee: string | null; readonly description: string | null; readonly transactionType: 'EXPENSE' | 'CARD_PURCHASE'
  readonly amountJpy: number; readonly dayDifference: number; readonly merchantSimilarityBps: number
  readonly scoreBps: number; readonly reasons: readonly string[]
}
export interface ReceiptMatchConfirmationDto {
  readonly runId: string; readonly candidateId: string; readonly transactionId: string
  readonly resolutionStatus: 'LINKED'; readonly evidenceCount: number; readonly runStatus: string
}
export interface BackupSummaryDto { readonly formatVersion: 2; readonly entryCount: number; readonly plaintextBytes: number }
export interface EvidenceBundleSummaryDto {
  readonly bundleId: string
  readonly householdId: string
  readonly originInstallationId: string
  readonly documentCount: number
  readonly recordCount: number
  readonly plaintextBytes: number
  readonly importedDocumentCount: number
  readonly deduplicatedDocumentCount: number
}
export interface PendingImportExportRequestDto { readonly householdId: string; readonly runId: string }
export interface PendingImportExportSummaryDto {
  readonly packageId: string; readonly schemaVersion: 1; readonly householdId: string
  readonly portableRunId: string; readonly manifestSha256: string; readonly sourceSha256: string
  readonly recordCount: number; readonly candidateCount: number; readonly statementCount: number; readonly byteSize: number
}
export interface PendingImportAccountDependencyDto {
  readonly portableAccountId: string; readonly name: string; readonly accountKind: AccountDto['accountKind']
  readonly accountSubtype: AccountDto['accountSubtype'] | null; readonly currency: string
  readonly institutionName: string | null; readonly maskedIdentifier: string | null
}
export interface PendingImportMemberDependencyDto {
  readonly portableMemberId: string; readonly displayName: string; readonly role: string
}
export interface PendingImportStageDto {
  readonly packageId: string; readonly schemaVersion: 1; readonly originInstallationId: string
  readonly portableRunId: string; readonly manifestSha256: string; readonly sourceFilename: string; readonly sourceSha256: string
  readonly recordCount: number; readonly candidateCount: number; readonly statementCount: number
  readonly accountDependencies: readonly PendingImportAccountDependencyDto[]
  readonly memberDependencies: readonly PendingImportMemberDependencyDto[]
  readonly alreadyApplied: boolean; readonly existingLocalRunId: string | null
}
export interface PendingImportAccountMappingDto { readonly portableAccountId: string; readonly localAccountId: string }
export interface PendingImportMemberMappingDto { readonly portableMemberId: string; readonly localMemberId: string }
export interface PendingImportMappingsDto {
  readonly accounts: readonly PendingImportAccountMappingDto[]
  readonly members: readonly PendingImportMemberMappingDto[]
}
export interface PendingImportApplySummaryDto {
  readonly packageId: string; readonly localRunId: string; readonly localDocumentId: string
  readonly recordCount: number; readonly candidateCount: number; readonly statementCount: number; readonly reusedExisting: boolean
}
export interface LocalSyncIdentityDto { readonly id: string; readonly displayName: string; readonly createdAt: string }
export interface PrincipalMemberBindingDto {
  readonly householdId: string; readonly principalId: string
  readonly memberId: string | null; readonly memberName: string | null; readonly updatedAt: string
}
export interface LocalSyncFoundationStatusDto {
  readonly device: LocalSyncIdentityDto; readonly platform: 'MACOS' | 'WINDOWS' | 'OTHER'
  readonly principal: LocalSyncIdentityDto; readonly binding: PrincipalMemberBindingDto
  readonly outbox: { readonly envelopeCount: number; readonly latestSequence: number; readonly latestRecordedAt: string | null }
  readonly remoteTransport: 'NOT_CONFIGURED'; readonly restoreValidation: 'ENABLED'
}
export interface UpdatePrincipalMemberBindingInputDto {
  readonly householdId: string; readonly principalId: string; readonly memberId: string | null; readonly mutationId: string
}
export type DesktopRelayConnectionStateDto = 'NOT_CONFIGURED' | 'CONNECTED' | 'DEGRADED'
export type DesktopRelayDeliveryStateDto = 'IDLE' | 'SENDING' | 'ACCEPTED' | 'FAILED_RETRYABLE'
export type DesktopRelayInboundStateDto = 'AVAILABLE' | 'WAITING_FOR_REVIEW' | 'DUPLICATE' | 'REJECTED_INVALID' | 'FAILED_RETRYABLE'
export interface DesktopRelayInboundArtifactDto {
  readonly artifactId: string; readonly digest: string; readonly createdAt: string
  readonly originDeviceId: string; readonly state: DesktopRelayInboundStateDto
}
export interface DesktopRelayStatusDto {
  readonly householdId: string; readonly connectionState: DesktopRelayConnectionStateDto
  readonly localDeviceId: string
  readonly remotePrincipalId: string | null; readonly endpoint: string | null
  readonly outbound: {
    readonly pendingEnvelopeCount: number; readonly totalEnvelopeCount: number
    readonly deliveryState: DesktopRelayDeliveryStateDto; readonly latestAcceptedAt: string | null
  }
  readonly inbound: readonly DesktopRelayInboundArtifactDto[]
}
export interface SaveDesktopRelayConnectionInputDto {
  readonly householdId: string; readonly endpoint: string; readonly remotePrincipalId: string
}
export interface DesktopRelayPreparedDeliveryDto {
  readonly deliveryId: string; readonly artifactId: string; readonly digest: string
  readonly householdId: string; readonly originDeviceId: string; readonly packageBytes: readonly number[]
}
export interface AcceptDesktopRelayDeliveryInputDto {
  readonly householdId: string; readonly deliveryId: string; readonly artifactId: string
  readonly digest: string; readonly acceptedAt: string
}
export interface DesktopRelayRemoteArtifactDto {
  readonly artifactId: string; readonly digest: string; readonly createdAt: string; readonly originDeviceId: string
}
export interface RegisterDesktopRelayInboundInputDto {
  readonly householdId: string; readonly artifacts: readonly DesktopRelayRemoteArtifactDto[]
}
export interface StageDesktopRelayInboundInputDto {
  readonly householdId: string; readonly artifactId: string; readonly packageBytes: readonly number[]
}
export type FamilyDeliveryConnectionStateDto = 'NOT_CONFIGURED' | 'CONNECTED' | 'AUTH_EXPIRED' | 'NETWORK_UNAVAILABLE' | 'MEMBERSHIP_REVOKED'
export type FamilyMembershipStateDto = 'UNLINKED' | 'INVITED' | 'ACTIVE' | 'REVOKED' | 'ARCHIVED_BLOCKED'
export type FamilyOutboundStateDto = 'READY' | 'BLOCKED_NO_RECIPIENT' | 'SENDING' | 'RELAY_ACCEPTED' | 'FAILED_RETRYABLE' | 'MEMBERSHIP_REVOKED'
export type FamilyInboundStateDto = 'AVAILABLE' | 'DOWNLOADING' | 'WAITING_FOR_REVIEW' | 'READY_TO_APPLY' | 'APPLIED' | 'DUPLICATE' | 'REJECTED_INVALID' | 'AUDIENCE_DENIED' | 'FAILED_RETRYABLE'
export type FamilyDeliveryArtifactSchemaDto = 'FAMILY_AUDIENCE_PARTITION_V1' | 'FAMILY_AUDIENCE_PARTITION_V2' | 'FAMILY_AUDIENCE_PARTITION_V3'
export type FamilyDeliveryDomainDto = 'LEDGER' | 'PLANNING' | 'CONFIG' | 'CARD' | 'INVESTMENT'
export type FamilyDeliveryCoverageStateDto = 'COMPLETE' | 'PARTIAL'
export type FamilyDeliveryDomainCountsDto = Readonly<Record<FamilyDeliveryDomainDto, number>>
export type FamilyDeliveryWithheldCountsDto = Readonly<Record<string, number>>
export interface FamilyDeliveryMembershipDto {
  readonly memberId: string; readonly memberName: string; readonly state: FamilyMembershipStateDto
  readonly remoteMembershipIds: readonly string[]
  readonly inviteId: string | null; readonly inviteExpiresAt: string | null
  readonly deviceCount: number; readonly lastDeliveryAt: string | null
}
export interface FamilyDeliveryPartitionDto {
  readonly audienceKey: string; readonly audienceVisibility: AudienceVisibilityDto
  readonly audienceMemberId: string | null; readonly audienceMemberName: string | null
  readonly recipientNames: readonly string[]; readonly pendingChangeCount: number
  readonly state: FamilyOutboundStateDto; readonly withheldReason: string | null
  readonly domainCounts: FamilyDeliveryDomainCountsDto
  readonly withheldDomainCounts: FamilyDeliveryDomainCountsDto
  readonly evidenceFileCount: number; readonly evidenceRecordCount: number
  readonly withheldCountsByReason: FamilyDeliveryWithheldCountsDto
  readonly coverageState: FamilyDeliveryCoverageStateDto
}
export interface FamilyDeliveryInboundDto {
  readonly artifactId: string; readonly senderMemberName: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberName: string | null
  readonly itemCount: number; readonly createdAt: string; readonly state: FamilyInboundStateDto
  readonly receivedBeforeRevocation: boolean
}
export interface FamilyDeliveryStatusDto {
  readonly householdId: string; readonly connectionState: FamilyDeliveryConnectionStateDto
  readonly endpoint: string | null; readonly remotePrincipalId: string | null
  readonly localDeviceId: string; readonly inboundCursor: number
  readonly localMemberId: string | null; readonly localMemberName: string | null
  readonly memberships: readonly FamilyDeliveryMembershipDto[]
  readonly outbound: readonly FamilyDeliveryPartitionDto[]; readonly withheldChangeCount: number
  readonly inbound: readonly FamilyDeliveryInboundDto[]
}
export interface SaveFamilyDeliveryConnectionInputDto {
  readonly householdId: string; readonly endpoint: string
  readonly remotePrincipalId: string
  readonly localMemberId: string | null; readonly localMemberName: string | null
  readonly memberships: readonly FamilyDeliveryMembershipDto[]
}
export interface RegisterFamilyDeliveryRemoteStateInputDto {
  readonly householdId: string; readonly remotePrincipalId: string
  readonly localMemberId: string | null; readonly localMemberName: string | null
  readonly memberships: readonly FamilyDeliveryMembershipDto[]
}
export interface FamilyDeliveryPreparedArtifactDto {
  readonly deliveryId: string; readonly artifactId: string; readonly digest: string
  readonly householdId: string; readonly originDeviceId: string; readonly audienceKey: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly artifactSchema: FamilyDeliveryArtifactSchemaDto; readonly packageBytes: readonly number[]
}
export interface FamilyEnvelopePublicIdentityDto {
  readonly keyId: string; readonly publicKey: string; readonly generation: number
}
export interface FamilyEnvelopeRecipientDto extends FamilyEnvelopePublicIdentityDto { readonly membershipId: string }
export interface FamilyEnvelopeMetadataDto {
  readonly householdId: string; readonly publicationId: string; readonly originInstallationId: string
  readonly artifactSchema: FamilyDeliveryArtifactSchemaDto; readonly innerSha256: string
}
export interface SealFamilyEnvelopeInputDto {
  readonly metadata: FamilyEnvelopeMetadataDto; readonly artifactBytes: readonly number[]
  readonly recipients: readonly FamilyEnvelopeRecipientDto[]
}
export interface PrepareEncryptedFamilyEnvelopeInputDto {
  readonly deliveryId: string; readonly metadata: FamilyEnvelopeMetadataDto
  readonly recipients: readonly FamilyEnvelopeRecipientDto[]; readonly recipientSetDigest: string
}
export interface SealFamilyEnvelopeOutputDto {
  readonly envelopeBytes: readonly number[]; readonly envelopeSha256: string
  readonly envelopeByteSize: number; readonly recipientCount: number
}
export interface PreparedFamilyEnvelopeOutputDto extends SealFamilyEnvelopeOutputDto {
  readonly recipientSetDigest: string
  readonly cacheDisposition: 'EXACT_CACHE' | 'STALE_CACHE_REUSED' | 'NEWLY_SEALED'
}
export interface OpenFamilyEnvelopeInputDto {
  readonly expectedMetadata: FamilyEnvelopeMetadataDto; readonly envelopeBytes: readonly number[]
  readonly localMembershipId: string
}
export interface OpenFamilyEnvelopeOutputDto {
  readonly artifactBytes: readonly number[]; readonly artifactSha256: string; readonly artifactByteSize: number
}
export interface PrepareFamilyDeliveryInputDto { readonly householdId: string; readonly audienceKeys: readonly string[] }
export interface AcceptFamilyDeliveryInputDto {
  readonly householdId: string; readonly receipts: readonly { readonly deliveryId: string; readonly artifactId: string; readonly digest: string; readonly acceptedAt: string }[]
}
export interface FamilyDeliveryRecipientSetChangedDto {
  readonly deliveryId: string; readonly transportSha256: string; readonly recipientSetDigest: string
}
export interface FamilyDeliveryRemoteArtifactDto {
  readonly sequence: number; readonly artifactId: string; readonly digest: string; readonly createdAt: string
  readonly originDeviceId: string; readonly senderMembershipId: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly byteSize: number; readonly artifactSchema: FamilyDeliveryArtifactSchemaDto
  readonly envelopeSchema: 'FAMILY_ENCRYPTED_ENVELOPE_V1' | null
  readonly transportDigest: string | null; readonly recipientSetDigest: string | null; readonly innerDigest: string | null
}
export interface RegisterFamilyDeliveryInboundInputDto { readonly householdId: string; readonly artifacts: readonly FamilyDeliveryRemoteArtifactDto[]; readonly nextCursor: number }
export interface StageFamilyDeliveryInboundInputDto { readonly householdId: string; readonly artifactId: string; readonly packageBytes: readonly number[] }
export interface StageEncryptedFamilyDeliveryInboundInputDto {
  readonly householdId: string; readonly artifactId: string; readonly envelopeBytes: readonly number[]
  readonly localMembershipId: string
}
export type FamilyDeliveryScheduleResultDto = 'NEVER' | 'DISABLED' | 'RUNNING' | 'NO_CHANGES' | 'DISCOVERED' | 'FAILED_RETRYABLE' | 'LEASE_EXPIRED' | 'TERMINAL_SUSPENDED'
export interface FamilyDeliveryScheduleStatusDto {
  readonly householdId: string; readonly enabled: boolean; readonly intervalMinutes: number
  readonly nextDueAt: string | null; readonly running: boolean; readonly leaseExpiresAt: string | null
  readonly lastAttemptAt: string | null; readonly lastSuccessAt: string | null
  readonly lastResult: FamilyDeliveryScheduleResultDto; readonly lastDiscoveredCount: number
  readonly consecutiveFailures: number; readonly suspendedUntil: string | null
  readonly suspensionReason: string | null; readonly lastErrorCode: string | null; readonly updatedAt: string
}
export interface EnableFamilyDeliveryBackgroundInputDto {
  readonly householdId: string; readonly token: string; readonly intervalMinutes: 15 | 30 | 60
}
export type MobileCaptureBackgroundResultDto = 'NEVER' | 'DISABLED' | 'RUNNING' | 'NO_CHANGES' | 'INGESTED' | 'FAILED_RETRYABLE' | 'LEASE_EXPIRED' | 'TERMINAL_SUSPENDED'
export interface MobileCaptureBackgroundStatusDto {
  readonly householdId: string; readonly enabled: boolean; readonly intervalMinutes: number
  readonly nextDueAt: string | null; readonly running: boolean; readonly leaseExpiresAt: string | null
  readonly lastAttemptAt: string | null; readonly lastSuccessAt: string | null
  readonly lastResult: MobileCaptureBackgroundResultDto; readonly lastIngestedCount: number
  readonly consecutiveFailures: number; readonly suspendedUntil: string | null
  readonly suspensionReason: string | null; readonly lastErrorCode: string | null; readonly updatedAt: string
}
export interface EnableMobileCaptureBackgroundInputDto {
  readonly householdId: string; readonly token: string; readonly intervalMinutes: 15 | 30 | 60
}
export type FamilySnapshotResolutionDto = 'PENDING' | 'APPLY_INCOMING' | 'KEEP_LOCAL' | 'SKIP'
export interface FamilySnapshotReviewRecordDto {
  readonly recordOrder: number; readonly entityKind: string; readonly entityId: string; readonly entityLabel: string
  readonly domain: FamilyDeliveryDomainDto; readonly entitySummary: string
  readonly operation: 'UPSERT' | 'DELETE'; readonly reviewState: 'CREATE' | 'UPDATE' | 'DELETE' | 'CONFLICT'
  readonly resolution: FamilySnapshotResolutionDto; readonly localSummary: string | null; readonly incomingSummary: string
}
export interface FamilySnapshotReviewDto {
  readonly packageId: string; readonly householdId: string; readonly senderMemberName: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberName: string | null
  readonly state: 'REVIEW_REQUIRED' | 'READY' | 'APPLIED'; readonly recordCount: number
  readonly createCount: number; readonly updateCount: number; readonly deleteCount: number; readonly conflictCount: number
  readonly evidenceFileCount: number; readonly evidenceRecordCount: number
  readonly records: readonly FamilySnapshotReviewRecordDto[]
}
export interface FamilySnapshotResolutionInputDto { readonly entityKind: string; readonly entityId: string; readonly resolution: Exclude<FamilySnapshotResolutionDto, 'PENDING'> }
export type MobileCaptureInboxStateDto = 'RECEIVED' | 'OCR_READY' | 'OCR_REVIEW_REQUIRED' | 'PROMOTED' | 'DUPLICATE' | 'REJECTED_INVALID' | 'FAILED_RETRYABLE'
export interface MobileCaptureInboxItemDto {
  readonly artifactId: string; readonly captureId: string; readonly originalFilename: string
  readonly mediaType: 'image/png' | 'image/jpeg'; readonly byteSize: number; readonly sourceSha256: string
  readonly capturedAt: string | null; readonly receivedAt: string
  readonly senderMembershipId?: string; readonly senderMemberName?: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName?: string | null
  readonly state: MobileCaptureInboxStateDto; readonly latestExtractionId: string | null
  readonly localRunId: string | null; readonly localDocumentId: string | null; readonly lastErrorCode: string | null
  readonly receivedBeforeSenderRevocation?: boolean
}
export interface MobileCaptureStatusDto {
  readonly endpoint: string | null; readonly localDeviceId: string; readonly captureInboundCursor: number
  readonly items: readonly MobileCaptureInboxItemDto[]
}
export interface MobileCaptureImagePreviewDto { readonly filename: string; readonly mediaType: 'image/png' | 'image/jpeg'; readonly byteSize: number; readonly dataUrl: string }
export interface MobileCaptureIngestInputDto {
  readonly householdId: string; readonly artifactId: string; readonly claimedDigest: string
  readonly originDeviceId: string; readonly senderMembershipId: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly capsuleBytes: readonly number[]
}
export interface MobileCaptureOcrResultDto {
  readonly item: MobileCaptureInboxItemDto; readonly extractionId: string; readonly document: ExtractedDocumentDto
}
export interface MobileCapturePromoteInputDto {
  readonly householdId: string; readonly artifactId: string; readonly extractionId: string; readonly import: StartImportDto
}
export interface MobileCapturePromoteResultDto {
  readonly item: MobileCaptureInboxItemDto; readonly runId: string; readonly documentId: string; readonly reusedExisting: boolean
}
export type ChangePackageResolutionDto = 'PENDING' | 'APPLY_INCOMING' | 'KEEP_LOCAL' | 'SKIP'
export interface ChangePackageRecordReviewDto {
  readonly recordOrder: number; readonly entityKind: string; readonly entityId: string
  readonly operation: 'UPSERT' | 'DELETE'; readonly payloadSha256: string
  readonly reviewState: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'DELETE' | 'CONFLICT'
  readonly resolution: ChangePackageResolutionDto
  readonly currentPayloadSha256: string | null; readonly conflictReason: string | null
}
export interface ChangePackageReviewDto {
  readonly packageId: string; readonly targetHouseholdId: string; readonly sourceInstallationId: string
  readonly sourceRevision: number; readonly sourceCreatedAt: string
  readonly state: 'STAGED' | 'REVIEW_REQUIRED' | 'READY' | 'APPLIED' | 'REJECTED'
  readonly recordCount: number; readonly createCount: number; readonly updateCount: number
  readonly unchangedCount: number; readonly deleteCount: number; readonly conflictCount: number
  readonly records: readonly ChangePackageRecordReviewDto[]
}
export interface ChangePackageResolutionInputDto {
  readonly entityKind: string; readonly entityId: string
  readonly resolution: 'APPLY_INCOMING' | 'KEEP_LOCAL'
}
export interface ExtractedRegionDto {
  readonly pageNumber: number
  readonly coordinateSpace: 'PIXELS' | 'PDF_POINTS' | 'UNLOCATED'
  readonly boundingBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null
  readonly text: string
  readonly confidenceBps: number
  readonly provenance: 'PDF_EMBEDDED_TEXT' | 'TESSERACT_WORD' | string
}
export interface ExtractedPageDto {
  readonly pageNumber: number
  readonly widthPixels: number | null
  readonly heightPixels: number | null
  readonly confidenceBps: number
  readonly issues: readonly string[]
}
export interface ExtractedDocumentDto {
  readonly method: 'EMBEDDED_TEXT' | 'OCR'
  readonly text: string
  readonly confidenceBps: number
  readonly issues: readonly string[]
  /** Optional while reading source payloads produced before the v0.5 evidence contract. */
  readonly regions?: readonly ExtractedRegionDto[]
  /** Optional while reading persisted evidence created before the v0.62 page-outcome contract. */
  readonly pageCount?: number
  readonly pages?: readonly ExtractedPageDto[]
}
export type CardReconciliationStatusDto = 'UNMATCHED' | 'POSSIBLE_MATCH' | 'FULLY_RECONCILED' | 'PARTIALLY_RECONCILED' | 'OVERPAID' | 'UNDERPAID' | 'MANUAL_OVERRIDE'
export interface CardSettlementPaymentDto {
  readonly paymentId: string; readonly bankTransactionId: string; readonly paymentAmountJpy: number
  readonly paymentOn: string; readonly matchScoreBps: number | null
}
export interface CardSettlementDto {
  readonly id: string; readonly cardAccountId: string; readonly cardName: string; readonly maskedIdentifier: string | null
  readonly periodStart: string; readonly periodEnd: string; readonly paymentDueOn: string | null
  readonly statementAmountJpy: number; readonly detailAmountJpy: number; readonly lineCount: number
  readonly paymentId: string | null; readonly bankTransactionId: string | null; readonly paymentAmountJpy: number | null
  readonly paymentOn: string | null; readonly matchScoreBps: number | null; readonly reconciliationStatus: CardReconciliationStatusDto
  readonly paidAmountJpy: number; readonly outstandingAmountJpy: number; readonly overpaidAmountJpy: number
  readonly payments: readonly CardSettlementPaymentDto[]; readonly eligiblePayments: readonly CardSettlementPaymentDto[]
}
export interface UpdateCardStatementDueDateInputDto {
  readonly householdId: string; readonly statementId: string; readonly paymentDueOn: string | null
}
export interface CardMatchConfirmationDto { readonly statementId: string; readonly paymentId: string; readonly reconciliationStatus: 'FULLY_RECONCILED' }
export interface CardSettlementBankMappingDto {
  readonly householdId: string; readonly cardAccountId: string; readonly cardAccountName: string
  readonly bankAccountId: string; readonly bankAccountName: string; readonly createdAt: string; readonly updatedAt: string
}
export interface UpsertCardSettlementBankMappingInputDto { readonly householdId: string; readonly cardAccountId: string; readonly bankAccountId: string }
export interface DeleteCardSettlementBankMappingInputDto { readonly householdId: string; readonly cardAccountId: string }
export type CardSettlementCoverageStatusDto = 'COVERED' | 'SHORTFALL' | 'OVERDUE'
export interface CardSettlementCoverageStatementDto {
  readonly statementId: string; readonly cardAccountId: string; readonly cardAccountName: string; readonly paymentDueOn: string
  readonly statementAmountJpy: number; readonly paidAmountJpy: number; readonly outstandingAmountJpy: number
  readonly projectedBankBalanceJpy: number; readonly shortfallJpy: number; readonly status: CardSettlementCoverageStatusDto
}
export interface CardSettlementBankCoverageDto {
  readonly bankAccountId: string; readonly bankAccountName: string; readonly balanceAsOfJpy: number
  readonly projectedEndingBalanceJpy: number; readonly maxShortfallJpy: number
  readonly statements: readonly CardSettlementCoverageStatementDto[]
}
export interface UnmappedCardSettlementDto {
  readonly statementId: string; readonly cardAccountId: string; readonly cardAccountName: string; readonly paymentDueOn: string
  readonly statementAmountJpy: number; readonly paidAmountJpy: number; readonly outstandingAmountJpy: number
  readonly status: 'UNMAPPED' | 'OVERDUE'
}
export interface MissingDueCardSettlementDto {
  readonly statementId: string; readonly cardAccountId: string; readonly cardAccountName: string
  readonly statementAmountJpy: number; readonly paidAmountJpy: number; readonly outstandingAmountJpy: number; readonly mappingConfigured: boolean
}
export interface CardSettlementBalanceCoverageRequestDto { readonly householdId: string; readonly asOf: string; readonly horizonDays?: number }
export interface CardSettlementBalanceCoverageDto {
  readonly asOf: string; readonly historyFrom: string; readonly horizonThrough: string; readonly horizonDays: number
  readonly banks: readonly CardSettlementBankCoverageDto[]; readonly unmappedStatements: readonly UnmappedCardSettlementDto[]
  readonly missingDueStatements: readonly MissingDueCardSettlementDto[]
}

export type AccountingBasisDto = 'ACCRUAL' | 'CASH'

export interface DashboardRequestDto {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly month: string
  readonly accountingBasis: AccountingBasisDto
}

export interface DashboardMonthlyTotalsDto {
  readonly month: string
  readonly accountingBasis: AccountingBasisDto
  readonly incomeJpy: number
  readonly expenseJpy: number
  readonly savingsJpy: number
  readonly postedTransactionCount: number
  readonly netWorthAsOf: string
  readonly assetsJpy: number
  readonly liabilitiesJpy: number
  readonly netWorthJpy: number
  readonly accrualTrend: readonly DashboardAccrualTrendPointDto[]
  readonly cashFlowTrend: readonly DashboardCashFlowTrendPointDto[]
  readonly expenseCategories: readonly DashboardExpenseCategoryDto[]
}

export interface DashboardAccrualTrendPointDto {
  readonly month: string
  readonly incomeJpy: number
  readonly expenseJpy: number
}

export interface DashboardExpenseCategoryDto {
  readonly accountId: string
  readonly name: string
  readonly amountJpy: number
}

export type DashboardTemplateDto =
  | 'FINANCIAL_OVERVIEW'
  | 'HOUSEHOLD_LEDGER'
  | 'ASSETS_LIABILITIES'
  | 'CARD_RECONCILIATION'
  | 'CASH_FLOW'

export type DashboardThemeDto = 'SYSTEM' | 'LIGHT' | 'DARK'
export type DashboardDensityDto = 'COMFORTABLE' | 'COMPACT'
export type DashboardWidgetIdDto = 'TREND' | 'SPENDING' | 'RECENT' | 'CARDS'
export interface DashboardWidgetLayoutDto {
  readonly widgetOrder: readonly DashboardWidgetIdDto[]
  readonly hiddenWidgets: readonly DashboardWidgetIdDto[]
}
export type DashboardTemplateLayoutsDto = Readonly<Record<DashboardTemplateDto, DashboardWidgetLayoutDto>>

export interface DashboardPreferencesDto {
  readonly householdId: string
  readonly template: DashboardTemplateDto
  readonly theme: DashboardThemeDto
  readonly density: DashboardDensityDto
  readonly templateLayouts: DashboardTemplateLayoutsDto
  readonly updatedAt: string
}

export interface DashboardCashFlowTrendPointDto {
  readonly month: string
  readonly inflowJpy: number
  readonly outflowJpy: number
  readonly netCashFlowJpy: number
}

export interface UpsertDashboardPreferencesInputDto {
  readonly householdId: string
  readonly template: DashboardTemplateDto
  readonly theme: DashboardThemeDto
  readonly density: DashboardDensityDto
  readonly templateLayouts: DashboardTemplateLayoutsDto
}

export interface TransactionPageRequestDto {
  readonly householdId: string
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly accountingBasis: AccountingBasisDto
  readonly fromDate?: string | null
  readonly toDate?: string | null
  readonly search?: string | null
  readonly calculationTargetFilter?: 'ALL' | 'INCLUDED' | 'EXCLUDED'
  readonly label?: TransactionLabelDto | null
  readonly tag?: string | null
  readonly page: number
  readonly pageSize: number
}

export interface TransactionRowDto {
  readonly id: string
  readonly occurredOn: string
  readonly postedOn: string | null
  readonly transactionType: string
  readonly payee: string | null
  readonly description: string | null
  readonly amountJpy: number
  readonly status: string
  readonly calculationTarget: boolean
  readonly debitAccountId: string | null
  readonly debitAccountName: string | null
  readonly creditAccountId: string | null
  readonly creditAccountName: string | null
  readonly categoryAccountId: string | null
  readonly categoryName: string | null
  readonly attributionKind: AttributionKindDto
  readonly attributedMemberId: string | null
  readonly attributedMemberName: string | null
  readonly audienceVisibility: AudienceVisibilityDto
  readonly audienceMemberId: string | null
  readonly audienceMemberName: string | null
  readonly labels: readonly TransactionLabelDto[]
  readonly tags: readonly string[]
}

export type TransactionLabelDto = 'SUBSCRIPTION' | 'RECURRING' | 'TAX_DEDUCTIBLE' | 'REIMBURSABLE' | 'UNUSUAL' | 'SHARED_EXPENSE' | 'PRIVATE_EXPENSE'
export interface BulkUpdateTransactionMetadataInputDto {
  readonly householdId: string
  readonly transactionIds: readonly string[]
  readonly addLabels: readonly TransactionLabelDto[]
  readonly removeLabels: readonly TransactionLabelDto[]
  readonly addTags: readonly string[]
  readonly removeTags: readonly string[]
}
export interface BulkUpdateTransactionMetadataResultDto { readonly updatedCount: number }

export type ManualTransactionTypeDto = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'CARD_PURCHASE' | 'CARD_PAYMENT' | 'REFUND' | 'FEE' | 'INTEREST' | 'ADJUSTMENT'
export interface ManualJournalEntryInputDto { readonly id: string; readonly accountId: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number }
export interface CreateManualTransactionInputDto {
  readonly id: string; readonly householdId: string; readonly occurredOn: string; readonly postedOn: string | null
  readonly transactionType: ManualTransactionTypeDto; readonly payee: string | null; readonly description: string | null
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly entries: readonly ManualJournalEntryInputDto[]
}
export interface TransactionJournalEntryDto { readonly id: string; readonly accountId: string; readonly accountName: string; readonly accountKind: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number; readonly lineNumber: number }
export interface TransactionSourceEvidenceDto { readonly sourceRecordId: string; readonly sourceDocumentId: string; readonly sourceType: string; readonly originalFilename: string; readonly mediaType: string; readonly rowNumber: number; readonly importedAt: string; readonly evidenceRole: string; readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName: string | null }
export interface TransactionDetailDto {
  readonly id: string; readonly householdId: string; readonly occurredOn: string; readonly postedOn: string | null
  readonly transactionType: ManualTransactionTypeDto; readonly payee: string | null; readonly description: string | null
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null; readonly attributedMemberName: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName: string | null
  readonly status: string; readonly createdAt: string; readonly updatedAt: string; readonly editable: boolean
  readonly calculationTarget: boolean
  readonly labels: readonly TransactionLabelDto[]; readonly tags: readonly string[]
  readonly entries: readonly TransactionJournalEntryDto[]; readonly sourceEvidence: readonly TransactionSourceEvidenceDto[]
}
export interface UpdatePostedTransactionInputDto extends Omit<CreateManualTransactionInputDto, 'id'> { readonly transactionId: string; readonly calculationTarget: boolean }
export interface SourceDocumentViewDto {
  readonly id: string; readonly householdId: string; readonly importRunId: string; readonly sourceType: string
  readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string
  readonly sourceModifiedAt: string | null; readonly importedAt: string; readonly adapterId: string | null
  readonly adapterVersion: string | null; readonly recordCount: number
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName: string | null
}
export interface UpdateSourceDocumentAudienceInputDto { readonly householdId: string; readonly sourceDocumentId: string; readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null }
export interface SourceRecordViewDto {
  readonly id: string; readonly sourceDocumentId: string; readonly rowNumber: number; readonly recordHash: string
  readonly payloadJson: string; readonly createdAt: string; readonly evidenceRole: string | null
}
export interface SourceRecordPageRequestDto { readonly householdId: string; readonly sourceDocumentId: string; readonly page: number; readonly pageSize: number }
export interface SourceRecordPageDto {
  readonly items: readonly SourceRecordViewDto[]; readonly page: number; readonly pageSize: number
  readonly totalItems: number; readonly totalPages: number
}
export type WatchedFolderSourceTypeDto = 'LOCAL_FOLDER' | 'ICLOUD_PICKER'
export type WatchedFolderProviderDto = 'LOCAL' | 'ICLOUD'
export interface WatchedFolderDto {
  readonly id: string; readonly householdId: string; readonly label: string; readonly displayName: string
  readonly sourceType: WatchedFolderSourceTypeDto; readonly provider: WatchedFolderProviderDto
  readonly isEnabled: boolean; readonly createdAt: string
}
export interface WatchedFileMetadataDto { readonly relativePath: string; readonly fileName: string; readonly mediaType: string; readonly byteSize: number; readonly modifiedUnixMs: number | null }
export interface WatchedFolderScanDto { readonly watchedFolderId: string; readonly files: readonly WatchedFileMetadataDto[] }
export interface WatchedFileDto extends WatchedFileMetadataDto { readonly fileBytes: readonly number[] }
export type WatchedFileInboxStateDto = 'DISCOVERED' | 'PROCESSING' | 'READY' | 'NEEDS_MAPPING' | 'STAGED' | 'FAILED' | 'IGNORED' | 'REMOVED'
export interface WatchedFileInboxItemDto {
  readonly id: string; readonly householdId: string; readonly watchedFolderId: string; readonly watchedFolderLabel: string
  readonly sourceType: WatchedFolderSourceTypeDto; readonly provider: WatchedFolderProviderDto
  readonly relativePath: string; readonly fileName: string; readonly mediaType: string; readonly byteSize: number
  readonly modifiedUnixMs: number | null; readonly fingerprint: string; readonly state: WatchedFileInboxStateDto
  readonly attemptCount: number; readonly importRunId: string | null; readonly lastErrorCode: string | null
  readonly discoveredAt: string; readonly updatedAt: string
}
export interface WatchedFileInboxCountsDto {
  readonly discovered: number; readonly processing: number; readonly ready: number; readonly needsMapping: number
  readonly staged: number; readonly failed: number; readonly ignored: number; readonly removed: number
  readonly actionable: number; readonly total: number
}
export interface WatchedFileInboxClaimDto {
  readonly leaseToken: string; readonly leaseExpiresAt: string; readonly items: readonly WatchedFileInboxItemDto[]
}

export type GoogleDriveUnavailableReasonDto = 'CLIENT_ID_NOT_COMPILED' | 'UNSUPPORTED_RUNTIME'
export interface GoogleDriveAvailabilityDto {
  readonly available: boolean
  readonly authorizationMode: 'SYSTEM_BROWSER_LOOPBACK'
  readonly scopeProfile: 'DRIVE_READONLY'
  readonly unavailableReason: GoogleDriveUnavailableReasonDto | null
}
export type GoogleDriveConnectionStatusDto = 'AUTHORIZING' | 'SELECTING_FOLDER' | 'CONNECTED' | 'AUTH_REQUIRED' | 'DISCONNECTED'
export type GoogleDriveScopeDto = 'MY_DRIVE' | 'SHARED_DRIVE'
export interface GoogleDriveConnectionDto {
  readonly id: string; readonly accountEmail: string | null
  readonly folderName: string | null; readonly driveScope: GoogleDriveScopeDto | null; readonly folderBound: boolean
  readonly status: GoogleDriveConnectionStatusDto
  readonly lastFullScanAt: string | null; readonly lastChangeAt: string | null
  readonly createdAt: string; readonly updatedAt: string
}
export interface BindGoogleDriveFolderInputDto {
  readonly householdId: string; readonly connectionId: string; readonly folderReference: string
}
export type GoogleDriveSyncResultDto = 'NEVER' | 'RUNNING' | 'NO_CHANGES' | 'DISCOVERED' | 'FAILED_RETRYABLE' | 'LEASE_EXPIRED' | 'TERMINAL_SUSPENDED' | 'DISABLED'
export type GoogleDriveSuspensionReasonDto = 'RETRY_BACKOFF' | 'AUTH_EXPIRED' | 'MISSING_CREDENTIAL' | 'CURSOR_INVALID'
export interface GoogleDriveSyncScheduleDto {
  readonly connectionId: string; readonly enabled: boolean; readonly intervalMinutes: 15 | 30 | 60
  readonly nextDueAt: string | null; readonly running: boolean; readonly leaseExpiresAt: string | null
  readonly lastAttemptAt: string | null; readonly lastSuccessAt: string | null
  readonly lastResult: GoogleDriveSyncResultDto; readonly lastDiscoveredCount: number
  readonly consecutiveFailures: number; readonly suspendedUntil: string | null
  readonly suspensionReason: GoogleDriveSuspensionReasonDto | null; readonly lastErrorCode: string | null
  readonly updatedAt: string
}
export interface UpdateGoogleDriveScheduleInputDto {
  readonly householdId: string; readonly connectionId: string
  readonly enabled: boolean; readonly intervalMinutes: 15 | 30 | 60
}
export type GoogleDriveInboxStateDto = WatchedFileInboxStateDto | 'TOO_LARGE' | 'UNSUPPORTED'
export interface GoogleDriveInboxItemDto {
  readonly id: string; readonly householdId: string; readonly connectionId: string; readonly fileId: string
  readonly generationFingerprint: string; readonly fileName: string; readonly mediaType: string
  readonly remoteByteSize: number | null; readonly remoteModifiedAt: string | null
  readonly remoteMd5Checksum: string | null; readonly driveVersion: string | null
  readonly contentSha256: string | null; readonly state: GoogleDriveInboxStateDto
  readonly attemptCount: number; readonly importRunId: string | null; readonly lastErrorCode: string | null
  readonly discoveredAt: string; readonly updatedAt: string
}
export interface GoogleDriveInboxFileDto {
  readonly item: GoogleDriveInboxItemDto
  readonly fileBytes: readonly number[]
}
export interface GoogleDriveInboxClaimDto {
  readonly leaseToken: string
  readonly leaseExpiresAt: string
  readonly items: readonly GoogleDriveInboxItemDto[]
}

export interface TransactionPageDto {
  readonly items: readonly TransactionRowDto[]
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
}

export interface ImportRunCountsDto {
  readonly totalRuns: number
  readonly discovered: number
  readonly extracting: number
  readonly reviewRequired: number
  readonly posted: number
  readonly failed: number
  readonly rolledBack: number
  readonly sourceDocuments: number
  readonly sourceRecords: number
  readonly pendingCandidates: number
  readonly readyCandidates: number
  readonly latestSuccessfulImportAt: string | null
  readonly latestSourceFilename: string | null
  readonly latestSourceType: string | null
  readonly distinctSourceTypes: number
}

export interface MonthlyCategoryBudgetDto { readonly householdId: string; readonly month: string; readonly categoryAccountId: string; readonly categoryName: string; readonly budgetJpy: number; readonly actualJpy: number; readonly remainingJpy: number }
export interface UpsertMonthlyCategoryBudgetInputDto { readonly householdId: string; readonly month: string; readonly categoryAccountId: string; readonly budgetJpy: number }
export type SavingsGoalStatusDto = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
export interface SavingsGoalDto { readonly id: string; readonly householdId: string; readonly name: string; readonly targetJpy: number; readonly savedJpy: number; readonly targetDate: string; readonly status: SavingsGoalStatusDto; readonly createdAt: string; readonly updatedAt: string }
export interface CreateSavingsGoalInputDto { readonly id: string; readonly householdId: string; readonly name: string; readonly targetJpy: number; readonly savedJpy: number; readonly targetDate: string; readonly status: SavingsGoalStatusDto }
export type UpdateSavingsGoalInputDto = CreateSavingsGoalInputDto

export interface ClassificationRuleDto {
  readonly id: string; readonly householdId: string; readonly name: string; readonly priority: number; readonly isEnabled: boolean
  readonly merchantContains: string | null; readonly descriptionContains: string | null
  readonly categoryAccountId: string; readonly categoryName: string; readonly labels: readonly string[]; readonly tags: readonly string[]
  readonly createdAt: string; readonly updatedAt: string
}
export interface CreateClassificationRuleInputDto {
  readonly id: string; readonly householdId: string; readonly name: string; readonly priority: number; readonly isEnabled: boolean
  readonly merchantContains: string | null; readonly descriptionContains: string | null; readonly categoryAccountId: string
  readonly labels: readonly string[]; readonly tags: readonly string[]
}
export type UpdateClassificationRuleInputDto = CreateClassificationRuleInputDto
export interface ClassificationPreviewInputDto { readonly householdId: string; readonly merchant: string | null; readonly description: string | null }
export interface ClassificationPreviewDto { readonly winningRuleId: string | null; readonly matches: readonly ClassificationRuleDto[] }
export interface ApplyClassificationRuleInputDto {
  readonly householdId: string; readonly transactionId: string; readonly ruleId: string; readonly expectedTransactionUpdatedAt: string
}
export interface AppliedClassificationDto {
  readonly transactionId: string; readonly ruleId: string; readonly categoryAccountId: string; readonly categoryName: string
  readonly labels: readonly string[]; readonly tags: readonly string[]; readonly transactionUpdatedAt: string
}

export type AppCommand =
  | 'app_bootstrap'
  | 'app_health'
  | 'app_status'
  | 'local_sync_foundation_status'
  | 'principal_member_binding_update'
  | 'relay_status'
  | 'relay_connection_save'
  | 'relay_disconnect'
  | 'relay_send_prepare'
  | 'relay_send_accept'
  | 'relay_send_failed'
  | 'relay_inbound_register'
  | 'relay_inbound_stage'
  | 'family_delivery_status'
  | 'family_delivery_connection_save'
  | 'family_delivery_disconnect'
  | 'family_delivery_remote_state_register'
  | 'family_delivery_send_prepare'
  | 'family_delivery_envelope_prepare'
  | 'family_delivery_envelope_cached_get'
  | 'family_envelope_identity_get'
  | 'family_envelope_seal'
  | 'family_envelope_open'
  | 'family_delivery_send_accept'
  | 'family_delivery_send_failed'
  | 'family_delivery_envelope_recipient_set_changed'
  | 'family_delivery_inbound_register'
  | 'family_delivery_inbound_stage'
  | 'family_delivery_encrypted_inbound_stage'
  | 'family_delivery_background_status'
  | 'family_delivery_background_enable'
  | 'family_delivery_background_disable'
  | 'family_delivery_background_run_now'
  | 'mobile_capture_background_status'
  | 'mobile_capture_background_enable'
  | 'mobile_capture_background_disable'
  | 'mobile_capture_background_run_now'
  | 'family_snapshot_active_review'
  | 'family_snapshot_resolve'
  | 'family_snapshot_apply'
  | 'family_snapshot_discard'
  | 'change_package_export_save'
  | 'change_package_pick_and_stage'
  | 'change_package_active_review'
  | 'change_package_resolve'
  | 'change_package_apply'
  | 'change_package_discard'
  | 'evidence_bundle_export_save'
  | 'evidence_bundle_pick_and_import'
  | 'pending_import_export_to_picker'
  | 'pending_import_pick_and_stage'
  | 'pending_import_apply'
  | 'pending_import_discard'
  | 'mobile_capture_inbox_list'
  | 'mobile_capture_status'
  | 'mobile_capture_cursor_update'
  | 'mobile_capture_ingest'
  | 'mobile_capture_image_preview'
  | 'mobile_capture_ocr'
  | 'mobile_capture_mark_ocr_review_required'
  | 'mobile_capture_promote'
  | 'households_list'
  | 'household_create'
  | 'household_members_list'
  | 'household_member_create'
  | 'household_member_update'
  | 'household_member_archive'
  | 'accounts_list'
  | 'account_create'
  | 'account_rename'
  | 'account_archive'
  | 'account_ownership_update'
  | 'transactions_query'
  | 'transaction_manual_create'
  | 'transaction_detail_get'
  | 'transaction_update'
  | 'transaction_metadata_bulk_update'
  | 'source_document_get'
  | 'source_document_audience_update'
  | 'source_document_records_query'
  | 'transaction_source_records_list'
  | 'watched_folders_list'
  | 'watched_folder_select'
  | 'icloud_folder_select'
  | 'watched_folder_remove'
  | 'watched_folder_scan'
  | 'watched_folder_file_read'
  | 'watched_file_inbox_list'
  | 'watched_file_inbox_counts'
  | 'watched_file_inbox_ignore'
  | 'watched_file_inbox_retry'
  | 'watched_file_inbox_claim'
  | 'watched_file_inbox_mark_ready'
  | 'watched_file_inbox_mark_needs_mapping'
  | 'watched_file_inbox_mark_failed'
  | 'watched_file_inbox_mark_staged'
  | 'google_drive_availability'
  | 'google_drive_connections_list'
  | 'google_drive_connect'
  | 'google_drive_folder_bind'
  | 'google_drive_disconnect'
  | 'google_drive_schedule_get'
  | 'google_drive_schedule_update'
  | 'google_drive_sync_now'
  | 'google_drive_inbox_list'
  | 'google_drive_inbox_ignore'
  | 'google_drive_inbox_retry'
  | 'google_drive_inbox_file_read'
  | 'google_drive_inbox_claim'
  | 'google_drive_inbox_mark_staged'
  | 'google_drive_inbox_mark_failed'
  | 'google_drive_inbox_reopen'
  | 'dashboard_query'
  | 'dashboard_preferences_get'
  | 'dashboard_preferences_upsert'
  | 'budgets_query'
  | 'budget_upsert'
  | 'savings_goals_list'
  | 'savings_goal_create'
  | 'savings_goal_update'
  | 'savings_goal_delete'
  | 'classification_rules_list'
  | 'classification_rule_create'
  | 'classification_rule_update'
  | 'classification_rule_delete'
  | 'classification_rules_preview'
  | 'classification_rule_apply'
  | 'import_summary'
  | 'pending_review_list'
  | 'import_start'
  | 'import_preview'
  | 'import_commit'
  | 'import_rollback'
  | 'backup_create'
  | 'backup_restore_stage'
  | 'app_restart_for_restore'
  | 'document_extract'
  | 'document_ocr'
  | 'cards_list'
  | 'card_match_confirm'
  | 'card_payment_link_confirm'
  | 'card_statement_due_date_update'
  | 'card_settlement_bank_mappings_list'
  | 'card_settlement_bank_mapping_upsert'
  | 'card_settlement_bank_mapping_delete'
  | 'card_settlement_balance_coverage_query'
  | 'receipt_match_suggestions'
  | 'receipt_match_confirm'

export type Invoke = <T>(command: AppCommand, args?: Record<string, unknown>) => Promise<T>

export interface PlatformClient {
  readonly runtime: 'tauri' | 'web'
  bootstrap(): Promise<AppBootstrapDto>
  health(): Promise<AppHealthDto>
  status(): Promise<AppStatusDto>
  getLocalSyncFoundationStatus(householdId: string): Promise<LocalSyncFoundationStatusDto>
  updatePrincipalMemberBinding(input: UpdatePrincipalMemberBindingInputDto): Promise<LocalSyncFoundationStatusDto>
  getDesktopRelayStatus(householdId: string): Promise<DesktopRelayStatusDto>
  saveDesktopRelayConnection(input: SaveDesktopRelayConnectionInputDto): Promise<DesktopRelayStatusDto>
  disconnectDesktopRelay(householdId: string): Promise<DesktopRelayStatusDto>
  prepareDesktopRelaySend(householdId: string): Promise<DesktopRelayPreparedDeliveryDto>
  acceptDesktopRelaySend(input: AcceptDesktopRelayDeliveryInputDto): Promise<DesktopRelayStatusDto>
  failDesktopRelaySend(householdId: string, deliveryId: string): Promise<DesktopRelayStatusDto>
  registerDesktopRelayInbound(input: RegisterDesktopRelayInboundInputDto): Promise<DesktopRelayStatusDto>
  stageDesktopRelayInbound(input: StageDesktopRelayInboundInputDto): Promise<DesktopRelayStatusDto>
  getFamilyDeliveryStatus(householdId: string): Promise<FamilyDeliveryStatusDto>
  saveFamilyDeliveryConnection(input: SaveFamilyDeliveryConnectionInputDto): Promise<FamilyDeliveryStatusDto>
  disconnectFamilyDelivery(householdId: string): Promise<FamilyDeliveryStatusDto>
  registerFamilyDeliveryRemoteState(input: RegisterFamilyDeliveryRemoteStateInputDto): Promise<FamilyDeliveryStatusDto>
  prepareFamilyDelivery(input: PrepareFamilyDeliveryInputDto): Promise<readonly FamilyDeliveryPreparedArtifactDto[]>
  prepareEncryptedFamilyEnvelope(input: PrepareEncryptedFamilyEnvelopeInputDto): Promise<PreparedFamilyEnvelopeOutputDto>
  getCachedFamilyDeliveryEnvelope(input: Pick<PrepareEncryptedFamilyEnvelopeInputDto, 'deliveryId' | 'metadata'>): Promise<PreparedFamilyEnvelopeOutputDto | null>
  getFamilyEnvelopeIdentity(): Promise<FamilyEnvelopePublicIdentityDto>
  sealFamilyEnvelope(input: SealFamilyEnvelopeInputDto): Promise<SealFamilyEnvelopeOutputDto>
  openFamilyEnvelope(input: OpenFamilyEnvelopeInputDto): Promise<OpenFamilyEnvelopeOutputDto>
  acceptFamilyDelivery(input: AcceptFamilyDeliveryInputDto): Promise<FamilyDeliveryStatusDto>
  failFamilyDelivery(householdId: string, deliveryIds: readonly string[]): Promise<FamilyDeliveryStatusDto>
  resetFamilyDeliveryRecipientSetChanged(householdId: string, deliveries: readonly FamilyDeliveryRecipientSetChangedDto[]): Promise<FamilyDeliveryStatusDto>
  registerFamilyDeliveryInbound(input: RegisterFamilyDeliveryInboundInputDto): Promise<FamilyDeliveryStatusDto>
  stageFamilyDeliveryInbound(input: StageFamilyDeliveryInboundInputDto): Promise<FamilyDeliveryStatusDto>
  stageEncryptedFamilyDeliveryInbound(input: StageEncryptedFamilyDeliveryInboundInputDto): Promise<FamilyDeliveryStatusDto>
  getFamilyDeliveryBackgroundStatus(householdId: string): Promise<FamilyDeliveryScheduleStatusDto>
  enableFamilyDeliveryBackground(input: EnableFamilyDeliveryBackgroundInputDto): Promise<FamilyDeliveryScheduleStatusDto>
  disableFamilyDeliveryBackground(householdId: string): Promise<FamilyDeliveryScheduleStatusDto>
  runFamilyDeliveryBackgroundNow(householdId: string): Promise<FamilyDeliveryScheduleStatusDto>
  getMobileCaptureBackgroundStatus(householdId: string): Promise<MobileCaptureBackgroundStatusDto>
  enableMobileCaptureBackground(input: EnableMobileCaptureBackgroundInputDto): Promise<MobileCaptureBackgroundStatusDto>
  disableMobileCaptureBackground(householdId: string): Promise<MobileCaptureBackgroundStatusDto>
  runMobileCaptureBackgroundNow(householdId: string): Promise<MobileCaptureBackgroundStatusDto>
  getActiveFamilySnapshotReview(householdId: string): Promise<FamilySnapshotReviewDto | null>
  resolveFamilySnapshot(packageId: string, resolutions: readonly FamilySnapshotResolutionInputDto[]): Promise<FamilySnapshotReviewDto>
  applyFamilySnapshot(packageId: string): Promise<FamilySnapshotReviewDto>
  discardFamilySnapshot(packageId: string): Promise<void>
  listMobileCaptureInbox(householdId: string): Promise<readonly MobileCaptureInboxItemDto[]>
  getMobileCaptureStatus(householdId: string): Promise<MobileCaptureStatusDto>
  updateMobileCaptureCursor(householdId: string, nextCursor: number): Promise<MobileCaptureStatusDto>
  ingestMobileCapture(input: MobileCaptureIngestInputDto): Promise<MobileCaptureInboxItemDto>
  getMobileCaptureImagePreview(householdId: string, artifactId: string): Promise<MobileCaptureImagePreviewDto>
  ocrMobileCapture(householdId: string, artifactId: string): Promise<MobileCaptureOcrResultDto>
  markMobileCaptureOcrReviewRequired(householdId: string, artifactId: string): Promise<MobileCaptureInboxItemDto>
  promoteMobileCapture(input: MobileCapturePromoteInputDto): Promise<MobileCapturePromoteResultDto>
  exportChangePackage(householdId: string): Promise<string | null>
  pickAndStageChangePackage(householdId: string): Promise<ChangePackageReviewDto | null>
  getActiveChangePackageReview(householdId: string): Promise<ChangePackageReviewDto | null>
  resolveChangePackage(packageId: string, resolutions: readonly ChangePackageResolutionInputDto[]): Promise<ChangePackageReviewDto>
  applyChangePackage(packageId: string): Promise<ChangePackageReviewDto>
  discardChangePackage(packageId: string): Promise<void>
  exportEvidenceBundle(householdId: string, passphrase: string): Promise<EvidenceBundleSummaryDto | null>
  pickAndImportEvidenceBundle(householdId: string, passphrase: string): Promise<EvidenceBundleSummaryDto | null>
  exportPendingImport(request: PendingImportExportRequestDto, passphrase: string): Promise<PendingImportExportSummaryDto | null>
  pickAndStagePendingImport(householdId: string, passphrase: string): Promise<PendingImportStageDto | null>
  applyPendingImport(householdId: string, packageId: string, mappings: PendingImportMappingsDto): Promise<PendingImportApplySummaryDto>
  discardPendingImport(packageId: string): Promise<boolean>
  listHouseholds(): Promise<readonly HouseholdDto[]>
  createHousehold(input: CreateHouseholdInputDto): Promise<HouseholdDto>
  listHouseholdMembers(householdId: string): Promise<readonly HouseholdMemberDto[]>
  createHouseholdMember(input: CreateHouseholdMemberInputDto): Promise<HouseholdMemberDto>
  updateHouseholdMember(input: UpdateHouseholdMemberInputDto): Promise<HouseholdMemberDto>
  archiveHouseholdMember(householdId: string, memberId: string): Promise<void>
  listAccounts(householdId: string): Promise<readonly AccountDto[]>
  createAccount(input: CreateAccountInputDto): Promise<AccountDto>
  renameAccount(input: RenameAccountInputDto): Promise<AccountDto>
  archiveAccount(input: ArchiveAccountInputDto): Promise<void>
  updateAccountOwnership(input: UpdateAccountOwnershipInputDto): Promise<AccountDto>
  queryTransactions(request: TransactionPageRequestDto): Promise<TransactionPageDto>
  createManualTransaction(input: CreateManualTransactionInputDto): Promise<TransactionRowDto>
  getTransactionDetail(householdId: string, transactionId: string): Promise<TransactionDetailDto>
  updateTransaction(input: UpdatePostedTransactionInputDto): Promise<TransactionDetailDto>
  bulkUpdateTransactionMetadata(input: BulkUpdateTransactionMetadataInputDto): Promise<BulkUpdateTransactionMetadataResultDto>
  getSourceDocument(householdId: string, sourceDocumentId: string): Promise<SourceDocumentViewDto>
  updateSourceDocumentAudience(input: UpdateSourceDocumentAudienceInputDto): Promise<SourceDocumentViewDto>
  querySourceDocumentRecords(request: SourceRecordPageRequestDto): Promise<SourceRecordPageDto>
  listTransactionSourceRecords(householdId: string, transactionId: string): Promise<readonly SourceRecordViewDto[]>
  listWatchedFolders(householdId: string): Promise<readonly WatchedFolderDto[]>
  selectWatchedFolder(householdId: string, label: string): Promise<WatchedFolderDto | null>
  selectIcloudFolder(householdId: string, label: string): Promise<WatchedFolderDto | null>
  removeWatchedFolder(householdId: string, watchedFolderId: string): Promise<void>
  scanWatchedFolder(householdId: string, watchedFolderId: string): Promise<WatchedFolderScanDto>
  readWatchedFile(householdId: string, watchedFolderId: string, relativePath: string): Promise<WatchedFileDto>
  listWatchedFileInbox(householdId: string, state?: WatchedFileInboxStateDto, limit?: number): Promise<readonly WatchedFileInboxItemDto[]>
  countWatchedFileInbox(householdId: string): Promise<WatchedFileInboxCountsDto>
  ignoreWatchedFileInboxItem(householdId: string, itemId: string): Promise<WatchedFileInboxItemDto>
  retryWatchedFileInboxItem(householdId: string, itemId: string): Promise<WatchedFileInboxItemDto>
  claimWatchedFileInboxItems(householdId: string, itemIds: readonly string[]): Promise<WatchedFileInboxClaimDto>
  markWatchedFileInboxReady(householdId: string, itemId: string, leaseToken: string): Promise<WatchedFileInboxItemDto>
  markWatchedFileInboxNeedsMapping(householdId: string, itemId: string, leaseToken: string): Promise<WatchedFileInboxItemDto>
  markWatchedFileInboxFailed(householdId: string, itemId: string, leaseToken: string, errorCode: string): Promise<WatchedFileInboxItemDto>
  markWatchedFileInboxStaged(householdId: string, itemId: string, leaseToken: string, importRunId: string): Promise<WatchedFileInboxItemDto>
  getGoogleDriveAvailability(): Promise<GoogleDriveAvailabilityDto>
  listGoogleDriveConnections(householdId: string): Promise<readonly GoogleDriveConnectionDto[]>
  connectGoogleDrive(householdId: string): Promise<GoogleDriveConnectionDto>
  bindGoogleDriveFolder(input: BindGoogleDriveFolderInputDto): Promise<GoogleDriveConnectionDto>
  disconnectGoogleDrive(householdId: string, connectionId: string): Promise<GoogleDriveConnectionDto>
  getGoogleDriveSchedule(householdId: string, connectionId: string): Promise<GoogleDriveSyncScheduleDto>
  updateGoogleDriveSchedule(input: UpdateGoogleDriveScheduleInputDto): Promise<GoogleDriveSyncScheduleDto>
  syncGoogleDriveNow(householdId: string, connectionId: string): Promise<GoogleDriveSyncScheduleDto>
  listGoogleDriveInbox(householdId: string, connectionId?: string, state?: GoogleDriveInboxStateDto, limit?: number): Promise<readonly GoogleDriveInboxItemDto[]>
  ignoreGoogleDriveInboxItem(householdId: string, itemId: string): Promise<GoogleDriveInboxItemDto>
  retryGoogleDriveInboxItem(householdId: string, itemId: string): Promise<GoogleDriveInboxItemDto>
  readGoogleDriveInboxFile(householdId: string, itemId: string): Promise<GoogleDriveInboxFileDto>
  claimGoogleDriveInboxItems(householdId: string, itemIds: readonly string[]): Promise<GoogleDriveInboxClaimDto>
  markGoogleDriveInboxStaged(householdId: string, itemId: string, leaseToken: string, importRunId: string): Promise<GoogleDriveInboxItemDto>
  markGoogleDriveInboxFailed(householdId: string, itemId: string, leaseToken: string, errorCode: string): Promise<GoogleDriveInboxItemDto>
  reopenGoogleDriveInboxItem(householdId: string, itemId: string, importRunId: string): Promise<GoogleDriveInboxItemDto>
  queryDashboard(request: DashboardRequestDto): Promise<DashboardMonthlyTotalsDto>
  getDashboardPreferences(householdId: string): Promise<DashboardPreferencesDto>
  upsertDashboardPreferences(input: UpsertDashboardPreferencesInputDto): Promise<DashboardPreferencesDto>
  listBudgets(householdId: string, month: string): Promise<readonly MonthlyCategoryBudgetDto[]>
  upsertBudget(input: UpsertMonthlyCategoryBudgetInputDto): Promise<MonthlyCategoryBudgetDto>
  listSavingsGoals(householdId: string): Promise<readonly SavingsGoalDto[]>
  createSavingsGoal(input: CreateSavingsGoalInputDto): Promise<SavingsGoalDto>
  updateSavingsGoal(input: UpdateSavingsGoalInputDto): Promise<SavingsGoalDto>
  deleteSavingsGoal(householdId: string, goalId: string): Promise<void>
  listClassificationRules(householdId: string): Promise<readonly ClassificationRuleDto[]>
  createClassificationRule(input: CreateClassificationRuleInputDto): Promise<ClassificationRuleDto>
  updateClassificationRule(input: UpdateClassificationRuleInputDto): Promise<ClassificationRuleDto>
  deleteClassificationRule(householdId: string, ruleId: string): Promise<void>
  previewClassificationRules(input: ClassificationPreviewInputDto): Promise<ClassificationPreviewDto>
  applyClassificationRule(input: ApplyClassificationRuleInputDto): Promise<AppliedClassificationDto>
  importSummary(householdId: string): Promise<ImportRunCountsDto>
  listPendingReviews(householdId: string): Promise<PendingReviewListDto>
  startImport(request: StartImportDto, fileBytes: Uint8Array): Promise<ImportSummaryDto>
  previewImport(runId: string): Promise<ImportPreviewDto>
  commitImport(runId: string, decisions: readonly PostingDecisionDto[]): Promise<CommitSummaryDto>
  rollbackImport(runId: string): Promise<void>
  createBackup(passphrase: string): Promise<BackupSummaryDto | null>
  stageBackupRestore(passphrase: string): Promise<BackupSummaryDto | null>
  restartForRestore(): Promise<void>
  extractDocument(fileBytes: Uint8Array, mediaType: string): Promise<ExtractedDocumentDto>
  ocrDocument(fileBytes: Uint8Array, mediaType: string): Promise<ExtractedDocumentDto>
  listCardSettlements(householdId: string): Promise<readonly CardSettlementDto[]>
  confirmCardMatch(householdId: string, statementId: string, paymentId: string): Promise<CardMatchConfirmationDto>
  confirmCardPaymentLink(householdId: string, statementId: string, paymentId: string): Promise<CardSettlementDto>
  updateCardStatementDueDate(input: UpdateCardStatementDueDateInputDto): Promise<CardSettlementDto>
  listCardSettlementBankMappings(householdId: string): Promise<readonly CardSettlementBankMappingDto[]>
  upsertCardSettlementBankMapping(input: UpsertCardSettlementBankMappingInputDto): Promise<CardSettlementBankMappingDto>
  deleteCardSettlementBankMapping(input: DeleteCardSettlementBankMappingInputDto): Promise<void>
  queryCardSettlementBalanceCoverage(request: CardSettlementBalanceCoverageRequestDto): Promise<CardSettlementBalanceCoverageDto>
  suggestReceiptMatches(householdId: string, candidateId: string): Promise<readonly ReceiptMatchSuggestionDto[]>
  confirmReceiptMatch(householdId: string, candidateId: string, transactionId: string): Promise<ReceiptMatchConfirmationDto>
}
