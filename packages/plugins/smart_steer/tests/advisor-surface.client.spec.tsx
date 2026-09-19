// @vitest-environment jsdom
/** AdvisorSurface contract: the peek pill, the gated sheet, and the plugin's slot registration. */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdvisorSurface } from '../src/client/AdvisorSurface.tsx'
import type { AdvisorSurfaceProps } from '../src/client/AdvisorSurface.tsx'
import { apply } from '../src/client/index.ts'
import type { AdvisorOwnerProps } from '../src/client/owner.ts'
import { NS, zh } from '../src/client/locales.ts'
import type { AdvisorRunProjection } from '../src/types.ts'
import { en } from '../src/client/locales.ts'

const MESSAGES: Record<string, string> = {
  'advisor.title': 'Smart steer',
  'advisor.close': 'Close',
  'advisor.expand': 'Expand sheet',
  'advisor.collapse': 'Collapse to the peek pill',
  'advisor.peek.answers': '{n} answers',
  'advisor.live.working': 'Live run reading the session snapshot…',
  'advisor.verdict.label': 'Verdict',
  'advisor.verdict.status': 'The snapshot already answers this.',
  'advisor.verdict.defer': 'Held for the next step boundary.',
  'advisor.gate.label': 'Confidence gate',
  'advisor.gate.confidence': 'Confidence {p}%',
  'advisor.gate.allowed': 'Delivery allowed',
  'advisor.gate.held': 'Keep queued',
  'advisor.live.pendingGate': 'Waiting for the advisory verdict…',
  'advisor.live.pendingVerdict': 'Advisory run in progress: the verdict arrives with the stream',
  'advisor.live.failed': 'Advisory run did not finish: the instant pre-verdict stands',
  'advisor.state.running': 'Running',
  'advisor.state.idle': 'Idle',
  'advisor.queuedCount': '{n} queued',
  'advisor.field.state': 'Session state',
  'advisor.field.queued': 'Queue depth',
  'advisor.field.about': 'About',
  'advisor.field.message': 'Advised message',
  'advisor.field.lastHuman': 'Last human message',
  'advisor.lastHuman.none': 'No human input yet',
  'advisor.pipeline.label': 'Pipeline phases',
  'advisor.step.session-status': 'Session status',
  'advisor.step.input-analysis': 'Input analysis',
  'advisor.step.risk-assessment': 'Risk assessment',
  'advisor.step.verdict': 'Verdict phase',
  'advisor.stepStatus.done': 'Done',
  'advisor.stepStatus.running': 'Running',
  'advisor.stepStatus.failed': 'Failed',
  'advisor.liveStep.tail': 'Message tail read',
  'advisor.detail.sessionRunning': 'Agent is running with {n} message(s) queued',
  'advisor.detail.sessionIdle': 'Agent is idle with {n} message(s) queued',
  'advisor.detail.probeMatched': 'Short interrogative probe matched',
  'advisor.detail.instructionDetected': 'Reads as a real instruction',
  'advisor.detail.interruptRisk': 'Delivery now would interrupt the running turn',
  'advisor.detail.boundaryDelivery': 'Delivers at the next step boundary',
  'advisor.detail.gateAllowed': 'Confidence {p}% meets the gate',
  'advisor.detail.gateHeld': 'Confidence {p}% is below the gate',
  'advisor.followUp.label': 'Follow-up question',
  'advisor.followUp.placeholder': 'Ask a follow-up about this queued message…',
  'advisor.followUp.send': 'Send follow-up',
  'advisor.keepQueued': 'Keep queued',
  'advisor.sendNow': 'Send now',
}

