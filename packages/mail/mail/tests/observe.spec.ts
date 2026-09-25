import { afterEach, describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { appendSendLogRecord, ensureSalt, FailureAlerter, formatDmarcDigest, formatSendLogSummary, hashRecipient, parseDmarcReport, readDmarcReports, readSendLog, rotateSendLog, summarizeSendLog } from '../src/sendlog.ts'
import type { SendLogRecord } from '../src/sendlog.ts'
import { tempHome } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

const record = (at: string, status: SendLogRecord['status'] = 'sent'): SendLogRecord => ({ at, status, from: 'a@b.test', recipients: ['sha256:deadbeef'] })

describe('observe', () => {
  it('hashes recipients with a per-host salt', async () => {
    const home = await tempHome(); homes.push(home)
    const salt = await ensureSalt(`${home}/salt`)
    expect(hashRecipient('a@b.test', salt)).toBe(hashRecipient('a@b.test', salt))
    expect(hashRecipient('a@b.test', salt)).not.toBe(hashRecipient('c@d.test', salt))
    expect(hashRecipient('a@b.test', salt).startsWith('sha256:')).toBe(true)
  })

  it('appends, reads, and summarizes rows', async () => {
    const home = await tempHome(); homes.push(home)
    const path = `${home}/send.log.jsonl`
    await appendSendLogRecord(path, record('2026-09-25T10:00:00.000Z'))
    await appendSendLogRecord(path, record('2026-09-25T11:00:00.000Z', 'refused'))
    await writeFile(path, `${await import('node:fs/promises').then(fs => fs.readFile(path, 'utf8'))}torn`, { flag: 'w' })
    const rows = await readSendLog(path)
    expect(rows.length).toBe(2)
    expect((await readSendLog(path, { limit: 1 })).length).toBe(1)
    const summary = await summarizeSendLog(path, { now: new Date('2026-09-25T12:00:00.000Z') })
    expect(summary.total).toBe(2)
    expect(summary.sent).toBe(1)
    expect(summary.refused).toBe(1)
    expect(formatSendLogSummary(summary)).toContain('sent')
  })

  it('rotates a log that outgrew its cap', async () => {
    const home = await tempHome(); homes.push(home)
    const path = `${home}/rotate.jsonl`
    await appendSendLogRecord(path, record('2026-09-25T10:00:00.000Z'))
    const small = await rotateSendLog(path, { maxBytes: 1 })
    expect(small.rotated).toBe(true)
    expect(small.archive).toBeDefined()
    expect((await rotateSendLog(path, { maxBytes: 1024 })).rotated).toBe(false)
  })

  it('alerts once per window after the threshold', async () => {
    const home = await tempHome(); homes.push(home)
    const alerts: string[] = []
    const alerter = new FailureAlerter({ channel: async (message) => { alerts.push(message) }, threshold: 2, windowMs: 60_000 })
    expect(await alerter.record('first')).toBe(false)
    expect(await alerter.record('second')).toBe(true)
    expect(await alerter.record('third')).toBe(false)
    expect(alerts.length).toBe(1)
    expect(alerts[0]).toContain('failures')
  })

  it('parses DMARC reports and formats a digest', async () => {
    const home = await tempHome(); homes.push(home)
    const directory = `${home}/dmarc`
    await mkdir(directory, { recursive: true })
    const xml = '<?xml version="1.0"?><feedback><policy_published><domain>family.test</domain></policy_published><record><row><source_ip>203.0.113.9</source_ip><count>4</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row></record></feedback>'
    const records = parseDmarcReport(xml)
    expect(records.length).toBe(1)
    expect(records[0].sourceIp).toBe('203.0.113.9')
    expect(records[0].count).toBe(4)
    expect(records[0].domain).toBe('family.test')
    await writeFile(`${directory}/one.xml`, xml)
    await writeFile(`${directory}/two.xml.gz`, gzipSync(Buffer.from(xml, 'utf8')))
    expect((await readDmarcReports(directory)).length).toBe(2)
    expect(formatDmarcDigest(records)).toContain('203.0.113.9')
    expect(parseDmarcReport('<feedback></feedback>')).toEqual([])
  })
})
