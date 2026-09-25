import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { checkLimits, defaultVolumeLimits, readRateState, writeRateState, RateLimiter } from '../src/limits.ts'
import type { RateState } from '../src/limits.ts'
import { tempHome } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

const empty: RateState = { version: 1, records: [] }
const limits = { perMinute: 1, perHour: 2, perDay: 3, perRecipientPerDay: 1, newRecipientPerHour: 5, bulkRecipients: 2 }

describe('guard', () => {
  it('trips the per-minute cap and reports a retry delay', () => {
    const state: RateState = { version: 1, records: [{ at: new Date().toISOString(), recipients: ['a@b.test'] }] }
    const failure = checkLimits(state, ['c@d.test'], limits)
    expect(failure?.code).toBe('rate_limited')
    expect(failure?.scope).toBe('per-minute')
    expect(failure?.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('counts each cap independently', () => {
    const now = new Date('2026-09-25T12:00:00.000Z')
    const hour = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
    const day = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
    expect(checkLimits({ version: 1, records: [{ at: hour, recipients: ['a@b.test'] }, { at: hour, recipients: ['c@d.test'] }] }, ['e@f.test'], limits, { now })?.scope).toBe('per-hour')
    expect(checkLimits({ version: 1, records: [{ at: day, recipients: ['a@b.test'] }, { at: day, recipients: ['c@d.test'] }, { at: day, recipients: ['e@f.test'] }] }, ['g@h.test'], limits, { now })?.scope).toBe('per-day')
  })

  it('refuses a new recipient beyond the first-contact allowance', () => {
    const state: RateState = { version: 1, records: [] }
    expect(checkLimits(state, ['a@b.test'], { ...limits, newRecipientPerHour: 0 })?.scope).toBe('new-recipient')
  })

  it('requires an explicit batch flag for many recipients', () => {
    const failure = checkLimits(empty, ['a@b.test', 'c@d.test', 'e@f.test'], limits)
    expect(failure?.scope).toBe('bulk')
    expect(checkLimits(empty, ['a@b.test', 'c@d.test', 'e@f.test'], limits, { batch: true })?.scope).toBeUndefined()
  })

  it('keeps counting when the clock moves backwards', () => {
    const now = new Date('2026-09-25T12:00:00.000Z')
    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    const failure = checkLimits({ version: 1, records: [{ at: future, recipients: ['a@b.test'] }] }, ['c@d.test'], limits, { now })
    expect(failure?.code).toBe('rate_limited')
  })

  it('round-trips state and records only successful sends', async () => {
    const home = await tempHome(); homes.push(home)
    const path = `${home}/rate.json`
    await writeRateState(path, { version: 1, records: [{ at: new Date().toISOString(), recipients: ['a@b.test'] }] })
    const read = await readRateState(path)
    expect(read.records.length).toBe(1)
    expect((await readRateState(`${home}/missing.json`)).records).toEqual([])
    const limiter = new RateLimiter({ statePath: `${home}/guard.json`, limits: defaultVolumeLimits })
    await limiter.afterSend({ from: 'a@b.test', to: ['c@d.test'], subject: 's', text: 't' }, { ok: false, code: 'transport', message: 'no' })
    expect((await limiter.counts()).day).toBe(0)
  })
})
