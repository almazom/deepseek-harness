import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generationLogPath, scanLog } from '../src/format.ts'

const id = SessionId('v3-admission')
const header = { type: 'session', version: 3, id, createdAt: 1000, isSeeded: false, delegationDepth: 0 }
const start = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }
const prefix = [header, start].map(row => JSON.stringify(row)).join('\n') + '\n'
const obsoleteTypes = ['tool/code-dispatch-start', 'tool/code-dispatch'] as const

function obsoleteEvent(type: string, ignorable?: true) {
  return {
    type, seq: 1, time: 2,
    data: { rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'read', arguments: {} },
    ...(ignorable ? { ignorable } : {}),
  }
}

/** A direct scan refuses the stored v3 header before validating or decoding any event row. */
function expectScanRefusal(bytes: Buffer): void {
  expect(() => scanLog(bytes)).toThrow(SessionFormatUnsupportedError)
  expect(() => scanLog(bytes)).toThrow(/uses log format v3, older than the supported v4/)
}

describe('historical V3 event admission through v3-to-v4 publication', () => {
  let root: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-v3-admission-'))
    ctx = new Context()
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  })

  afterEach(async () => {
    try {
      await ctx?.fiber.dispose()
    } finally {
      if (root !== undefined) await rm(root, { recursive: true, force: true })
    }
  })

  async function store(bytes: Buffer): Promise<string> {
    const path = generationLogPath(root, undefined, id, 3, 'none')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    return path
  }

  it.each([{ surfaceOp: 'append' }, { sourceEventSeqs: [] }])('refuses unknown required metadata %j without truncating a provider append', async (metadata) => {
    const event = { type: 'future/required', seq: 0, time: 1, data: {}, ...metadata }
    const bytes = Buffer.from([header, event].map(row => JSON.stringify(row)).join('\n') + '\n')
    expectScanRefusal(bytes)
    const path = await store(bytes)
    const sourceStat = await stat(path)
    for (const access of ['read', 'write'] as const) {
      const opened = ctx.sessionPersistence.open(id, access).then(async (handle) => {
        if (access === 'read') await handle.read()
        else await handle.append([{ type: 'turn/start', seq: SessionSeq(1), time: 2, data: { turn: 1 } }])
        await handle.close()
      })
      await expect(opened).rejects.toThrow(SessionFormatUnsupportedError)
      await expect(opened).rejects.toThrow('format v2 contains unknown event type "future/required" at seq 0')
      await expect(opened).rejects.toThrow('; source v3 artifact remains unchanged (raw log: ')
      expect(await readFile(path)).toEqual(bytes)
      expect(await stat(path)).toMatchObject({ dev: sourceStat.dev, ino: sourceStat.ino })
    }
  })

  it.each(obsoleteTypes)('scanLog refuses a stored v3 log with a complete required %s EOF row before decoding it', (type) => {
    const bytes = Buffer.from(prefix + JSON.stringify(obsoleteEvent(type)) + '\n')
    expectScanRefusal(bytes)
  })

  it.each(obsoleteTypes.flatMap(type => ['', '{not json\n', 'null\n'].map(corruption => ({ type, corruption }))))(
    'admits required $type after "$corruption" per publication tail policy without changing v3 bytes', async ({ type, corruption }) => {
      const bytes = Buffer.from(prefix + corruption + JSON.stringify(obsoleteEvent(type)) + '\n')
      expectScanRefusal(bytes)
      const path = await store(bytes)
      const sourceStat = await stat(path)
      if (corruption === '{not json\n') {
        // The unparsable record starts a recoverable tail; the required row behind it is dropped with it.
        const reader = await ctx.sessionPersistence.open(id, 'read')
        try {
          expect((await reader.read()).events).toEqual([start])
        } finally {
          await reader.close()
        }
      } else {
        for (const access of ['read', 'write'] as const) {
          const opened = ctx.sessionPersistence.open(id, access).then(async (handle) => {
            await handle.close()
          })
          await expect(opened).rejects.toThrow(SessionFormatUnsupportedError)
          await expect(opened).rejects.toThrow('format v3 contains unknown event type "' + type + '" at seq 1')
          await expect(opened).rejects.toThrow('; source v3 artifact remains unchanged (raw log: ')
        }
      }
      expect(await readFile(path)).toEqual(bytes)
      expect(await stat(path)).toMatchObject({ dev: sourceStat.dev, ino: sourceStat.ino })
    },
  )

  it.each(['', '{not json\n', 'null\n'])('handles malformed system payloads after %j per publication tail policy without modifying storage', async (corruption) => {
    const malformed = { type: 'system/message', seq: 1, time: 2, data: null, surfaceOp: 'append' }
    const bytes = Buffer.from(prefix + corruption + JSON.stringify(malformed) + '\n')
    expectScanRefusal(bytes)
    const path = await store(bytes)
    const sourceStat = await stat(path)
    if (corruption === '{not json\n') {
      // The unparsable record starts a recoverable tail; the malformed row behind it is dropped with it.
      const reader = await ctx.sessionPersistence.open(id, 'read')
      try {
        expect((await reader.read()).events).toEqual([start])
      } finally {
        await reader.close()
      }
    } else {
      for (const access of ['read', 'write'] as const) {
        const opened = ctx.sessionPersistence.open(id, access).then(async (handle) => {
          await handle.close()
        })
        await expect(opened).rejects.toThrow('system/message data must be an object')
      }
    }
    expect(await readFile(path)).toEqual(bytes)
    expect(await stat(path)).toMatchObject({ dev: sourceStat.dev, ino: sourceStat.ino })
  })

  it.each(obsoleteTypes)('retains ignorable %s through publication and a provider append', async (type) => {
    const event = obsoleteEvent(type, true)
    const bytes = Buffer.from(prefix + JSON.stringify(event) + '\n')
    expectScanRefusal(bytes)
    const path = await store(bytes)
    const writer = await ctx.sessionPersistence.open(id, 'write')
    const end = {
      type: 'turn/end' as const, seq: SessionSeq(2), time: 3, data: { turn: 1, reason: { kind: 'completed' as const } },
    }
    try {
      expect((await writer.read()).events).toEqual([start, event])
      await writer.append([end])
    } finally {
      await writer.close()
    }
    // Publication writes the v4 successor; the v3 source keeps its exact bytes.
    expect(await readFile(path)).toEqual(bytes)
    const reopened = await ctx.sessionPersistence.open(id, 'read')
    try {
      expect((await reopened.read()).events).toEqual([start, event, end])
    } finally {
      await reopened.close()
    }
  })

  it.each([
    '{not json',
    'null',
    JSON.stringify({ type: 'user/message', seq: 1, time: 2, data: {
      id: 'missing-surface-op', role: 'user', content: [{ type: 'text', text: 'malformed canonical tail' }],
    } }),
  ])('still recovers an ordinary malformed EOF row: %s', async (tail) => {
    const bytes = Buffer.from(prefix + tail + '\n')
    expectScanRefusal(bytes)
    const path = await store(bytes)
    const writer = await ctx.sessionPersistence.open(id, 'write')
    const end = {
      type: 'turn/end' as const, seq: SessionSeq(1), time: 3, data: { turn: 1, reason: { kind: 'completed' as const } },
    }
    try {
      expect((await writer.read()).events).toEqual([start])
      await writer.append([end])
    } finally {
      await writer.close()
    }
    // The append lands in the published v4 successor; the v3 source stays byte-identical, torn tail included.
    expect(await readFile(path, 'utf8')).toBe(prefix + tail + '\n')
    const reopened = await ctx.sessionPersistence.open(id, 'read')
    try {
      expect((await reopened.read()).events).toEqual([start, end])
    } finally {
      await reopened.close()
    }
  })
})
