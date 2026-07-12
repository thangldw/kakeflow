import { describe, expect, it, vi } from 'vitest'
import { createDelimitedParserProfilePlatform, delimitedParserProfileDraft, type DelimitedParserProfileDto } from './delimitedParserProfilePlatform'

const profile: DelimitedParserProfileDto = {
  id: 'profile-1', householdId: 'family', name: 'Local bank TSV', delimiter: 'TAB', encoding: 'CP932', headerRow: 2,
  dateColumn: '日付', dateFormat: 'YYYY_MM_DD', descriptionColumn: '摘要', payeeColumn: null, amountMode: 'DEBIT_CREDIT',
  signedPositiveDirection: null,
  signedAmountColumn: null, debitColumn: '支払い金額', creditColumn: '預かり金額', externalIdColumn: null, accountHintColumn: '口座',
  isEnabled: true, priority: 10, version: 3, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T01:00:00Z',
}

describe('delimited parser profile platform', () => {
  it('forwards exact CRUD commands including optimistic versions', async () => {
    const invoke = vi.fn(async (command: string) => command === 'delimited_parser_profiles_list' ? [profile] : command === 'delimited_parser_profile_delete' ? null : profile)
    const platform = createDelimitedParserProfilePlatform(invoke)
    await expect(platform.list('family')).resolves.toEqual([profile])
    const draft = delimitedParserProfileDraft(profile)
    await expect(platform.create(draft)).resolves.toEqual(profile)
    const { id, ...fields } = draft
    await expect(platform.update({ ...fields, profileId: id, expectedVersion: profile.version })).resolves.toEqual(profile)
    await expect(platform.delete({ householdId: 'family', profileId: profile.id, expectedVersion: profile.version })).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('delimited_parser_profile_update', { input: expect.objectContaining({ profileId: 'profile-1', expectedVersion: 3 }) })
    expect(invoke).toHaveBeenCalledWith('delimited_parser_profile_delete', { input: { householdId: 'family', profileId: 'profile-1', expectedVersion: 3 } })
  })

  it('rejects malformed enums and non-positive versions', async () => {
    await expect(createDelimitedParserProfilePlatform(async () => [{ ...profile, delimiter: 'PIPE' }]).list('family')).rejects.toThrow(TypeError)
    await expect(createDelimitedParserProfilePlatform(async () => ({ ...profile, version: 0 })).create(profile)).rejects.toThrow(TypeError)
    await expect(createDelimitedParserProfilePlatform(async () => [{ ...profile, headerRow: 1001 }]).list('family')).rejects.toThrow(TypeError)
    await expect(createDelimitedParserProfilePlatform(async () => [{ ...profile, priority: -1 }]).list('family')).rejects.toThrow(TypeError)
    await expect(createDelimitedParserProfilePlatform(async () => [{ ...profile, amountMode: 'SIGNED', signedPositiveDirection: null, signedAmountColumn: '金額', debitColumn: null, creditColumn: null }]).list('family')).rejects.toThrow(TypeError)
    await expect(createDelimitedParserProfilePlatform(async () => [{ ...profile, dateColumn: '摘要' }]).list('family')).rejects.toThrow(TypeError)
  })
})
