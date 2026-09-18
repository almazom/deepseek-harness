/**
 * Host dispatcher for the model-backed Smart-steer queue advisor: builds the
 * read-only conversation snapshot, logs the exact request, streams the
 * advisory output through the section watcher, and lands each phase in the
 * session log while the model is still emitting. The run never touches the
 * main agent loop and never mutates the queue.
 * @module @deepseek-ai/dsh-session-advisor-llm/dispatcher
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { z as sectionZ } from 'zod'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { AdvisorSectionWatcher, ADVISOR_RUN_TIMEOUT_CODE, AdvisorLlmConfigFields, buildAdvisorMessages, buildAdvisorSystemPrompt, resolveAdvisorLlmConfig } from './index.ts'
import { advisorRunProjectionDefinition } from './projection.ts'
import type { AdvisorLlmConfig, AdvisorRunId, ResolvedAdvisorLlmConfig } from './types.ts'

/** Exact conversation snapshot one advisory run decides over. */
export interface QueueAdvisorRequest {
  /** The live Session: append target for the run's events. */
  readonly session: Session
  /** Queue item the run decides about, exactly as the caller identified it. */
  readonly queuedItemId: string
  /** The queued message text, verbatim. */
  readonly queuedMessage: string
  /** Operator-composed follow-up; when present it is the question the run answers. */
  readonly question?: string
  /** Caller-owned cancellation; the run also enforces its own deadline. */
  readonly signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The mounted advisory dispatcher; absent when the deployment opts out. */
    queueAdvisor?: QueueAdvisorService
  }
}

/**
 * The advisory side-run entry the session controller's `advise` queue action
 * calls. The service owns the deployment policy and the auxiliary LLM route;
 * run failures land as `advisor/failed` and never reject the caller.
 */
export default class QueueAdvisorService extends Service {
  static inject = ['llm', 'sessionProjections', 'sessionQuery']
  static Config: z<AdvisorLlmConfig> = z.object(AdvisorLlmConfigFields)

  private readonly route: { readonly provider: string; readonly model: string }

  private readonly resolved: ResolvedAdvisorLlmConfig
  private readonly lifetime = new AbortController()

  /**
   * Mount the dispatcher and register the `advisor/run` projection unit; both
   * disappear when this service's fiber is disposed.
   * @param ctx - Cordis context owning the service and its consumers.
   * @param config - raw deployment policy, validated at construction.
   */
  constructor(ctx: Context, config: AdvisorLlmConfig) {
    super(ctx, 'queueAdvisor')
    const candidate = resolveAdvisorLlmConfig(config)
    if (candidate.provider === undefined || candidate.model === undefined) {
      throw new Error('session-advisor-llm: the dispatcher requires an explicit provider/model pair')
    }
    this.resolved = candidate
    this.route = { provider: candidate.provider, model: candidate.model }
    ctx.sessionProjections.register(advisorRunProjectionDefinition)
    ctx.effect(() => () => {
      this.lifetime.abort(new Error('queue-advisor service disposed'))
      // v8 ignore next 1 -- a stale disposer never owns the slot; service classes mount once per context.
      if (ctx.queueAdvisor === this) delete (ctx as { queueAdvisor?: QueueAdvisorService }).queueAdvisor
    }, 'queueAdvisor.lifetimeClose')
  }

