/**
 * RFC 5322 assembly: one {@link Letter} in, one serialized message out.
 *
 * Assembly is the atomic step of this package — a letter is fully rendered in
 * memory, including its attachments and its Message-ID, before any transport
 * sees it. A failure here therefore cannot leave a half-letter anywhere, and
 * the transport contract is reduced to "send these exact bytes".
 * @module @deepseek-ai/dsh-mail/mime
 */

import { randomUUID } from 'node:crypto'
import { detectContentType, sanitizeFilename } from './attachments.ts'
import type { Attachment, Letter } from './types.ts'

/** Whether every code point fits in US-ASCII, i.e. whether 7bit is safe. */
function isAscii(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (codePoint !== undefined && codePoint > 0x7f) return false
  }
  return true
}

/**
 * Encode a header value, RFC 2047 base64-encoding it when it is not ASCII.
 * @param value - the header text.
 * @returns an ASCII-safe header value.
 */
export function encodeHeaderValue(value: string): string {
  if (isAscii(value) && !/[\r\n]/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/**
 * Fold a header body onto lines of at most 78 characters.
 * @param name - the header name.
 * @param value - the header value.
 * @returns the header, folded with a leading space on continuation lines.
 */
function foldHeader(name: string, value: string): string {
  const prefix = `${name}: `
  const words = value.split(' ')
  const lines: string[] = []
  let current = prefix
  for (const word of words) {
    if (current.length + word.length + 1 > 78 && current.length > prefix.length) {
      lines.push(current)
      current = ` ${word}`
      continue
    }
    current = current === prefix ? `${prefix}${word}` : `${current} ${word}`
  }
  lines.push(current)
  return lines.join('\r\n')
}

/**
 * Normalize a body to CRLF line endings, which is what SMTP DATA requires.
 * @param text - the body.
 * @returns the body with CRLF endings.
 */
function crlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r\n')
}

/**
 * Encode a body part, base64 when it carries non-ASCII text.
 * @param text - the part body.
 * @returns the headers and encoded body of the part.
 */
function encodeTextPart(text: string): { headers: string[]; body: string } {
  const normalized = crlf(text)
  if (isAscii(normalized)) return { headers: ['Content-Transfer-Encoding: 7bit'], body: normalized }
  return {
    headers: ['Content-Transfer-Encoding: base64'],
    body: Buffer.from(normalized, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  }
}

/**
 * Resolve one attachment's wire name and content type.
 * @param attachment - the attachment to describe.
 * @returns the sanitized filename and the detected content type.
 */
export function describeAttachment(attachment: Attachment): { filename: string; contentType: string } {
  const filename = sanitizeFilename(attachment.filename) ?? 'attachment'
  return {
    filename,
    contentType: attachment.contentType ?? detectContentType(filename, attachment.content),
  }
}

/**
 * Render one attachment as a MIME part.
 * @param attachment - the attachment.
 * @returns the part text.
 */
function renderAttachment(attachment: Attachment): string {
  const { filename, contentType } = describeAttachment(attachment)
  const encoded = Buffer.from(attachment.content).toString('base64').replace(/(.{76})/g, '$1\r\n')
  return [
    `Content-Type: ${contentType}; name="${encodeHeaderValue(filename)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${encodeHeaderValue(filename)}"`,
    '',
    encoded,
  ].join('\r\n')
}

/** A serialized letter: the bytes a transport must deliver, plus its identity. */
export interface RenderedLetter {
  /** Full RFC 5322 message text, CRLF-terminated, dot-stuffing NOT yet applied. */
  readonly raw: string
  /** The Message-ID header value, unique per render. */
  readonly messageId: string
  /** Envelope recipients in order, without duplicates. */
  readonly recipients: readonly string[]
}

/**
 * Render a letter to RFC 5322 text.
 *
 * The Message-ID is generated here, once, so a retry by a caller re-rendering
 * the same letter is a new letter — and a transport that fails never leaves a
 * message that "somewhere" carries an id.
 * @param letter - the assembled letter.
 * @param options - clock and id factory, injected by tests.
 * @returns the serialized message.
 */
export function renderLetter(
  letter: Letter,
  options: { readonly now?: () => Date; readonly messageId?: () => string } = {},
): RenderedLetter {
  const now = options.now?.() ?? new Date()
  const messageId = options.messageId?.() ?? `<${randomUUID()}@dsh-mail.local>`
  const recipients = [...new Set([...letter.to, ...letter.cc ?? []])]
  const headers: string[] = [
    foldHeader('From', letter.from),
    foldHeader('To', letter.to.join(', ')),
  ]
  if (letter.cc !== undefined && letter.cc.length > 0) headers.push(foldHeader('Cc', letter.cc.join(', ')))
  if (letter.replyTo !== undefined) headers.push(foldHeader('Reply-To', letter.replyTo))
  headers.push(foldHeader('Subject', encodeHeaderValue(letter.subject)))
  headers.push(`Date: ${now.toUTCString()}`)
  headers.push(`Message-ID: ${messageId}`)
  headers.push('MIME-Version: 1.0')
  for (const [name, value] of Object.entries(letter.headers ?? {})) headers.push(foldHeader(name, value))

  const attachments = letter.attachments ?? []
  const body = renderBody(letter, attachments)
  headers.push(...body.headers)
  return { raw: `${headers.join('\r\n')}\r\n\r\n${body.body}\r\n`, messageId, recipients }
}

/**
 * Render the body, nesting `multipart/alternative` inside `multipart/mixed`
 * only when there is something to nest.
 * @param letter - the letter.
 * @param attachments - validated attachments.
 * @returns the body headers and body text.
 */
function renderBody(letter: Letter, attachments: readonly Attachment[]): { headers: string[]; body: string } {
  const textPart = encodeTextPart(letter.text)
  const hasHtml = letter.html !== undefined && letter.html.length > 0
  const htmlPart = hasHtml ? encodeTextPart(letter.html ?? '') : undefined

  let alternative: string | undefined
  let alternativeHeaders: string[] = []
  if (htmlPart !== undefined) {
    const boundary = `alt-${randomUUID()}`
    alternativeHeaders = [`Content-Type: multipart/alternative; boundary="${boundary}"`]
    alternative = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      ...textPart.headers,
      '',
      textPart.body,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      ...htmlPart.headers,
      '',
      htmlPart.body,
      `--${boundary}--`,
      '',
    ].join('\r\n')
  }

  if (attachments.length === 0) {
    if (alternative !== undefined) return { headers: alternativeHeaders, body: alternative }
    return { headers: ['Content-Type: text/plain; charset=utf-8', ...textPart.headers], body: textPart.body }
  }

  const boundary = `mix-${randomUUID()}`
  const parts: string[] = []
  if (alternative !== undefined) {
    parts.push(`--${boundary}`, ...alternativeHeaders, '', alternative)
  } else {
    parts.push(`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', ...textPart.headers, '', textPart.body)
  }
  for (const attachment of attachments) parts.push(`--${boundary}`, renderAttachment(attachment), '')
  parts.push(`--${boundary}--`, '')
  return { headers: [`Content-Type: multipart/mixed; boundary="${boundary}"`], body: parts.join('\r\n') }
}

/**
 * Escape leading dots, which SMTP DATA treats as the end-of-data marker.
 * @param raw - the serialized message.
 * @returns the message with dot-stuffing applied.
 */
export function dotStuff(raw: string): string {
  return raw.replace(/(^|\r\n)\./g, '$1..')
}

/**
 * The headers a human reads in a console preview.
 * @param letter - the assembled letter.
 * @returns the header lines, without the body.
 */
export function previewHeaders(letter: Letter): string[] {
  const lines = [
    `From: ${letter.from}`,
    `To: ${letter.to.join(', ')}`,
  ]
  if (letter.cc !== undefined && letter.cc.length > 0) lines.push(`Cc: ${letter.cc.join(', ')}`)
  lines.push(`Subject: ${letter.subject}`)
  return lines
}
