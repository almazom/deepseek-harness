import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useId, useMemo, useState } from 'react'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  FileTypeIcon, fileSizeText, IconEditOutline16, IconQueueOutline14, IconSendOutline14,
  IconSendSmartOutline14, IconTrashOutline16, projectUserText, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationNode } from '../contract/records.ts'
import type { QueueAction, QueueItemId, QueueRow } from '../contract/queue.ts'
import { NS } from '../locales.ts'
import { lastHumanPreview, runAdvisorPipeline } from './advisor.ts'
import { AdvisorSheet } from './AdvisorSheet.tsx'
import css from './QueueDock.module.css'

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
  /** Resolve one durable queued image into a session-scoped browser URL. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  hooks: {
    /** Durable Smart-steer confidence gate bound as useSmartSteerMinConfidence. */
    smartSteerMinConfidence: SnapshotStore<number>
  }
}

/**
 * Durable references carried by one queued row. Queue frames are wire data
 * despite their typed face, so an image block without a reference is skipped
 * rather than trusted.
 * @param content - the row's wire content blocks.
 * @returns the row's durable image references in block order.
 */
function queueAttachments(content: QueueRow['content']): Array<
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }
> {
  const attachments: Array<
    | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
    | { readonly type: 'file'; readonly attachment: FileAttachmentRef }
  > = []
  for (const block of content) {
    if (block.type === 'image') {
      const { attachment } = block as { attachment?: ImageAttachmentRef }
      if (attachment !== undefined) attachments.push({ type: 'image', attachment })
    }
    if (block.type === 'file') {
      const { attachment } = block as { attachment?: FileAttachmentRef }
      if (attachment !== undefined) attachments.push({ type: 'file', attachment })
    }
  }
  return attachments
}

/** Compact file identity used beside queue thumbnails. */
function QueueFile({ attachment, label }: { attachment: FileAttachmentRef; label: string }) {
  return (
    <span className={css.file} aria-label={label} title={attachment.name}>
      <span className={css.fileIcon} aria-hidden><FileTypeIcon path={attachment.name} size={16} /></span>
      <span className={css.fileName}>{attachment.name}</span>
      <span className={css.fileSize}>{fileSizeText(attachment.bytes)}</span>
    </span>
  )
}

/** One durable queued image as a fixed-size thumbnail; a load failure keeps the empty placeholder. */
function QueueThumb({ attachment, loadImage, label }: {
  attachment: ImageAttachmentRef
  loadImage: QueueDockInjected['loadImage']
  label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadImage(attachment).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* placeholder retained; the durable transcript surfaces read errors */ },
    )
    return () => { alive = false }
  }, [attachment, loadImage])
  return url === null
    ? <span className={css.thumb} aria-hidden />
    : <img className={css.thumb} src={url} alt={label} />
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & InjectFace<QueueDockInjected> & PropsLocale<'conversation'>

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing. Local submissions
 * show sending status and disabled actions until their Host queue rows arrive.
 */
