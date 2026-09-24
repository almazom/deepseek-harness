import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface DigestLine {
  seq: number
  text: string
}

export interface DigestResult {
  text: string
  truncated: boolean
  consumed: number
}

/**
 * Collapse one session event into a single digest line, or `null` when the
 * event carries nothing worth sending to the labeler (sidecar/own events,
 * empty payloads).
 *
 * The full raw log is never forwarded: user turns and compaction summaries are
 * quoted verbatim (they are the operator's own words), tool traffic is
 * compressed to a short clustered form (spec: tools compressed ~10x).
 */
export function digestLine(event: SessionEvent): DigestLine | null {
  const type = String(event.type)
  const data = (event as { data?: unknown }).data
  switch (type) {
    case 'user/message': {
      const text = extractText((data as { content?: unknown } | undefined)?.content)
      if (!text) return null
      return { seq: event.seq, text: text.slice(0, 400) }
    }
    case 'compaction/summary': {
      const text = extractText((data as { summary?: unknown } | undefined)?.summary)
      if (!text) return null
      return { seq: event.seq, text: `[summary] ${text}` }
    }
    case 'tool/call':
    case 'tool/result': {
      const tool = (data ?? {}) as { name?: string; toolName?: string }
      const name = tool.name ?? tool.toolName ?? 'tool'
      return { seq: event.seq, text: `${type === 'tool/call' ? '>' : '<'} ${name}` }
    }
    default:
      return null
  }
}

/**
 * Build a digest line list capped at `budgetTokens * 4` characters (the
 * standard tokens->chars heuristic), stopping at the first line that would
 * overflow. `truncated` reports that tail events remain unscanned; `consumed`
 * is how many input lines fit, so the caller can continue the chunked scan.
 */
export function buildDigest(lines: readonly DigestLine[], budgetTokens: number): DigestResult {
  const budgetChars = budgetTokens * 4
  const kept: string[] = []
  let used = 0
  let consumed = 0

  for (const line of lines) {
    const next = kept.length > 0 ? `\n${line.text}` : line.text
    if (used + next.length > budgetChars) {
      if (kept.length === 0) {
        // A single line larger than the whole budget: keep a clipped prefix so
        // the scan still makes progress.
        kept.push(line.text.slice(0, budgetChars))
        used = budgetChars
        consumed += 1
      }
      return { text: kept.join('\n'), truncated: true, consumed }
    }
    kept.push(line.text)
    used += next.length
    consumed += 1
  }

  return { text: kept.join('\n'), truncated: false, consumed }
}

/** Extract plain text from a string, a ContentBlock array, or one block. */
export function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map(block => (typeof block === 'string' ? block : extractBlockText(block)))
      .filter(Boolean)
      .join(' ')
  }
  return extractBlockText(value)
}

function extractBlockText(block: unknown): string {
  if (block && typeof block === 'object' && 'text' in block) {
    const text = (block as { text: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}
