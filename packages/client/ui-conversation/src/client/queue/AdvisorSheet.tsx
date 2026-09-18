import { clsx } from 'clsx'
import { useState } from 'react'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14, IconSendOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AdvisorRunProjection, AdvisorStepId as AdvisorPhaseId } from '@deepseek-ai/dsh-session-advisor-llm'
import {
  gateOutcome, type AdvisorOutcome, type AdvisorStep, type AdvisorStepId, type AdvisorStepStatus,
} from './advisor.ts'
import type { ConversationKey } from '../locales.ts'
import css from './AdvisorSheet.module.css'

type Translator = PropsLocale<'conversation'>['t']

/** Props of the Smart-steer advisor sheet; QueueDock owns every fact and callback. */
export interface AdvisorSheetProps {
  open: boolean
  /** Whether the addressed agent is mid-turn; drives the state row only. */
  running: boolean
  queuedCount: number
  /** The advised row's projected preview text. */
  rowPreview: string
  /** Newest human transcript preview; undefined before any human input. */
  lastHuman: string | undefined
  /** Whether another queue mutation is in flight; disables the override action. */
  busy: boolean
  /** The pipeline phases in execution order; the tier-1 pre-verdict renders instantly. */
  steps: readonly AdvisorStep[]
  /** The pipeline's confidence-tagged verdict. */
  outcome: AdvisorOutcome
  /** The configured confidence gate the outcome is compared against. */
  minConfidence: number
  /**
   * Live advisory side run for the advised row, projected from the host;
   * present only while this row has a run. When present it replaces the
   * tier-1 reasoning rows and the verdict with the real streamed phases.
   */
  live: AdvisorRunProjection | undefined
  /**
   * The in-sheet follow-up composer: the sheet is a side-runtime over the same
   * session, so each submitted follow-up starts a fresh advisory run without
   * touching the main conversation. Disabled while a run streams in.
   */
  followUp?: { readonly disabled: boolean; readonly onSubmit: (question: string) => void }
  /** Collapses the sheet into the dock's peek pill; the side run keeps streaming. */
  onCollapse?: () => void
  t: Translator
  onSendNow: () => void
  onClose: () => void
}

/** Locale keys of the tier-1 pipeline phase labels, keyed by phase id. */
const STEP_LABELS: Record<AdvisorStepId, ConversationKey> = {
  'session-status': 'advisor.step.session-status',
  'input-analysis': 'advisor.step.input-analysis',
  'risk-assessment': 'advisor.step.risk-assessment',
  verdict: 'advisor.step.verdict',
}

/** Locale keys of the live run phase labels, keyed by the advisory run's phase id. */
const LIVE_STEP_LABELS: Record<AdvisorPhaseId, ConversationKey> = {
  tail: 'advisor.liveStep.tail',
  compare: 'advisor.liveStep.compare',
  risk: 'advisor.liveStep.risk',
  verdict: 'advisor.liveStep.verdict',
}

/** Locale keys of the phase statuses. */
const STATUS_LABELS: Record<AdvisorStepStatus, ConversationKey> = {
  pending: 'advisor.stepStatus.pending',
  running: 'advisor.stepStatus.running',
  done: 'advisor.stepStatus.done',
  failed: 'advisor.stepStatus.failed',
}

/**
 * Bottom-sheet advisor over the conversation: the confidence-gated verdict
 * first (the decision the sheet exists to deliver), then the read-only
 * session snapshot, then the reasoning rows — the live advisory side run
 * when one is projected for this row, the instant tier-1 pre-verdict
 * otherwise. The sheet never talks to services; QueueDock owns the facts
 * and the delivery.
 */
