import clsx from 'clsx'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AdvisorVerdict } from './advisor.ts'
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
  verdict: AdvisorVerdict
  t: Translator
  onSendNow: () => void
  onClose: () => void
}

/**
 * Bottom-sheet advisor over the conversation: a read-only session snapshot, the
 * deterministic tier-1 verdict with its reason, and the override actions. The sheet
 * never talks to services; QueueDock owns the facts and the delivery.
 */
export function AdvisorSheet({
  open, running, queuedCount, rowPreview, lastHuman, busy, verdict, t, onSendNow, onClose,
}: AdvisorSheetProps) {
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
        <div className={css.verdict}>
          <span className={css.verdictKind}>{t('advisor.verdict.label')}</span>
          <span className={css.verdictReason}>{t(verdict.reasonKey)}</span>
        </div>
      </div>
    </Modal>
  )
}
