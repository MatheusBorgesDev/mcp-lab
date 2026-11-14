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
  /** Share of each day's working minutes the daily reset fills with the shop's own (fictitious) bookings. */
  seedOccupancyPercent: 30,
} as const

/** The rules' shape, numbers widened: tests and callers can pass other values than the shop's. */
export type ShopRules = {
  readonly [K in keyof typeof SHOP_RULES]: (typeof SHOP_RULES)[K] extends number ? number : (typeof SHOP_RULES)[K]
}