export function AdvisorSheet({
  open, running, queuedCount, rowPreview, lastHuman, busy, steps, outcome, minConfidence, live, followUp, onCollapse, t, onSendNow, onClose,
}: AdvisorSheetProps) {
  const gate = gateOutcome(outcome, minConfidence)
  const liveAllowed = live?.verdict !== undefined && live.verdict.confidence >= minConfidence
  const liveSettled = live !== undefined && live.status !== 'running'
  const [full, setFull] = useState(false)
  const [draft, setDraft] = useState('')
  const submitFollowUp = (): void => {
    const question = draft.trim()
    if (question === '' || followUp === undefined || followUp.disabled) return
    followUp.onSubmit(question)
    setDraft('')
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('advisor.title')}
      closeLabel={t('advisor.close')}
      className={clsx(css.sheet, full && css.sheetFull)}
      contentClassName={clsx(css.frame)}
      footer={(
        <>
          {onCollapse !== undefined && (
            <button
              type="button"
              className={css.iconBtn}
              aria-label={t('advisor.collapse')}
              onClick={onCollapse}
            >
              <IconChevronDownOutline14 />
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>{t('advisor.keepQueued')}</Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={onSendNow}>{t('advisor.sendNow')}</Button>
          {!full && (
            <button
              type="button"
              className={css.iconBtn}
              aria-label={t('advisor.expand')}
              onClick={() => { setFull(true) }}
            >
              <IconChevronUpOutline14 />
            </button>
          )}
        </>
      )}
    >
      <div className={clsx(css.scroll)}>
        <div className={css.gate}>
          <span className={css.gateConfidence}>{t('advisor.gate.label')}</span>
          {live?.verdict === undefined && (live === undefined || liveSettled) && (
            <span className={css.gateOutcome}>
              {t('advisor.gate.confidence', { p: Math.round(outcome.confidence * 100) })}
              {' — '}
              {gate === 'allowed' ? t('advisor.gate.allowed') : t('advisor.gate.held')}
            </span>
          )}
          {live?.verdict !== undefined && (
            <span className={css.gateOutcome}>
              {t('advisor.gate.confidence', { p: Math.round(live.verdict.confidence * 100) })}
              {' — '}
              {liveAllowed ? t('advisor.gate.allowed') : t('advisor.gate.held')}
            </span>
          )}
          {live !== undefined && live.verdict === undefined && !liveSettled && (
            <span className={css.gateOutcome}>{t('advisor.live.pendingGate')}</span>
          )}
        </div>
        <div className={css.verdict}>
          <span className={css.verdictKind}>{t('advisor.verdict.label')}</span>
          {live?.verdict === undefined && (live === undefined || liveSettled) && (
            <span className={css.verdictReason}>{t(outcome.reasonKey)}</span>
          )}
          {live?.verdict !== undefined && (
            <span className={css.verdictReason}>{live.verdict.reason}</span>
          )}
          {live !== undefined && live.verdict === undefined && !liveSettled && (
            <span className={css.verdictReason}>{t('advisor.live.pendingVerdict')}</span>
          )}
        </div>
        <div className={css.rows}>
          <div className={css.row}>
            <span className={css.label}>{t('advisor.field.state')}</span>
            <span className={css.value}>{running ? t('advisor.state.running') : t('advisor.state.idle')}</span>
          </div>
          <div className={css.row}>
            <span className={css.label}>{t('advisor.field.queued')}</span>
            <span className={css.value}>{t('advisor.queuedCount', { n: queuedCount })}</span>
          </div>
          <div className={css.row}>
            <span className={css.label}>{t('advisor.field.message')}</span>
            <span className={css.value}>{rowPreview}</span>
          </div>
          <div className={css.row}>
            <span className={css.label}>{t('advisor.field.lastHuman')}</span>
            <span className={css.value}>{lastHuman ?? t('advisor.lastHuman.none')}</span>
          </div>
        </div>
        <ol className={css.pipeline} aria-label={t('advisor.pipeline.label')}>
          {live === undefined && steps.map(step => (
            <li key={step.id} className={css.pipelineStep}>
              <span className={css.pipelineStatus}>{t(STATUS_LABELS.done)}</span>
              <span className={css.pipelineBody}>
                {t(STEP_LABELS[step.id])}
                {step.detail !== undefined && (
                  <span className={css.pipelineDetail}>
                    {t(step.detail.key, step.detail.params)}
                  </span>
                )}
              </span>
            </li>
          ))}
          {live !== undefined && live.steps.map(step => (
            <li key={step.step} className={css.pipelineStep}>
              <span className={css.pipelineStatus}>{t(STATUS_LABELS.done)}</span>
              <span className={css.pipelineBody}>
                {t(LIVE_STEP_LABELS[step.step])}
                <span className={css.pipelineDetail}>{step.finding}</span>
              </span>
            </li>
          ))}
          {live !== undefined && live.status === 'running' && (
            <li className={css.pipelineStep}>
              <span className={css.pipelineStatus}>{t(STATUS_LABELS.running)}</span>
              <span className={css.pipelineBody}>{t('advisor.live.working')}</span>
            </li>
          )}
          {live !== undefined && live.status === 'failed' && (
            <li className={css.pipelineStep}>
              <span className={css.pipelineStatus}>{t(STATUS_LABELS.failed)}</span>
              <span className={css.pipelineBody}>{t('advisor.live.failed')}</span>
            </li>
          )}
        </ol>
        {followUp !== undefined && (
          <form
            className={css.composer}
            onSubmit={(event) => {
              event.preventDefault()
              submitFollowUp()
            }}
          >
            <input
              className={css.composerInput}
              value={draft}
              placeholder={t('advisor.followUp.placeholder')}
              aria-label={t('advisor.followUp.label')}
              disabled={followUp.disabled}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <button
              type="submit"
              className={css.composerSend}
              aria-label={t('advisor.followUp.send')}
              disabled={followUp.disabled || draft.trim() === ''}
            >
              <IconSendOutline14 />
            </button>
          </form>
        )}
      </div>
    </Modal>
  )
}