const t = (key: string, params?: Record<string, string | number>): string =>
  (MESSAGES[key] ?? key).replaceAll(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

const liveRun = (overrides: Partial<AdvisorRunProjection> = {}): AdvisorRunProjection => ({
  runId: 'run-1',
  queuedItemId: 'row-1',
  status: 'running',
  steps: [{ step: 'tail', finding: 'tail finding' }],
  verdict: undefined,
  ...overrides,
} as AdvisorRunProjection)

const onSubmit = vi.fn()
const onSendNow = vi.fn()
const onCollapse = vi.fn()
const onExpand = vi.fn()
const onClose = vi.fn()

function surfaceProps(overrides: Partial<AdvisorOwnerProps> = {}, live?: AdvisorRunProjection): AdvisorSurfaceProps {
  return {
    useProjection: vi.fn(() => live),
    open: true,
    peek: false,
    peekAnswers: 1,
    running: false,
    queuedCount: 2,
    busy: false,
    rowPreview: 'what is the status?',
    rowless: false,
    anchorId: 'row-1',
    lastHuman: 'earlier message',
    minConfidence: 0.95,
    followUp: { disabled: false, onSubmit },
    onSendNow,
    onCollapse,
    onExpand,
    onClose,
    t,
    ...overrides,
  } as unknown as AdvisorSurfaceProps
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('apply (smart-steer client half)', () => {
  it('registers the advisor dictionaries and injects the surface into the dock slot', () => {
    const ctx = new Context()
    const registerLocale = vi.fn(() => () => {})
    const registerSlot = vi.fn((..._args: unknown[]) => () => {})
    const injectSlot = vi.fn((_name: string, mount: () => () => void) => { mount() })
    ctx.provide('slots', { inject: injectSlot, register: registerSlot } as never)
    ctx.provide('locale', { register: registerLocale } as never)

    apply(ctx)

    expect(registerLocale).toHaveBeenCalledWith(NS, { zh, en })
    expect(injectSlot).toHaveBeenCalledWith('conversation.input.dock.advisor', expect.any(Function))
    expect(registerSlot).toHaveBeenCalledTimes(1)
    const [options, component] = registerSlot.mock.calls[0] as [{ name: string; priority: number; locale: string }, unknown]
    expect(options).toMatchObject({
      name: 'conversation.input.dock.advisor',
      priority: 10,
      locale: NS,
    })
    expect(component).toBe(AdvisorSurface)
  })
})

describe('AdvisorSurface', () => {
  it('renders nothing while no anchor is advised', () => {
    render(<AdvisorSurface {...surfaceProps({ open: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Verdict')).toBeNull()
  })

  it('renders the peek pill portal with the live suffix and pill actions', () => {
    render(<AdvisorSurface {...surfaceProps({ peek: true }, liveRun())} />)
    expect(screen.getByText('1 answers · Live run reading the session snapshot…')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Expand sheet' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the peek pill without the live suffix while no run streams', () => {
    render(<AdvisorSurface {...surfaceProps({ peek: true })} />)
    expect(screen.getByText('1 answers')).toBeDefined()
  })

  it('renders the instant pre-verdict with the gate allowed for a status probe', () => {
    render(<AdvisorSurface {...surfaceProps()} />)
    expect(screen.getByText('Confidence 97% — Delivery allowed')).toBeDefined()
    expect(screen.getByText('The snapshot already answers this.')).toBeDefined()
    expect(screen.getByText('Session status')).toBeDefined()
    expect(screen.getByText('Agent is idle with 2 message(s) queued')).toBeDefined()
    expect(screen.getByText('Idle')).toBeDefined()
    expect(screen.getByText('2 queued')).toBeDefined()
    expect(screen.getByText('what is the status?')).toBeDefined()
    expect(screen.getByText('earlier message')).toBeDefined()
    expect(screen.getByText('Short interrogative probe matched')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse to the peek pill' }))
    expect(onCollapse).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Keep queued' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect(onSendNow).toHaveBeenCalledTimes(1)
  })

  it('grows to the full-height frame and hides the expand control while full', () => {
    const { baseElement } = render(<AdvisorSurface {...surfaceProps()} />)
    expect(baseElement.querySelector('[aria-label="Expand sheet"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand sheet' }))
    expect(baseElement.querySelector('[aria-label="Expand sheet"]')).toBeNull()
  })

  it('disables the override action while another queue mutation is in flight', () => {
    render(<AdvisorSurface {...surfaceProps({ busy: true })} />)
    const sendNow = screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement
    expect(sendNow.disabled).toBe(true)
  })

  it('holds a real instruction below the confidence gate', () => {
    render(<AdvisorSurface {...surfaceProps({ rowPreview: 'ship it now' })} />)
    expect(screen.getByText('Confidence 70% — Keep queued')).toBeDefined()
    expect(screen.getByText('Held for the next step boundary.')).toBeDefined()
    expect(screen.getByText('Reads as a real instruction')).toBeDefined()
    expect(screen.getByText('Delivers at the next step boundary')).toBeDefined()
  })

  it('renders the fallback run without the gate block, queued row, or row actions', () => {
    render(<AdvisorSurface {...surfaceProps({
      rowless: true, anchorId: undefined, followUp: undefined, onSendNow: undefined, lastHuman: undefined,
    }, liveRun({ queuedItemId: 'row-9' as never }))} />)
    expect(screen.queryByText('Confidence gate')).toBeNull()
    expect(screen.queryByText('Queue depth')).toBeNull()
    expect(screen.getByText('About')).toBeDefined()
    expect(screen.getByText('No human input yet')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('renders the streaming live run with pending placeholders and phase rows', () => {
    render(<AdvisorSurface {...surfaceProps({ running: true }, liveRun())} />)
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.getByText('Waiting for the advisory verdict…')).toBeDefined()
    expect(screen.getByText('Advisory run in progress: the verdict arrives with the stream')).toBeDefined()
    expect(screen.getByText('Message tail read')).toBeDefined()
    expect(screen.getByText('tail finding')).toBeDefined()
    expect(screen.queryByText('Session status')).toBeNull()
    expect(screen.getByText('Live run reading the session snapshot…')).toBeDefined()
  })

  it('renders a settled live verdict above the gate', () => {
    render(<AdvisorSurface {...surfaceProps(undefined, liveRun({
      status: 'done',
      steps: [
        { step: 'tail', finding: 'tail finding' },
        { step: 'compare', finding: 'compare finding' },
        { step: 'risk', finding: 'risk finding' },
        { step: 'verdict', finding: 'verdict finding' },
      ],
      verdict: { kind: 'send-now', confidence: 0.99, reason: 'Send now.' },
    }))} />)
    expect(screen.getByText('Confidence 99% — Delivery allowed')).toBeDefined()
    expect(screen.getByText('Send now.')).toBeDefined()
    expect(screen.getByText('compare finding')).toBeDefined()
  })

  it('holds the sheet when the live verdict lands below the gate', () => {
    render(<AdvisorSurface {...surfaceProps(undefined, liveRun({
      status: 'done',
      steps: [{ step: 'verdict', finding: 'verdict finding' }],
      verdict: { kind: 'hold', confidence: 0.6, reason: 'Hold it.' },
    }))} />)
    expect(screen.getByText('Confidence 60% — Keep queued')).toBeDefined()
    expect(screen.getByText('Hold it.')).toBeDefined()
  })

  it('falls back to the instant pre-verdict when a live run fails', () => {
    render(<AdvisorSurface {...surfaceProps(undefined, liveRun({ status: 'failed' }))} />)
    expect(screen.getByText('Confidence 97% — Delivery allowed')).toBeDefined()
    expect(screen.getByText('Advisory run did not finish: the instant pre-verdict stands')).toBeDefined()
    expect(screen.getByText('Failed')).toBeDefined()
  })

  it('submits the trimmed follow-up question once and clears the draft', () => {
    const { baseElement } = render(<AdvisorSurface {...surfaceProps()} />)
    const input = screen.getByLabelText('Follow-up question') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  why now?  ' } })
    fireEvent.submit(baseElement.querySelector('form')!)
    expect(onSubmit).toHaveBeenCalledWith('why now?')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('')
  })

  it('ignores blank drafts and disabled composers', () => {
    const held = render(<AdvisorSurface {...surfaceProps({
      followUp: { disabled: true, onSubmit },
    })} />)
    const send = screen.getByRole('button', { name: 'Send follow-up' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.submit(held.baseElement.querySelector('form')!)
    expect(onSubmit).not.toHaveBeenCalled()

    cleanup()
    const open = render(<AdvisorSurface {...surfaceProps()} />)
    fireEvent.submit(open.baseElement.querySelector('form')!)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
