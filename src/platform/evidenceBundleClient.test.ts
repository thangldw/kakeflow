import { describe, expect, it, vi } from 'vitest'

import { createPlatformClient } from './client'
import type { Invoke } from './types'

const summary = {
  bundleId: 'bundle-1', householdId: 'family', originInstallationId: 'installation-1',
  documentCount: 3, recordCount: 48, plaintextBytes: 4096,
  importedDocumentCount: 1, deduplicatedDocumentCount: 2,
}

describe('portable evidence bundle platform boundary', () => {
  it('invokes the exact desktop export and import commands and validates summaries', async () => {
    const invoke = vi.fn(async () => summary) as unknown as Invoke
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.exportEvidenceBundle('family', 'twelve-chars-passphrase')).resolves.toEqual(summary)
    expect(invoke).toHaveBeenNthCalledWith(1, 'evidence_bundle_export_save', { householdId: 'family', passphrase: 'twelve-chars-passphrase' })

    await expect(client.pickAndImportEvidenceBundle('family', 'twelve-chars-passphrase')).resolves.toEqual(summary)
    expect(invoke).toHaveBeenNthCalledWith(2, 'evidence_bundle_pick_and_import', { householdId: 'family', passphrase: 'twelve-chars-passphrase' })
  })

  it('preserves a cancelled native file dialog as null', async () => {
    const client = createPlatformClient({ tauri: true, invoke: vi.fn(async () => null) as unknown as Invoke })
    await expect(client.exportEvidenceBundle('family', 'twelve-chars-passphrase')).resolves.toBeNull()
    await expect(client.pickAndImportEvidenceBundle('family', 'twelve-chars-passphrase')).resolves.toBeNull()
  })

  it('rejects missing identity and unsafe counts at the IPC boundary', async () => {
    const missingOrigin = createPlatformClient({ tauri: true, invoke: vi.fn(async () => ({ ...summary, originInstallationId: null })) as unknown as Invoke })
    await expect(missingOrigin.exportEvidenceBundle('family', 'twelve-chars-passphrase')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'evidence_bundle_export_save' })

    const invalidCount = createPlatformClient({ tauri: true, invoke: vi.fn(async () => ({ ...summary, recordCount: -1 })) as unknown as Invoke })
    await expect(invalidCount.pickAndImportEvidenceBundle('family', 'twelve-chars-passphrase')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', command: 'evidence_bundle_pick_and_import' })
  })

  it('exposes no evidence file operations in the browser preview', async () => {
    const invoke = vi.fn()
    const client = createPlatformClient({ tauri: false, invoke })
    await expect(client.exportEvidenceBundle('family', 'twelve-chars-passphrase')).rejects.toMatchObject({ command: 'evidence_bundle_export_save' })
    await expect(client.pickAndImportEvidenceBundle('family', 'twelve-chars-passphrase')).rejects.toMatchObject({ command: 'evidence_bundle_pick_and_import' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
