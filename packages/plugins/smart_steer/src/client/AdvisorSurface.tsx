/** Smart-steer advisor surface: the peek pill plus the confidence-gated sheet. */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16, IconSendOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AdvisorStepId } from '../types.ts'
// Loads this package's SlotMap entry for the dock slot.
import type {} from './owner.ts'
import {
  gateOutcome, runAdvisorPipeline, type AdvisorPipelineStepId, type AdvisorStepStatus,
} from './advisor.ts'
import css from './AdvisorSurface.module.css'

/** Full props of the advisor surface: runtime seat + queue-facts owner share + the plugin's locale seat. */
export type AdvisorSurfaceProps =
  & PropsRuntime<'conversation.input.dock.advisor'>
  & PropsLocale<'smart-steer'>

/** Locale keys of the tier-1 pipeline phase labels, keyed by phase id. */
const STEP_LABELS: Record<AdvisorPipelineStepId, 'advisor.step.session-status' | 'advisor.step.input-analysis' | 'advisor.step.risk-assessment' | 'advisor.step.verdict'> = {
  'session-status': 'advisor.step.session-status',
  'input-analysis': 'advisor.step.input-analysis',
  'risk-assessment': 'advisor.step.risk-assessment',
  verdict: 'advisor.step.verdict',
}

/** Locale keys of the live run phase labels, keyed by the advisory run's phase id. */
const LIVE_STEP_LABELS: Record<AdvisorStepId, 'advisor.liveStep.tail' | 'advisor.liveStep.compare' | 'advisor.liveStep.risk' | 'advisor.liveStep.verdict'> = {
  tail: 'advisor.liveStep.tail',
  compare: 'advisor.liveStep.compare',
  risk: 'advisor.liveStep.risk',
  verdict: 'advisor.liveStep.verdict',
}

/** Locale keys of the phase statuses. */
const STATUS_LABELS: Record<AdvisorStepStatus, 'advisor.stepStatus.pending' | 'advisor.stepStatus.running' | 'advisor.stepStatus.done' | 'advisor.stepStatus.failed'> = {
  pending: 'advisor.stepStatus.pending',
  running: 'advisor.stepStatus.running',
  done: 'advisor.stepStatus.done',
  failed: 'advisor.stepStatus.failed',
}

/**
 * Bottom-sheet advisor over the conversation, registered into the queue
 * dock's `conversation.input.dock.advisor` slot. While collapsed it renders
 * as a peek pill; expanded it is the confidence-gated sheet: the verdict
 * first (the decision the sheet exists to deliver), then the read-only
 * session snapshot, then the reasoning rows — the live advisory side run
 * when one is projected for this row, the instant tier-1 pre-verdict
 * otherwise. The sheet never talks to services; the queue dock owns every
 * fact and the delivery.
 */
export function AdvisorSurface(props: AdvisorSurfaceProps) {
  const {
    useProjection, open, peek, peekAnswers, running, queuedCount, busy, rowPreview, rowless,
    anchorId, lastHuman, minConfidence, followUp, onSendNow, onCollapse, onExpand, onClose, t,
  } = props
  /** The tier-1 pre-verdict, recomputed from the raw facts the dock hands over. */
  const advisorRun = useMemo(
    () => runAdvisorPipeline({ running, queuedCount, rowText: rowPreview }, minConfidence),
    [minConfidence, queuedCount, rowPreview, running],
  )
  const liveRun = useProjection('advisor/run')
  const live = liveRun != null && anchorId !== undefined && liveRun.queuedItemId === anchorId
    ? liveRun
    : undefined
  const liveRunning = live?.status === 'running'
  const liveSettled = live !== undefined && live.status !== 'running'
  const [full, setFull] = useState(false)
  const { steps, outcome } = advisorRun
  const gate = gateOutcome(outcome, minConfidence)
  const liveAllowed = live?.verdict !== undefined && live.verdict.confidence >= minConfidence
  if (!open) return null
  if (peek) {
    // The peek pill portals to document.body so it stays above any page card.
    return createPortal(
      <div className={css.peekPortal}>
        <div className={css.peek}>
          <span className={css.peekTitle}>{t('advisor.title')}</span>
          <span className={css.peekMeta}>{t('advisor.peek.answers', { n: peekAnswers })}{liveRunning ? ` · ${t('advisor.live.working')}` : ''}</span>
          <button
            type="button"
            className={css.peekBtn}
            aria-label={t('advisor.expand')}
            onClick={onExpand}
          >
            <IconChevronUpOutline14 />
          </button>
          <button
            type="button"
            className={css.peekBtn}
            aria-label={t('advisor.close')}
            onClick={onClose}
          >
            <IconCloseOutline16 />
          </button>
        </div>
      </div>,
      document.body,
    )
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('advisor.title')}
      closeLabel={t('advisor.close')}
      className={clsx(css.sheet, full && css.sheetFull)}
      contentClassName={clsx(css.frame)}
      footer={(
        <>
          <button
            type="button"
            className={css.iconBtn}
            aria-label={t('advisor.collapse')}
            onClick={onCollapse}
          >
            <IconChevronDownOutline14 />
          </button>
          {onSendNow !== undefined && (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>{t('advisor.keepQueued')}</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={onSendNow}>{t('advisor.sendNow')}</Button>
            </>
          )}
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
        {!rowless && (
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
        )}
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
          {!rowless && (
            <div className={css.row}>
              <span className={css.label}>{t('advisor.field.queued')}</span>
              <span className={css.value}>{t('advisor.queuedCount', { n: queuedCount })}</span>
            </div>
          )}
          <div className={css.row}>
            <span className={css.label}>{t(rowless ? 'advisor.field.about' : 'advisor.field.message')}</span>
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
                <span className={css.pipelineDetail}>{t(step.detail.key, step.detail.params)}</span>
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
        {followUp !== undefined && <FollowUpComposer followUp={followUp} t={t} />}
      </div>
    </Modal>
  )
}

/** The sheet's follow-up composer: one trimmed question starts one fresh advisory run. */
function FollowUpComposer({ followUp, t }: {
  followUp: NonNullable<AdvisorSurfaceProps['followUp']>
  t: AdvisorSurfaceProps['t']
}) {
  const [draft, setDraft] = useState('')
  const submit = (): void => {
    const question = draft.trim()
    if (followUp.disabled || question === '') return
    followUp.onSubmit(question)
    setDraft('')
  }
  return (
    <form
      className={css.composer}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
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
  )
}
