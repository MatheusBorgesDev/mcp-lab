/** Business rules from docs/SPEC.md, section 3. */
export const SHOP_RULES = {
  timeZone: 'America/Sao_Paulo',
  slotMinutes: 15,
  minAdvanceMinutes: 120,
  maxDaysAhead: 14,
  minChangeAdvanceMinutes: 120,
  suggestionCount: 3,
} as const

export type ShopRules = typeof SHOP_RULES