  /**
   * Run one advisory side question to settlement. Emits `advisor/run-requested`
   * before dispatch, `advisor/step` as each contract section closes, and
   * `advisor/verdict` or `advisor/failed` at settlement. A failure before the
   * request event (snapshot read, framing) lands as `advisor/failed` without
   * a run id, leaving a log trace that the projection fold ignores.
   * @param request - live session, queued item identity, and caller signal.
   * @returns the run id — the branded seq of the request event — or null when
   * the run failed before that event landed.
   */
  async run(request: QueueAdvisorRequest): Promise<AdvisorRunId | null> {
    try {
      const observed = await this.ctx.sessionQuery.readSession(request.session.id)
      const tail = conversationTail(observed.events)
      const window = tail.entries.slice(-this.resolved.tailEntries)
      const messages = buildAdvisorMessages({
        queuedMessage: request.queuedMessage,
        ...(request.question === undefined ? {} : { question: request.question }),
        tail: window,
        recentRequests: tail.recentRequests.slice(-this.resolved.recentRequests),
        maxInputBytes: this.resolved.maxInputBytes,
      })
      const requested = request.session.append('advisor/run-requested', {
        queuedItemId: MessageId(request.queuedItemId),
        messageSeqs: window.filter(entry => entry.role === 'user').map(entry => SessionSeq(entry.seq)),
        system: buildAdvisorSystemPrompt(),
        messages: [...messages],
        maxTokens: this.resolved.maxOutputTokens,
      })
      const runId = brandString<AdvisorRunId>(String(requested.seq))
      await this.dispatch(request.session, runId, messages, request.signal)
      return runId
    } catch (error) {
      /* v8 ignore next 1 -- framing and read failures are Error instances; the string
         arm only guards exotic throws so the run still settles in the log. */
      request.session.append('advisor/failed', {
        runId: null,
        reason: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /** Stream the advisory model call and land each closed section in the log. */
  private async dispatch(
    session: Session,
    runId: AdvisorRunId,
    messages: readonly Message[],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const watcher = new AdvisorSectionWatcher()
    try {
      using callDeadline = deadline(signal ?? this.lifetime.signal, this.resolved.timeoutMs, ADVISOR_RUN_TIMEOUT_CODE)
      const options: GenerateOptions = deepFreeze({
        provider: this.route.provider,
        model: this.route.model,
        messages: [...messages],
        system: buildAdvisorSystemPrompt(),
        maxTokens: this.resolved.maxOutputTokens,
        signal: callDeadline.signal,
      })
      for await (const chunk of this.ctx.llm.stream(options)) {
        if (chunk.type === 'finish') {
          const failure = chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted'
            ? chunk.reason.failure
            : undefined
          if (failure !== undefined) {
            session.append('advisor/failed', { runId, reason: failure.message })
            return
          }
        }
        if (chunk.type !== 'text-delta') continue
        for (const section of watcher.push(chunk.text)) this.land(session, runId, section.key, section.raw)
      }
      const health = watcher.finish()
      if (!health.closed || !health.keys.includes('verdict')) {
        session.append('advisor/failed', { runId, reason: 'advisory output closed before the verdict section' })
      }
    } catch (error) {
      /* v8 ignore next 1 -- route and deadline failures are Error instances; the string
         arm only guards exotic throws so the run still settles in the log. */
      session.append('advisor/failed', { runId, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Land one closed section: contract phases become steps, verdict settles the run. */
  private land(session: Session, runId: AdvisorRunId, key: string, raw: string): void {
    if (key === 'verdict') {
      const parsed = advisorVerdictSection.safeParse(safeJson(raw))
      if (!parsed.success) {
        session.append('advisor/failed', { runId, reason: 'verdict section did not match the advisory contract' })
        return
      }
      session.append('advisor/verdict', {
        runId,
        kind: parsed.data.kind,
        confidence: parsed.data.confidence,
        reason: parsed.data.reason,
      })
      return
    }
    if (key !== 'tail' && key !== 'compare' && key !== 'risk') return
    const parsed = advisorFindingSection.safeParse(safeJson(raw))
    if (!parsed.success) return
    session.append('advisor/step', { runId, step: key, finding: parsed.data.finding })
  }
}

/** One conversation-tail entry with its exact log seq. */
interface TailEntry {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly seq: SessionSeq
}

const advisorFindingSection = sectionZ.object({ finding: sectionZ.string() })
const advisorVerdictSection = sectionZ.object({
  kind: sectionZ.enum(['send-now', 'hold']),
  confidence: sectionZ.number().min(0).max(1),
  reason: sectionZ.string(),
})

/**
 * Read the human-and-assistant conversation tail and the distinct human
 * requests from one observed log.
 * @param events - the observed log, oldest first.
 * @returns oldest-first tail entries and the deduplicated request texts.
 */
function conversationTail(events: readonly SessionEvent[]): { entries: TailEntry[]; recentRequests: string[] } {
  const entries: TailEntry[] = []
  const recentRequests: string[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      const text = blocksText(event.data.content)
      if (text === '') continue
      entries.push({ role: 'user', text, seq: event.seq })
      if (recentRequests[recentRequests.length - 1] !== text) recentRequests.push(text)
    } else if (event.type === 'assistant/message') {
      const text = blocksText(event.data.message.content)
      if (text === '') continue
      entries.push({ role: 'assistant', text, seq: event.seq })
    }
  }
  return { entries, recentRequests }
}

/** Concatenated text of a message's text blocks. */
function blocksText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Parse a closed section's raw JSON, or undefined when it is not valid JSON. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // v8 ignore next 1 -- the watcher only closes balanced JSON, so parse cannot reject here.
    return undefined
  }
}
