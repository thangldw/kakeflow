import { describe, expect, it } from 'vitest'
import type {
  AccountDto,
  ConnectorBindingDto,
  GmailInboxItemDto,
  GoogleDriveInboxItemDto,
  WatchedFileInboxItemDto,
} from '../../platform/types'
import {
  bindingForReviewSource,
  filterReviewAccountOptions,
  filterReviewParserOptions,
  isReviewConnectorResolutionValid,
  isStagedReviewBindingValid,
  resolveReviewConnector,
  sanitizeReviewSelections,
} from './connectorBindingModel'

const account = (id: string): AccountDto => ({
  id, name: id, accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY',
  ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED',
})

const binding = (overrides: Partial<ConnectorBindingDto>): ConnectorBindingDto => ({
  householdId: 'family', connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import',
  allowedAccountIds: ['manual-bank'], parserProfileId: null, parserProfileVersion: null,
  version: 1, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
  ...overrides,
})

const driveRow = { id: 'drive-item', connectionId: 'drive-primary', importRunId: null } as GoogleDriveInboxItemDto
const gmailRow = { id: 'gmail-item', connectionId: 'gmail-primary', importRunId: null } as GmailInboxItemDto
const watchedRow = { id: 'folder-item', watchedFolderId: 'folder-primary', importRunId: null } as WatchedFileInboxItemDto
const inbox = { drive: [driveRow], gmail: [gmailRow], watched: [watchedRow] }

