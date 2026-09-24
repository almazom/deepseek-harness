import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, {
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import * as toolAskUser from '@deepseek-ai/dsh-tool-ask-user'

const testToolSignal = new AbortController().signal

interface QuestionAnswerer {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

function registerQuestionAnswerer(ctx: Context, answerer: QuestionAnswerer): () => void {
  return ctx.on('user-questions/request', request => answerer.ask(request))
}

interface OptionSchemaShape {
  properties: {
    questions: {
      items: {
        properties: {
          options: {
            items: {
              properties: Record<string, { type: string }>
            }
          }
        } & Record<string, unknown>
      }
    }
  }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(toolAskUser)
  return ctx
}

function stubAgent(id: string, delegationDepth = 0): Agent {
  const agentId = id as Agent['id']
  return {
    id: agentId,
    session: { id: agentId, header: { delegationDepth } },
  } as unknown as Agent
}

/**
 * The option the tool appends to every option-bearing question so a countdown
 * always has somewhere to hand the answer. Kept as one literal: the label is a
 * wire value the answer echoes back, so a change here is a protocol change.
 */
const COLLECTIVE_OPTION = {
  label: 'Collective decision (brainstorm)',
  description: 'Hand the decision to the brainstorm skill and fold the result into the plan.',
  autoDecide: true,
}

describe('ask_user_question tool', () => {
  it('registers a model-facing tool schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')

    expect(schema).toMatchObject({
      name: 'ask_user_question',
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array' },
        },
        required: ['questions'],
      },
    })
    const parameters = schema?.parameters as unknown as OptionSchemaShape
    expect(parameters.properties.questions.items.properties).toMatchObject({
      id: { type: 'string' },
      question: { type: 'string' },
      header: { type: 'string' },
      options: { type: 'array' },
      multi_select: { type: 'boolean' },
    })
    expect(parameters.properties.questions.items.properties.options.items.properties).toMatchObject({
      label: { type: 'string' },
      description: { type: 'string' },
      recommended: { type: 'boolean' },
      autoDecide: { type: 'boolean' },
    })
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('value')
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('preview')
  })

  it('asks the registered user-questions provider and projects structured answers to text', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: ['pnpm'] }] }
      },
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-1'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'pkg',
          question: 'Which package manager should I use?',
          options: [{ label: 'pnpm', description: 'Use pnpm workspaces.' }],
        }],
      },
    })

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"pkg","selected":["pnpm"]}],"timed_out":false}' }],
    })
    expect(seen).toMatchObject([{
      questions: [{
        id: 'pkg',
        question: 'Which package manager should I use?',
        options: [{ label: 'pnpm', description: 'Use pnpm workspaces.' }, COLLECTIVE_OPTION],
      }],
    }])
  })

  it('keeps the legacy "(Recommended)" label suffix working without a structured flag', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: ['pnpm (Recommended)'] }] }
      },
    })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-recommended'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'pkg',
          question: 'Which package manager should I use?',
          options: [
            { label: 'pnpm (Recommended)' },
            { label: 'npm' },
          ],
        }],
      },
    })

    expect(seen[0]?.questions[0]?.options).toEqual([
      { label: 'pnpm (Recommended)' },
      { label: 'npm' },
      COLLECTIVE_OPTION,
    ])
  })

  it('passes a structured recommended flag through to the user-questions request', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'color', selected: ['Blue'] }] }
      },
    })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-structured-recommended'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'color',
          question: 'Which colour should I use?',
          options: [{ label: 'Blue', recommended: true }, { label: 'Red' }],
        }],
      },
    })

    expect(seen[0]?.questions[0]?.options).toEqual([
      { label: 'Blue', recommended: true },
      { label: 'Red' },
      COLLECTIVE_OPTION,
    ])
  })

  it('appends the collective-decision option to every question that offers options', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'color', selected: [] }] }
      },
    })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-collective-injected'),
      name: 'ask_user_question',
      arguments: {
        questions: [
          { id: 'color', question: 'Which colour?', options: [{ label: 'Blue', recommended: true }, { label: 'Red' }] },
          { id: 'free', question: 'Anything else?' },
        ],
      },
    })

    // One injection on the option-bearing question, exactly one autoDecide
    // option, and a question that offered no options is left without a choice.
    expect(seen[0]?.questions[0]?.options).toEqual([
      { label: 'Blue', recommended: true },
      { label: 'Red' },
      COLLECTIVE_OPTION,
    ])
    expect(seen[0]?.questions[0]?.options?.filter(option => option.autoDecide === true)).toHaveLength(1)
    expect(seen[0]?.questions[1]?.options).toBeUndefined()
  })

  it('keeps a caller-supplied autoDecide option instead of appending a second one', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'color', selected: ['Delegate to ask-team'] }] }
      },
    })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-collective-own'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'color',
          question: 'Which colour?',
          options: [{ label: 'Blue' }, { label: 'Delegate to ask-team', autoDecide: true }],
        }],
      },
    })

    expect(seen[0]?.questions[0]?.options).toEqual([
      { label: 'Blue' },
      { label: 'Delegate to ask-team', autoDecide: true },
    ])
  })

  it('reports a countdown-expired answer as a timed-out tool result', async () => {
    const ctx = await setup()
    registerQuestionAnswerer(ctx, {
      async ask() {
        return { answers: [{ id: 'color', selected: ['Blue'], timedOut: true }] }
      },
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-timed-out'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'color',
          question: 'Which colour should I use?',
          options: [{ label: 'Blue', recommended: true }, { label: 'Red' }],
        }],
      },
    })

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"color","selected":["Blue"]}],"timed_out":true}' }],
    })
  })

  it('reports a human answer as not timed out', async () => {
    const ctx = await setup()
    registerQuestionAnswerer(ctx, {
      async ask() {
        return { answers: [{ id: 'color', selected: ['Red'], timedOut: false }] }
      },
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-human'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'color',
          question: 'Which colour should I use?',
          options: [{ label: 'Blue', recommended: true }, { label: 'Red' }],
        }],
      },
    })

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"color","selected":["Red"]}],"timed_out":false}' }],
    })
  })

  it('projects custom answers and multi-select choices', async () => {
    const ctx = await setup()
    registerQuestionAnswerer(ctx, {
      async ask() {
        return {
          answers: [
            { id: 'targets', selected: ['tests', 'docs'], custom: 'release notes' },
            { id: 'labels-only', selected: ['tests'] },
            { id: 'notes', selected: [], custom: 'ship today' },
          ],
        }
      },
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-multi'),
      name: 'ask_user_question',
      arguments: {
        questions: [
          {
            id: 'targets',
            question: 'What should I update?',
            options: [{ label: 'tests' }, { label: 'docs' }],
            multi_select: true,
          },
          {
            id: 'labels-only',
            question: 'Which labels should I keep?',
            options: [{ label: 'tests' }, { label: 'docs' }],
            multi_select: true,
          },
          { id: 'notes', question: 'Any note?' },
        ],
      },
    })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected ask_user_question success')
    expect(result.value).toEqual({
      answers: [
        { id: 'targets', selected: ['tests', 'docs'], custom: 'release notes' },
        { id: 'labels-only', selected: ['tests'] },
        { id: 'notes', selected: [], custom: 'ship today' },
      ],
      timed_out: false,
    })
    expect(result.content).toEqual([{
      type: 'text',
      text: '{"answers":[{"id":"targets","selected":["tests","docs"],"custom":"release notes"},{"id":"labels-only","selected":["tests"]},{"id":"notes","selected":[],"custom":"ship today"}],"timed_out":false}',
    }])
  })

  it('passes the tool abort signal to the user-questions request', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    const controller = new AbortController()

    await ctx.tools.execute({
      callId: ToolCallId('ask-2'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      signal: controller.signal,
    })

    expect(seen[0]?.signal).toBe(controller.signal)
  })

  it('passes optional header and a resumed runtime root through to the user-questions request', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    const agent = stubAgent('resumed-root', 1)
    ctx.agents.enter(agent, undefined)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-3'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', header: 'Confirm', question: 'Continue?' }] },
      agent,
    })

    expect(result.content).toEqual([{ type: 'text', text: '{"answers":[{"id":"continue","selected":["ok"]}],"timed_out":false}' }])
    expect(seen[0]).toMatchObject({ questions: [{ id: 'continue', header: 'Confirm', question: 'Continue?' }], agent })
  })

  it('returns structured user-questions errors through tool execution', async () => {
    const ctx = await setup()

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-no-provider'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'NO_PROVIDER' } },
    })
  })

  it('rejects a live runtime-owned agent with a structured DELEGATED_CALLER error', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    const root = stubAgent('root', 0)
    const child = stubAgent('child', 0)
    ctx.agents.enter(root, undefined)
    ctx.agents.enter(child, root)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-delegated'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      agent: child,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'DELEGATED_CALLER' } },
      content: [{
        type: 'text',
        text: "Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result",
      }],
    })
    expect(seen).toHaveLength(0)
  })

  it('returns a structured error for empty question batches', async () => {
    const ctx = await setup()

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-empty'),
      name: 'ask_user_question',
      arguments: { questions: [] },
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'EMPTY_QUESTIONS' } },
    })
  })

  it('unregisters the tool when its plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)
    const fiber = await ctx.plugin(toolAskUser)
    expect(ctx.tools.get('ask_user_question')).toBeDefined()

    await fiber.dispose()

    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})
