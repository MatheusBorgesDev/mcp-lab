import type postgres from 'postgres'
import {
  completeEndedAppointments,
  deleteVisitorAppointments,
  lockAppointmentWrites,
  syncSeedAppointments,
} from '../db/appointments.js'
import { deleteEventsBefore } from '../db/events.js'
import { loadSchedule } from '../db/schedule.js'
import { bookingWindow } from '../domain/availability.js'
import { SHOP_RULES, type ShopRules } from '../domain/rules.js'
import { planDailyReset, type ResetPlan } from '../domain/seed.js'

/** How long the inspector keeps the calls (docs/SPEC.md, section 9). */
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type ResetSummary = {
  removedVisitorBookings: number
  removedSeeds: number
  addedSeeds: number
  completedBookings: number
  removedEvents: number
}

/**
 * The daily reset (docs/SPEC.md, section 9), inside the caller's transaction: visitor bookings go, the shop's
 * own bookings follow the plan, ended bookings become completed and old inspector events go. Running it twice
 * changes nothing the second time.
 */
export async function resetAgenda(tx: postgres.TransactionSql, plan: ResetPlan): Promise<ResetSummary> {
  await lockAppointmentWrites(tx)
  const removedVisitorBookings = await deleteVisitorAppointments(tx)
  const seeds = await syncSeedAppointments(tx, plan.seeds, plan.windowStart)
  const completedBookings = await completeEndedAppointments(tx, plan.now)
  const removedEvents = await deleteEventsBefore(tx, new Date(plan.now.getTime() - EVENT_RETENTION_MS))
  return { removedVisitorBookings, removedSeeds: seeds.removed, addedSeeds: seeds.added, completedBookings, removedEvents }
}

/** Plans the reset from the current catalogue and closures, then applies it in one transaction. */
export async function runDailyReset({
  sql,
  now = () => new Date(),
  rules = SHOP_RULES,
}: {
  sql: postgres.Sql
  now?: () => Date
  rules?: ShopRules
}): Promise<ResetSummary> {
  const instant = now()
  const plan = planDailyReset(await loadSchedule(sql, bookingWindow(instant, rules)), instant, rules)
  return sql.begin((tx) => resetAgenda(tx, plan)) as Promise<ResetSummary>
}

/**
 * The HTTP side of the reset: only the cron's caller gets in, and only with GET (what Vercel Cron sends). A
 * failure answers 500 without details; the reason goes to the log.
 */
export function createDailyResetHandler({
  isCron,
  run,
  log = console.error,
}: {
  isCron: (request: Request) => boolean
  run: () => Promise<ResetSummary>
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!isCron(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    if (request.method !== 'GET') {
      return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { allow: 'GET' } })
    }
    try {
      return Response.json({ ok: true, ...(await run()) })
    } catch (error) {
      log(`[daily-reset] failed: ${error instanceof Error ? error.message : typeof error}`)
      return Response.json({ ok: false, error: 'reset failed' }, { status: 500 })
    }
  }
}
