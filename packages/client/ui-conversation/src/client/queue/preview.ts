/** Newest human transcript preview over the legacy conversation nodes. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ConversationNode } from '../contract/records.ts'

/**
 * Newest human-visible transcript preview (user or steering node), oldest-first scan
 * from the tail. Attachment-only or empty messages are skipped in favor of the next
 * older one.
 * @param nodes - the chat target's legacy conversation nodes in ascending seq order.
 * @returns the newest human text preview, or undefined before any human input.
 */
export function lastHumanPreview(nodes: readonly ConversationNode[]): string | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const preview = textPreview(node.content)
    if (preview !== undefined) return preview
  }
  return undefined
}

/** Whitespace-collapsed concatenation of the blocks' text; undefined without any text. */
function textPreview(content: readonly ContentBlock[]): string | undefined {
  const text = content
    .map(block => block.type === 'text' ? block.text : '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? undefined : text
}