export function QueueDock(props: QueueDockProps) {
  const { useSession, useProjection, updateQueue, notify, loadImage, useSmartSteerMinConfidence, t } = props
  // The renderer binds the chat seat for every session-scoped entry, but the
  // seat's owner (ui-chat) types it through an augmentation this package's
  // program cannot see: a project reference back to ui-chat would close a
  // reference cycle (ui-chat references this package). The advisor reads only
  // the legacy conversation slice, so it narrows the bound seat structurally
  // and degrades to "none" when a composition ships without the chat plugin.
  const useChat = (props as Partial<Record<'useChat', SnapshotSelectorHook<{ readonly legacy: { readonly nodes: readonly ConversationNode[] } }>>>).useChat
  const lastHuman = useChat?.(s => lastHumanPreview(s.legacy.nodes))
  const inbox = useSession(s => s.queue)
  const queue = useMemo(() => inbox.filter(row => row.placement === 'queued'), [inbox])
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  const pendingQueue = useMemo(() => {
    const admitted = new Set(queue.flatMap(row => row.rpcId === undefined ? [] : [row.rpcId]))
    return pendingSubmissions.filter(submission => (
      submission.placement === 'queued' && !admitted.has(submission.requestId)
    ))
  }, [pendingSubmissions, queue])
  const rowCount = queue.length + pendingQueue.length
  const running = useSession(s => s.running)
  const minConfidence = useSmartSteerMinConfidence(value => value)
  const queueMutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
  const [editing, setEditing] = useState<{ id: QueueItemId; text: string } | null>(null)
  const [busy, setBusy] = useState<QueueItemId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [advising, setAdvising] = useState<QueueRow | null>(null)
  /** Peek state: the sheet is collapsed into the pill while its side run streams on. */
  const [peek, setPeek] = useState(false)
  /** Settled advisory answers for the advised row, counting the initial run. */
  const [peekAnswers, setPeekAnswers] = useState(0)
  const listId = useId()

  useEffect(() => {
    if (rowCount === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !queue.some(row => row.id === editing.id))) setEditing(null)
    if (advising !== null && !queue.some(row => row.id === advising.id)) { setAdvising(null); setPeek(false) }
    if (advising === null) setPeek(false)
  }, [advising, collapsed, editing, queue, queueMutable, rowCount])

  const advisorRun = useMemo(
    () => runAdvisorPipeline({
      running, queuedCount: queue.length, rowText: advising?.text ?? '',
    }, minConfidence),
    [advising, minConfidence, queue.length, running],
  )
  const liveRun = useProjection('advisor/run')
  const live = useMemo(
    () => liveRun != null && advising !== null && liveRun.queuedItemId === advising.id
      ? liveRun
      : undefined,
    [advising, liveRun],
  )
  const liveRunning = live?.status === 'running'

  if (rowCount === 0) return null

  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
  const listVisible = rowCount === 1 || expanded

  const applyAction = async (
    itemId: QueueItemId,
    action: QueueAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      await updateQueue(itemId, action)
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [{ type: 'text', text: editing.text }] },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  return (
    <div className={css.dock} data-queue-dock="">
      <div className={css.panel}>
        {rowCount > 1 && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
            <span className={css.count}>{t('queue.count', { n: rowCount })}</span>
            {!listVisible && pendingQueue.length > 0 && (
              <span className={css.status} role="status">{t('queue.sending')}</span>
            )}
            <span className={css.chevron} aria-hidden>
              {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && queue.map((row) => {
            const attachments = queueAttachments(row.content)
            return (
              <li key={row.id} className={css.row}>
                {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
                {rowCount === 1 && <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>}
                {editing?.id === row.id
                  ? (
                    <input
                      autoFocus
                      className={css.editor}
                      aria-label={t('queue.edit')}
                      value={editing.text}
                      onChange={(event) => { setEditing({ id: row.id, text: event.currentTarget.value }) }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditing(null)
                          return
                        }
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          void saveEdit()
                        }
                      }}
                    />
                  )
                  : (
                    <>
                      {attachments.length > 0 && (
                        <span className={css.attachments}>
                          {attachments.map((item, index) => item.type === 'image'
                            ? (
                              <QueueThumb
                                key={`${item.attachment.attachmentId}:${index}`}
                                attachment={item.attachment}
                                loadImage={loadImage}
                                label={t('queue.image')}
                              />
                            )
                            : (
                              <QueueFile
                                key={`${item.attachment.attachmentId}:${item.attachment.name}:${index}`}
                                attachment={item.attachment}
                                label={t('queue.file', { name: item.attachment.name })}
                              />
                            ))}
                        </span>
                      )}
                      <span className={css.preview}>{projectUserText(row.preview, [])}</span>
                    </>
                  )}
                {queueMutable && <div className={css.actions}>
                  {editing?.id === row.id
                    ? (
                      <>
                        <Tooltip label={t('queue.save')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.save')}
                            disabled={busy !== null || editing.text.trim() === ''}
                            onClick={() => { void saveEdit() }}
                          >
                            <IconCheckOutline16 size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.cancelEdit')}
                            disabled={busy !== null}
                            onClick={() => { setEditing(null) }}
                          >
                            <IconCloseOutline16 size={14} />
                          </button>
                        </Tooltip>
                      </>
                    )
                    : (
                      <>
                        <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={row.text === null}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.edit')}
                            // Disabled buttons fire no hover events, so the
                            // unsupported hint stays a native title.
                            title={row.text === null ? t('queue.edit.unsupported') : undefined}
                            disabled={busy !== null || row.text === null}
                            onClick={() => {
                              if (row.text !== null) setEditing({ id: row.id, text: row.text })
                            }}
                          >
                            <IconEditOutline16 size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.remove')}
                            disabled={busy !== null}
                            onClick={() => {
                              void applyAction(
                                row.id,
                                { kind: 'remove' },
                                t('queue.removeFailed'),
                              )
                            }}
                          >
                            <IconTrashOutline16 size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.steer')}
                            title={running ? undefined : t('queue.steer.unavailable')}
                            disabled={busy !== null || !running}
                            onClick={() => {
                              void applyAction(
                                row.id,
                                { kind: 'steer' },
                                t('queue.steerFailed'),
                              )
                            }}
                          >
                            <IconSendOutline14 />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.steerSmart')} side="bottom" delayMs={500} disabled={!running}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.steerSmart')}
                            title={running ? undefined : t('queue.steerSmart.unavailable')}
                            disabled={busy !== null || !running}
                            onClick={() => {
                              setAdvising(row)
                              setPeek(false)
                              setPeekAnswers(0)
                              // Ask the host for the live advisory side run; the
                              // sheet already shows the instant tier-1 verdict,
                              // and the advisor/run projection replaces it as
                              // the model's phases land. Absent deployments
                              // reject the action and the tier-1 sheet stands.
                              void updateQueue(row.id, { kind: 'advise' }).catch(() => undefined)
                            }}
                          >
                            <IconSendSmartOutline14 />
                          </button>
                        </Tooltip>
                      </>
                    )}
                </div>}
              </li>
            )
          })}
          {listVisible && pendingQueue.map((submission) => {
            return (
              <li key={submission.requestId} className={`${css.row} ${css.pendingRow}`} data-submission-echo="">
                {rowCount === 1 && <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>}
                {submission.attachments.length > 0 && (
                  <span className={css.attachments}>
                    {submission.attachments.map((attachment, index) => attachment.type === 'image'
                      ? (
                        <img
                          key={`${attachment.value.previewUrl}:${index}`}
                          className={css.thumb}
                          src={attachment.value.previewUrl}
                          alt={t('queue.image')}
                        />
                      )
                      : (
                        <QueueFile
                          key={`${attachment.value.attachmentId}:${attachment.value.name}:${index}`}
                          attachment={attachment.value}
                          label={t('queue.file', { name: attachment.value.name })}
                        />
                      ))}
                  </span>
                )}
                <span className={css.preview}>{projectUserText(submission.text, [])}</span>
                <span className={css.status} role="status">{t('queue.sending')}</span>
                {queueMutable && <div className={css.actions}>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.edit')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconEditOutline16 size={14} />
                  </button>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.remove')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.steer')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconSendOutline14 />
                  </button>
                  <button
                    type="button"
                    className={css.action}
                    aria-label={t('queue.steerSmart')}
                    title={t('queue.sending')}
                    disabled
                  >
                    <IconSendSmartOutline14 />
                  </button>
                </div>}
              </li>
            )
          })}
        </ul>
      </div>
      {advising !== null && peek && (
        <div className={css.peek}>
          <span className={css.peekTitle}>{t('advisor.title')}</span>
          <span className={css.peekMeta}>{t('advisor.peek.answers', { n: peekAnswers })}{liveRunning ? ` · ${t('advisor.live.working')}` : ''}</span>
          <button
            type="button"
            className={css.peekBtn}
            aria-label={t('advisor.expand')}
            onClick={() => { setPeek(false) }}
          >
            <IconChevronUpOutline14 />
          </button>
          <button
            type="button"
            className={css.peekBtn}
            aria-label={t('advisor.close')}
            onClick={() => { setAdvising(null) }}
          >
            <IconCloseOutline16 />
          </button>
        </div>
      )}
      {advising !== null && !peek && (
        <AdvisorSheet
          open
          running={running}
          queuedCount={queue.length}
          rowPreview={advising.preview}
          lastHuman={lastHuman}
          busy={busy !== null}
          {...advisorRun}
          live={live}
          minConfidence={minConfidence}
          followUp={{
            disabled: liveRunning,
            onSubmit: (question) => {
              const itemId = advising.id
              setPeekAnswers(current => current + 1)
              void applyAction(itemId, { kind: 'advise', question }, t('queue.steerSmartFailed')).catch(() => undefined)
            },
          }}
          onCollapse={() => { setPeek(true) }}
          t={t}
          onSendNow={() => {
            const itemId = advising.id
            void applyAction(itemId, { kind: 'steer' }, t('queue.steerSmartFailed')).then((delivered) => {
              if (delivered) setAdvising(current => current?.id === itemId ? null : current)
            })
          }}
          onClose={() => { setAdvising(null) }}
        />
      )}
    </div>
  )
}

/**
 * Creates the queue-dock plugin. The Smart-steer confidence gate store is
 * the composer submission policy's reactive fact, shared with this entry
 * through the apply closure; the dock only reads it.
 * @param gate - reactive source of the durable Smart-steer confidence gate.
 * @returns the registrable queue-dock plugin.
 */
export function createQueueDockEntry(gate: SnapshotStore<number>) {
  return {
    name: 'conversation-queue-dock',
    inject: ['slots', 'conversation', 'sessions', 'uiConversation'],
    apply(ctx: Context): void {
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'queue',
        order: 20,
        locale: NS,
        inject: (sessionId: SessionId): QueueDockInjected => {
          const actx = ctx.sessions.scope(sessionId)
          if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
          const conversation = actx.get('conversation')
          if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
          return {
            updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
            notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
            loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
            hooks: { smartSteerMinConfidence: gate },
          }
        },
      }, QueueDock))
    },
  }
}
