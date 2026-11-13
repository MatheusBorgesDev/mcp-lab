/** Business rules from docs/SPEC.md, section 3. */
export const SHOP_RULES = {
  timeZone: 'America/Sao_Paulo',
  slotMinutes: 15,
  minAdvanceMinutes: 120,
  maxDaysAhead: 14,
  minChangeAdvanceMinutes: 120,
  suggestionCount: 3,
  /** Upcoming confirmed appointments one visitor (IP) may hold. */
  maxActiveBookingsPerVisitor: 2,
  /** Visitors book only while the day stays at or below this share of its working minutes, fictitious
   * appointments included: the rest stays free for the next visitor. */
  maxDailyOccupancyPercent: 70,
} as const

export type ShopRules = typeof SHOP_RULES