describe('connector binding review model', () => {
  it('resolves Drive, Gmail, watched-folder, and manual identities from released source links', () => {
    expect(resolveReviewConnector({ driveInboxItemId: 'drive-item', sourceType: 'GOOGLE_DRIVE' }, inbox)).toEqual({ connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary' })
    expect(resolveReviewConnector({ gmailInboxItemId: 'gmail-item', sourceType: 'GMAIL' }, inbox)).toEqual({ connectorKind: 'GMAIL', connectionKey: 'gmail-primary' })
    expect(resolveReviewConnector({ watchedFolderId: 'folder-primary', sourceType: 'LOCAL_FOLDER' }, inbox)).toEqual({ connectorKind: 'WATCHED_FOLDER', connectionKey: 'folder-primary' })
    expect(resolveReviewConnector({ sourceType: 'MANUAL_UPLOAD' }, inbox)).toEqual({ connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import' })
    expect(resolveReviewConnector({ sourceType: 'GOOGLE_DRIVE', driveInboxItemId: 'missing' }, inbox)).toBeNull()
  })

  it('resolves recovered Drive, Gmail, watched-folder, and manual runs from one source-consistent identity', () => {
    const recoveredInbox = {
      drive: [{ ...driveRow, id: 'drive-run-item', importRunId: 'drive-run' }],
      gmail: [{ ...gmailRow, id: 'gmail-run-item', importRunId: 'gmail-run' }],
      watched: [{ ...watchedRow, id: 'folder-run-item', importRunId: 'folder-run' }],
    }

    expect(resolveReviewConnector({ sourceType: 'GOOGLE_DRIVE', importRunId: 'drive-run' }, recoveredInbox)).toEqual({ connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary' })
    expect(resolveReviewConnector({ sourceType: 'GMAIL', importRunId: 'gmail-run' }, recoveredInbox)).toEqual({ connectorKind: 'GMAIL', connectionKey: 'gmail-primary' })
    expect(resolveReviewConnector({ sourceType: 'LOCAL_FOLDER', importRunId: 'folder-run' }, recoveredInbox)).toEqual({ connectorKind: 'WATCHED_FOLDER', connectionKey: 'folder-primary' })
    expect(resolveReviewConnector({ sourceType: 'MANUAL_UPLOAD', importRunId: 'manual-run' }, recoveredInbox)).toEqual({ connectorKind: 'MANUAL_IMPORT', connectionKey: 'manual-import' })
  })

  it.each([
    ['mixed connector kinds', { sourceType: 'GOOGLE_DRIVE', importRunId: 'mixed-run' }, {
      drive: [{ ...driveRow, importRunId: 'mixed-run' }], gmail: [{ ...gmailRow, importRunId: 'mixed-run' }], watched: [],
    }],
    ['ambiguous Drive keys', { sourceType: 'GOOGLE_DRIVE', importRunId: 'ambiguous-run' }, {
      drive: [{ ...driveRow, importRunId: 'ambiguous-run' }, { ...driveRow, id: 'drive-item-2', connectionId: 'drive-secondary', importRunId: 'ambiguous-run' }], gmail: [], watched: [],
    }],
    ['source mismatch', { sourceType: 'GMAIL', importRunId: 'drive-run' }, {
      drive: [{ ...driveRow, importRunId: 'drive-run' }], gmail: [], watched: [],
    }],
    ['manual source with native row', { sourceType: 'MANUAL_UPLOAD', importRunId: 'mixed-manual-run' }, {
      drive: [{ ...driveRow, importRunId: 'mixed-manual-run' }], gmail: [], watched: [],
    }],
  ] as const)('fails closed for recovered %s', (_label, source, rows) => {
    expect(resolveReviewConnector(source, rows)).toBeNull()
    expect(isReviewConnectorResolutionValid(source, rows)).toBe(false)
    expect(filterReviewAccountOptions(source, [account('drive-bank')], [binding({
      connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary', allowedAccountIds: ['drive-bank'],
    })], rows)).toEqual([])
  })

  it('narrows only the source whose exact connector identity has a binding', () => {
    const bindings = [
      binding({ connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary', allowedAccountIds: ['drive-bank'] }),
      binding({ connectorKind: 'GMAIL', connectionKey: 'gmail-primary', allowedAccountIds: ['gmail-bank'] }),
      binding({ connectorKind: 'WATCHED_FOLDER', connectionKey: 'folder-primary', allowedAccountIds: ['folder-bank'] }),
    ]
    const accounts = ['drive-bank', 'gmail-bank', 'folder-bank', 'manual-bank'].map(account)

    expect(filterReviewAccountOptions({ driveInboxItemId: 'drive-item', sourceType: 'GOOGLE_DRIVE' }, accounts, bindings, inbox).map(({ id }) => id)).toEqual(['drive-bank'])
    expect(filterReviewAccountOptions({ gmailInboxItemId: 'gmail-item', sourceType: 'GMAIL' }, accounts, bindings, inbox).map(({ id }) => id)).toEqual(['gmail-bank'])
    expect(filterReviewAccountOptions({ watchedFolderId: 'folder-primary', sourceType: 'ICLOUD_PICKER' }, accounts, bindings, inbox).map(({ id }) => id)).toEqual(['folder-bank'])
    expect(filterReviewAccountOptions({ sourceType: 'MANUAL_UPLOAD' }, accounts, bindings, inbox).map(({ id }) => id)).toEqual(accounts.map(({ id }) => id))
    expect(bindingForReviewSource({ sourceType: 'MANUAL_UPLOAD' }, bindings, inbox)).toBeNull()
  })

  it('requires the bound parser ID and exact loaded version without choosing it', () => {
    const profiles = [
      { id: 'profile-bank', version: 2, name: 'Bank v2' },
      { id: 'profile-bank', version: 3, name: 'Bank v3' },
      { id: 'profile-card', version: 1, name: 'Card' },
    ]
    const bindings = [binding({
      connectorKind: 'GOOGLE_DRIVE', connectionKey: 'drive-primary', allowedAccountIds: ['drive-bank'],
      parserProfileId: 'profile-bank', parserProfileVersion: 2,
    })]

    expect(filterReviewParserOptions({ driveInboxItemId: 'drive-item' }, profiles, bindings, inbox)).toEqual([profiles[0]])
    expect(sanitizeReviewSelections({
      source: { driveInboxItemId: 'drive-item' }, accounts: [account('drive-bank')], profiles,
      bindings, inbox, selectedAccountIds: [], selectedParser: null,
    })).toMatchObject({ selectedAccountIds: [], selectedParser: null, needsRemapping: false })
  })

  it('clears archived accounts and incremented parser versions and fails staged review closed', () => {
    const bound = binding({
      allowedAccountIds: ['bank'], parserProfileId: 'profile-bank', parserProfileVersion: 2,
    })
    const state = sanitizeReviewSelections({
      source: { sourceType: 'MANUAL_UPLOAD' }, accounts: [account('other-bank')],
      profiles: [{ id: 'profile-bank', version: 3 }], bindings: [bound], inbox,
      selectedAccountIds: ['bank'], selectedParser: { id: 'profile-bank', version: 2 },
    })

    expect(state).toEqual({
      selectedAccountIds: [], selectedParser: null, needsRemapping: true,
    })
    expect(isStagedReviewBindingValid({
      binding: bound, candidateAccountIds: ['bank'], activeAccountIds: ['other-bank'],
      adapterId: 'custom-delimited-v1', adapterVersion: 'profile-bank@2',
    })).toBe(false)
    expect(isStagedReviewBindingValid({
      binding: bound, candidateAccountIds: ['bank'], activeAccountIds: ['bank'],
      adapterId: 'custom-delimited-v1', adapterVersion: 'profile-bank@3',
    })).toBe(false)
    expect(isStagedReviewBindingValid({
      binding: bound, candidateAccountIds: ['bank'], activeAccountIds: ['bank'],
      adapterId: 'custom-delimited-v1', adapterVersion: 'profile-bank@2',
    })).toBe(true)
  })
})
