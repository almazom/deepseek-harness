import { afterEach, describe, expect, it } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SmtpError, sendViaSmtp } from '../src/smtp.ts'
import { SmtpTransport, createMailer } from '../src/seam.ts'
import { assembleLetter } from '../src/seam.ts'
import { dotStuff, renderLetter as render } from '../src/mime.ts'
import { tempHome, testConfig, startSmtpPeer } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

describe('smtp', () => {
  it('submits a letter through a real conversation', async () => {
    const home = await tempHome(); homes.push(home)
    const peer = await startSmtpPeer()
    try {
      const assembled = assembleLetter({ to: ['a@b.test'], subject: 'wire check', text: 'body' }, testConfig(home))
      expect(assembled.ok).toBe(true)
      if (!assembled.ok) return
      const rendered = render(assembled.letter)
      const delivery = await sendViaSmtp({
        host: '127.0.0.1', port: peer.port, user: 'u', password: 'p',
        from: assembled.letter.from, recipients: assembled.letter.to,
        raw: dotStuff(rendered.raw), timeoutMs: 5_000, requireTls: false,
      })
      expect(delivery.accepted).toEqual(['a@b.test'])
      expect(delivery.rejected).toEqual([])
      expect(peer.transcript.some(line => line.toUpperCase().startsWith('AUTH LOGIN'))).toBe(true)
      expect(peer.transcript.some(line => line.toUpperCase().startsWith('DATA'))).toBe(true)
    } finally {
      await peer.close()
    }
  })

  it('reports a rejected recipient without failing the conversation', async () => {
    const home = await tempHome(); homes.push(home)
    const peer = await startSmtpPeer({ rejectAddress: 'gone@b.test' })
    try {
      const assembled = assembleLetter({ to: ['ok@b.test', 'gone@b.test'], subject: 'x', text: 'y' }, testConfig(home))
      if (!assembled.ok) throw new Error('assembly failed')
      const rendered = render(assembled.letter)
      const delivery = await sendViaSmtp({
        host: '127.0.0.1', port: peer.port, user: 'u', password: 'p',
        from: assembled.letter.from, recipients: assembled.letter.to,
        raw: dotStuff(rendered.raw), timeoutMs: 5_000, requireTls: false,
      })
      expect(delivery.accepted).toEqual(['ok@b.test'])
      expect(delivery.rejected.map(entry => entry.address)).toEqual(['gone@b.test'])
      expect(delivery.rejected[0]?.reply).toMatch(/550/)
      expect(peer.transcript.some(line => line.toUpperCase().startsWith('DATA'))).toBe(true)
    } finally {
      await peer.close()
    }
  })

  it('refuses the whole submission when every recipient is rejected', async () => {
    const home = await tempHome(); homes.push(home)
    const peer = await startSmtpPeer({ rejectRecipient: true })
    try {
      const assembled = assembleLetter({ to: ['gone@b.test'], subject: 'x', text: 'y' }, testConfig(home))
      if (!assembled.ok) throw new Error('assembly failed')
      const rendered = render(assembled.letter)
      await expect(sendViaSmtp({
        host: '127.0.0.1', port: peer.port, user: 'u', password: 'p',
        from: assembled.letter.from, recipients: assembled.letter.to,
        raw: dotStuff(rendered.raw), timeoutMs: 5_000, requireTls: false,
      })).rejects.toThrow(/every recipient was refused/)
      expect(peer.transcript.some(line => line.toUpperCase().startsWith('DATA'))).toBe(false)
    } finally {
      await peer.close()
    }
  })

  it('throws SmtpError when the relay refuses the greeting', async () => {
    const home = await tempHome(); homes.push(home)
    const peer = await startSmtpPeer({ failGreeting: true })
    try {
      const assembled = assembleLetter({ to: ['a@b.test'], subject: 'x', text: 'y' }, testConfig(home))
      if (!assembled.ok) throw new Error('assembly failed')
      const rendered = render(assembled.letter)
      await expect(sendViaSmtp({
        host: '127.0.0.1', port: peer.port, user: 'u', password: 'p',
        from: assembled.letter.from, recipients: assembled.letter.to,
        raw: rendered.raw, timeoutMs: 5_000, requireTls: false,
      })).rejects.toBeInstanceOf(SmtpError)
    } finally {
      await peer.close()
    }
  })

  it('delivers through the smtp transport using credentials from the store', async () => {
    const home = await tempHome(); homes.push(home)
    const peer = await startSmtpPeer()
    try {
      const credentialsPath = join(home, 'credentials.yaml')
      await writeFile(credentialsPath, [
        'version: 1',
        'refs: {}',
        'records:',
        '  smtp/mail-relay:',
        '    kind: grant',
        '    payload:',
        '      host: 127.0.0.1',
        `      port: ${peer.port}`,
        '      user: peer-user',
        '      pass: peer-secret',
        '',
      ].join('\n'), { mode: 0o600 })
      const config = testConfig(home, { transport: 'smtp', credentialsPath })
      const mailer = createMailer(config, {
        transports: { smtp: new SmtpTransport({ requireTls: false, timeoutMs: 5_000 }) },
      })
      const outcome = await mailer.send({ to: ['a@b.test'], subject: 'via smtp', text: 'payload' })
      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.transport).toBe('smtp')
    } finally {
      await peer.close()
    }
  })
})
