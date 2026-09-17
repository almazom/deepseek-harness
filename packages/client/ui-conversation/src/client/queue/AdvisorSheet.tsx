import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
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
  /** The pipeline phases in execution order; the sheet reveals them over time. */
  steps: readonly AdvisorStep[]
  /** The pipeline's confidence-tagged verdict. */
  outcome: AdvisorOutcome
  /** The configured confidence gate the outcome is compared against. */
  minConfidence: number
  t: Translator
  onSendNow: () => void
  onClose: () => void
}

/** Locale keys of the pipeline phase labels, keyed by phase id. */
const STEP_LABELS: Record<AdvisorStepId, ConversationKey> = {
  'session-status': 'advisor.step.session-status',
  'input-analysis': 'advisor.step.input-analysis',
  'risk-assessment': 'advisor.step.risk-assessment',
  verdict: 'advisor.step.verdict',
}

/** Locale keys of the phase statuses. */
const STATUS_LABELS: Record<AdvisorStepStatus, ConversationKey> = {
  pending: 'advisor.stepStatus.pending',
  running: 'advisor.stepStatus.running',
  done: 'advisor.stepStatus.done',
  failed: 'advisor.stepStatus.failed',
}

/** Presentation cadence of the step reveal; pure pacing, no behavioral meaning. */
const STEP_REVEAL_MS = 150

/**
 * Reveal the pipeline rows one by one: the count of rows that have entered
 * their final state. Component-internal pacing only — it subscribes to
 * nothing external and stops once every row is shown.
 * @param count - number of pipeline rows to reveal.
 * @returns how many rows have fully appeared (from 1 to `count`).
 */
function useStepReveal(count: number): number {
  const [revealed, setRevealed] = useState(1)
  useEffect(() => {
    if (revealed >= count) return
    const timer = window.setTimeout(() => { setRevealed(current => current + 1) }, STEP_REVEAL_MS)
    return () => { window.clearTimeout(timer) }
  }, [count, revealed])
  return revealed
}

/** Visible status of row `index` while `revealed` of `count` rows have appeared. */
function stepStatus(index: number, revealed: number, count: number): AdvisorStepStatus {
  if (index < revealed - 1) return 'done'
  if (index === revealed - 1) return revealed < count ? 'running' : 'done'
  return 'pending'
}

/**
 * Bottom-sheet advisor over the conversation: a read-only session snapshot,
 * the live tier-1 pipeline rows, the confidence-gated verdict with its
 * reason, and the override actions. The sheet never talks to services;
 * QueueDock owns the facts and the delivery.
 */
export function AdvisorSheet({
  open, running, queuedCount, rowPreview, lastHuman, busy, steps, outcome, minConfidence, t, onSendNow, onClose,
}: AdvisorSheetProps) {
  const revealed = useStepReveal(steps.length)
  const gate = gateOutcome(outcome, minConfidence)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('advisor.title')}
      closeLabel={t('advisor.close')}
      className={clsx(css.sheet)}
      contentClassName={clsx(css.scroll)}
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('advisor.keepQueued')}</Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={onSendNow}>{t('advisor.sendNow')}</Button>
        </>
      )}
    >
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
        <ol className={css.pipeline} aria-label={t('advisor.pipeline.label')}>
          {steps.map((step, index) => {
            const status = stepStatus(index, revealed, steps.length)
            return (
              <li key={step.id} className={css.pipelineStep}>
                <span className={css.pipelineStatus}>{t(STATUS_LABELS[status])}</span>
                <span className={css.pipelineBody}>
                  {t(STEP_LABELS[step.id])}
                  {step.detail !== undefined && (
                    <span className={css.pipelineDetail}>
                      {t(step.detail.key, step.detail.params)}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
        <div className={css.gate}>
          <span className={css.gateConfidence}>{t('advisor.gate.label')}</span>
          <span className={css.gateOutcome}>
            {t('advisor.gate.confidence', { p: Math.round(outcome.confidence * 100) })}
            {' — '}
            {gate === 'allowed' ? t('advisor.gate.allowed') : t('advisor.gate.held')}
          </span>
        </div>
        <div className={css.verdict}>
          <span className={css.verdictKind}>{t('advisor.verdict.label')}</span>
          <span className={css.verdictReason}>{t(outcome.reasonKey)}</span>
        </div>
      </div>
    </Modal>
  )
}
