const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

/** Cover ending within this many days is flagged. */
export const WARRANTY_SOON_DAYS = 60

export type WarrantyState = 'ENDED' | 'SOON' | 'ACTIVE'

export function warrantyState(expiresOn: string, today: string): { readonly state: WarrantyState; readonly daysLeft: number } {
  const daysLeft = dayNumber(expiresOn) - dayNumber(today)
  return { state: daysLeft < 0 ? 'ENDED' : daysLeft <= WARRANTY_SOON_DAYS ? 'SOON' : 'ACTIVE', daysLeft }
}
