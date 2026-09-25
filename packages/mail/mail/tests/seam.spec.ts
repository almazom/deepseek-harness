import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { createMailer, checkPolicy, isAddress, matchesPattern, parseRecipients, assembleLetter } from '../src/seam.ts'
import type { MailGuard, MailTransport } from '../src/seam.ts'
import { tempHome, testConfig } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

describe('seam', () => {
  it('prints a console letter and reports it as sent', async () => {
    const home = await tempHome(); homes.push(home)
    const lines: string[] = []
    const mailer = createMailer(testConfig(home), { write: (line) => { lines.push(line) } })
    const outcome = await mailer.send({ to: ['timur@example.test'], subject: 'console check', text: 'body text' })
    expect(outcome.ok).toBe(true)
    const printed = lines.join('')
    expect(printed).toContain('[console transport]')
    expect(printed).toContain('console check')
    expect(printed).toContain('body text')
  })

  it('treats a policy refusal as data, not an exception', async () => {
    const home = await tempHome(); homes.push(home)
    const mailer = createMailer(testConfig(home, { policy: { allow: [], deny: ['*@blocked.example'] } }), { write: () => {} })
    const outcome = await mailer.send({ to: ['someone@blocked.example'], subject: 'no', text: 'x' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('policy_blocked')
      expect(outcome.scope).toBe('deny')
    }
  })

  it('refuses a sender outside the roster', async () => {
    const home = await tempHome(); homes.push(home)
    const config = testConfig(home, { from: 'owner@example.test', identities: ['owner@example.test'] })
    const mailer = createMailer(config, { write: () => {} })
    const outcome = await mailer.send({ to: ['timur@example.test'], from: 'intruder@example.test', subject: 'x', text: 'y' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('identity_not_allowed')
  })

  it('never calls the transport when a guard refuses first', async () => {
    const home = await tempHome(); homes.push(home)
    let calls = 0
    const transport: MailTransport = {
      name: 'console',
      label: 'counting',
      send: async () => { calls += 1; return { ok: true, transport: 'console', messageId: '<n@x>', accepted: ['a@b.test'], from: 'f@b.test', at: new Date().toISOString() } },
    }
    const guard: MailGuard = { beforeSend: () => ({ ok: false, code: 'rate_limited', message: 'rate_limited: stop' }) }
    const mailer = createMailer(testConfig(home), { transports: { console: transport }, guard })
    const outcome = await mailer.send({ to: ['a@b.test'], subject: 's', text: 't' })
    expect(outcome.ok).toBe(false)
    expect(calls).toBe(0)
  })

  it('records the transport verdict for every guard', async () => {
    const home = await tempHome(); homes.push(home)
    const seen: string[] = []
    const guard: MailGuard = {
      afterSend: (_letter, outcome) => { seen.push(outcome.ok ? 'ok' : 'failed') },
    }
    const failing: MailTransport = {
      name: 'console',
      label: 'always fails',
      send: async () => ({ ok: false, code: 'transport', message: 'transport: relay said no' }),
    }
    const mailer = createMailer(testConfig(home), { transports: { console: failing }, guard })
    const outcome = await mailer.send({ to: ['a@b.test'], subject: 's', text: 't' })
    expect(outcome.ok).toBe(false)
    expect(seen).toEqual(['failed'])
  })

  it('parses recipients, matches patterns, and checks addresses', () => {
    expect(parseRecipients('a@b.test, c@d.test')).toEqual(['a@b.test', 'c@d.test'])
    expect(isAddress('a@b.test')).toBe(true)
    expect(isAddress('a@localhost')).toBe(false)
    expect(matchesPattern('a@b.test', '*@b.test')).toBe(true)
    expect(matchesPattern('a@b.test', 'b.test')).toBe(true)
    expect(checkPolicy(['a@b.test'], { allow: [], deny: [] })).toBeUndefined()
  })

  it('assembles a letter and refuses a bad subject', () => {
    const config = { ...testConfig('/tmp') }
    const ok = assembleLetter({ to: ['a@b.test'], subject: 'hello', text: 'x' }, config)
    expect(ok.ok).toBe(true)
    const bad = assembleLetter({ to: ['a@b.test'], subject: 'two\nlines', text: 'x' }, config)
    expect(bad.ok).toBe(false)
  })
})
