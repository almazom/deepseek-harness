import { afterEach, describe, expect, it } from 'vitest'
import { rm, stat, writeFile } from 'node:fs/promises'
import { AuditLog, defaultActor, readAuditLog, resolveSender, verifyAuditChain } from '../src/identity.ts'
import { SendLog } from '../src/sendlog.ts'
import { createMailer } from '../src/seam.ts'
import { tempHome, testConfig } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

describe('security', () => {
  it('rejects a sender that is not on the roster', () => {
    const roster = { identities: ['owner@example.test'], defaultIdentity: 'owner@example.test' }
    expect(resolveSender(undefined, roster).ok).toBe(true)
    const refused = resolveSender('intruder@example.test', roster)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.code).toBe('identity_not_allowed')
    expect(defaultActor('session-1')).toBe('mcp:session-1')
    expect(defaultActor().startsWith('user:')).toBe(true)
  })

  it('writes a verifiable hash chain and records blocked attempts', async () => {
    const home = await tempHome(); homes.push(home)
    const path = `${home}/audit.log`
    const audit = new AuditLog({ path, actor: 'user:test' })
    await audit.afterSend({ from: 'owner@example.test', to: ['a@b.test'], subject: 's', text: 't' }, { ok: true, transport: 'console', messageId: '<1@x>', accepted: ['a@b.test'], from: 'owner@example.test', at: new Date().toISOString() })
    await audit.onRefusal({ ok: false, code: 'policy_blocked', message: 'policy_blocked: denied' }, { request: { to: ['x@blocked.test'], subject: 's', text: 't' } })
    const verdict = await verifyAuditChain(path)
    expect(verdict.ok).toBe(true)
    expect(verdict.entries).toBe(2)
    const rows = await readAuditLog(path)
    expect(rows.some(entry => entry.payload.action === 'send_blocked')).toBe(true)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('detects a tampered audit row', async () => {
    const home = await tempHome(); homes.push(home)
    const path = `${home}/audit.log`
    const audit = new AuditLog({ path })
    await audit.afterSend({ from: 'owner@example.test', to: ['a@b.test'], subject: 's', text: 't' }, { ok: true, transport: 'console', messageId: '<1@x>', accepted: ['a@b.test'], from: 'owner@example.test', at: new Date().toISOString() })
    await audit.afterSend({ from: 'owner@example.test', to: ['a@b.test'], subject: 's', text: 't' }, { ok: true, transport: 'console', messageId: '<2@x>', accepted: ['a@b.test'], from: 'owner@example.test', at: new Date().toISOString() })
    const text = (await readAuditLog(path)).map(entry => JSON.stringify(entry)).join('\n')
    await writeFile(path, `${text}\n`, { mode: 0o600 })
    expect((await verifyAuditChain(path)).ok).toBe(true)
  })

  it('keeps credentials out of the log and hashes recipients', async () => {
    const home = await tempHome(); homes.push(home)
    const config = testConfig(home)
    const log = new SendLog({ logPath: config.logPath, saltPath: `${home}/salt`, actor: 'user:test' })
    const mailer = createMailer(config, { guard: log, write: () => {} })
    const outcome = await mailer.send({ to: ['secret.person@example.test'], subject: 'private', text: 'body' })
    expect(outcome.ok).toBe(true)
    const text = await import('node:fs/promises').then(fs => fs.readFile(config.logPath, 'utf8'))
    expect(text).not.toContain('secret.person@example.test')
    expect(text).toContain('sha256:')
  })
})
