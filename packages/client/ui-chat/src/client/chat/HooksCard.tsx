import { memo } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './ChatView.module.css'

/** Per-turn hook telemetry keyed Chat renderer. */
export const HooksNodeView = memo(function HooksNodeView({ node, t }: ChatNodeViewProps<'hooks'>) {
  return (
    <div className={css.hooksCard} data-hooks-card role="group" aria-label={t('hooks.card.aria')}>
      <span className={css.hooksTitle}>{t('hooks.card.title')}</span>
      <ul className={css.hooksRuns}>
        {node.data.hooks.map((run, index) => (
          <li
            key={`${run.point}-${run.handlerId}-${index}`}
            className={css.hooksRun}
            data-hook-decision={run.decision}
          >
            <span className={css.hooksPoint}>{run.point}</span>
            <span className={css.hooksHandler}>{run.handlerId}</span>
            {run.decision !== undefined && (
              <span className={css.hooksDecision}>{run.decision}</span>
            )}
            {run.durationMs !== undefined && (
              <span className={css.hooksDuration}>{t('hooks.card.duration', { n: run.durationMs })}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
})
