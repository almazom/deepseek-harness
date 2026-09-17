/**
 * REAL-composition proof: the shipped advisory YAML shape (session + LLM
 * runtime + projection registry + session-query + the advisor dispatcher)
 * boots through the vendored Loader, the dispatcher registers the
 * `advisor/run` projection, and one advisory side run lands its whole
 * model-visible pipeline — request, steps, verdict — in the session log.
 * Only the persistence read and the model route are stubbed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LlmAdapter, LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as AdvisorDispatcher from '../src/dispatcher.ts'

class FixtureAdvisorAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    expect(options.provider).toBe('fixture')
    yield { type: 'text-delta', index: 0, text: '{"tail": {"finding": "Composing loader rows."}}\n' }
    yield { type: 'text-delta', index: 0, text: '{"compare": {"finding": "Queued ask matches the tail."}}\n' }
    yield { type: 'text-delta', index: 0, text: '{"risk": {"finding": "Low: queue holds until settled."}}\n' }
    yield { type: 'text-delta', index: 0, text: '{"verdict": {"kind": "send-now", "confidence": 0.96, "reason": "Idle turn."}}\n' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class FixtureSessionQuery extends Service {
  static inject: string[] = []
  readonly observed: unknown = { header: {}, inheritedEventCount: 0, events: [] }

  constructor(ctx: Context) {
    super(ctx, 'sessionQuery')
  }

  /** Serve the empty observed log; the composed dispatcher reads nothing else. */
  async readSession(): Promise<unknown> {
    return this.observed
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadAdvisorYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-advisor-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-session-query', FixtureSessionQuery],
    ['@deepseek-ai/dsh-session-advisor-llm/dispatcher', AdvisorDispatcher],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('boots the advisory YAML shape and lands one whole advisory side run', async () => {
    const loaded = await loadAdvisorYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-session-query'",
      "- name: '@deepseek-ai/dsh-session-advisor-llm/dispatcher'",
      '  config:',
      '    maxInputBytes: 4000',
      '    maxOutputTokens: 256',
      '    timeoutMs: 2000',
      '    tailEntries: 12',
      '    recentRequests: 5',
      '    provider: fixture',
      '    model: fixture-advisor',
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    loaded.llm.registerAdapter(['fixture'], new FixtureAdvisorAdapter())
    const session = loaded.sessions.create(SessionId('composed-advisor'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'ship the queued reply now?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const runId = await loaded.queueAdvisor!.run({
      session,
      queuedItemId: 'queued-1',
      queuedMessage: 'ship the queued reply now?',
    })
    expect(runId).toBe('1')

    const types = session.snapshotEvents().map(event => event.type)
    expect(types).toEqual([
      'user/message',
      'advisor/run-requested',
      'advisor/step',
      'advisor/step',
      'advisor/step',
      'advisor/verdict',
    ])

    const live = loaded.sessionProjections.snapshot(session).values['advisor/run']
    expect(live).toMatchObject({
      runId: '1',
      queuedItemId: 'queued-1',
      status: 'done',
      steps: [
        { step: 'tail', finding: 'Composing loader rows.' },
        { step: 'compare', finding: 'Queued ask matches the tail.' },
        { step: 'risk', finding: 'Low: queue holds until settled.' },
      ],
      verdict: { kind: 'send-now', confidence: 0.96, reason: 'Idle turn.' },
    })
  })

  it('unregisters the advisor projection unit and service slot on disposal', async () => {
    const loaded = await loadAdvisorYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-session-query'",
      "- name: '@deepseek-ai/dsh-session-advisor-llm/dispatcher'",
      '  config:',
      '    maxInputBytes: 4000',
      '    maxOutputTokens: 256',
      '    timeoutMs: 2000',
      '    tailEntries: 12',
      '    recentRequests: 5',
      '    provider: fixture',
      '    model: fixture-advisor',
    ])
    expect(loaded.queueAdvisor).toBeDefined()
    const session = loaded.sessions.create(SessionId('disposal-advisor'))
    // Dispose only the dispatcher's fiber: the HMR-safety contract observes the
    // plugin's registry contribution disappear while its host registry survives.
    const advisorEntry = [...loaded.loader.entries()]
      .find(entry => entry.options.name === '@deepseek-ai/dsh-session-advisor-llm/dispatcher')
    expect(advisorEntry?.fiber).toBeDefined()
    await advisorEntry!.fiber!.dispose()
    expect(loaded.queueAdvisor).toBeUndefined()
    expect(loaded.sessionProjections.snapshot(session).values['advisor/run']).toBeUndefined()
  })
})
