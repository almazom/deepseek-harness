/**
 * Attachment admission: size, count, filename, and type policy.
 *
 * An agent-driven mailer must refuse to become an exfiltration or malware
 * channel. Every rule here is a refusal with a reason, never a silent
 * truncation: a letter either carries exactly the attachments the caller
 * named, or it is not sent at all.
 * @module @deepseek-ai/dsh-mail/attachments
 */

import type { Attachment, SendFailure } from './types.ts'

/** Limits applied to every letter's attachment list. */
export interface AttachmentLimits {
  /** Maximum number of attachments per letter. */
  readonly maxCount: number
  /** Maximum size of one attachment, in bytes. */
  readonly maxBytesPerFile: number
  /** Maximum combined size of all attachments, in bytes. */
  readonly maxTotalBytes: number
  /** File extensions refused outright, because mail clients execute or run them. */
  readonly deniedExtensions: readonly string[]
  /** Longest accepted file name, in characters. */
  readonly maxFilenameLength: number
}

/** The defaults a family mail server can live with. */
export const defaultAttachmentLimits: AttachmentLimits = {
  maxCount: 10,
  maxBytesPerFile: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxFilenameLength: 200,
  deniedExtensions: [
    '.bat', '.cmd', '.com', '.cpl', '.exe', '.hta', '.jar', '.js', '.jse',
    '.lnk', '.msi', '.pif', '.ps1', '.scr', '.sh', '.vbs', '.wsf',
  ],
}

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
}

/**
 * Human-readable size, used only in refusal messages.
 * @param bytes - the size.
 * @returns the size with a unit.
 */
function size(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  return mib >= 1 ? `${mib.toFixed(1)} MiB` : `${bytes} B`
}

/**
 * Reduce a caller-supplied name to a safe flat file name.
 *
 * Directory separators are dropped (a path becomes its last segment), control
 * characters and characters a mail client would misparse are replaced, and the
 * result is capped in length while keeping its extension. `.` and `..` are
 * refused, so a name can never escape the directory a recipient saves it into.
 * @param name - the caller's file name.
 * @param limits - limits supplying the length cap.
 * @returns the safe name, or `undefined` when nothing usable remains.
 */
export function sanitizeFilename(
  name: string,
  limits: AttachmentLimits = defaultAttachmentLimits,
): string | undefined {
  const lastSegment = name.split(/[\\/]/).pop() ?? ''
  const cleaned = lastSegment.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return undefined
  if (cleaned.length <= limits.maxFilenameLength) return cleaned
  const dot = cleaned.lastIndexOf('.')
  if (dot <= 0 || dot < cleaned.length - 16) return cleaned.slice(0, limits.maxFilenameLength)
  const extension = cleaned.slice(dot)
  return `${cleaned.slice(0, limits.maxFilenameLength - extension.length)}${extension}`
}

/**
 * Every dotted segment of a file name, so a double extension cannot hide an
 * executable: `report.pdf.exe` yields `['.pdf', '.exe']`.
 * @param filename - the sanitized file name.
 * @returns the segments, lowercased and dot-prefixed.
 */
function extensionSegments(filename: string): string[] {
  const parts = filename.toLowerCase().split('.')
  return parts.slice(1).map(part => `.${part}`)
}

/**
 * Type of an attachment, preferring what the bytes say over the file name.
 *
 * A caller can name a PDF `notes.txt`; sniffing the magic bytes keeps the MIME
 * part honest, and the extension stays the fallback for text-like files that
 * carry no signature.
 * @param filename - the sanitized file name.
 * @param content - the bytes.
 * @returns the MIME type.
 */
export function detectContentType(filename: string, content: Uint8Array): string {
  const head = content.subarray(0, 8)
  const ascii = String.fromCharCode(...head)
  if (ascii.startsWith('%PDF-')) return 'application/pdf'
  if (head[0] === 0x89 && ascii.startsWith('\u0089PNG')) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (ascii.startsWith('GIF8')) return 'image/gif'
  if (head[0] === 0x50 && head[1] === 0x4b) return 'application/zip'
  if (ascii.startsWith('RIFF') && String.fromCharCode(...content.subarray(8, 12)) === 'WEBP') return 'image/webp'
  const dot = filename.lastIndexOf('.')
  const extension = dot < 0 ? '' : filename.slice(dot).toLowerCase()
  return EXTENSION_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * Validate an attachment list against the limits.
 *
 * A rejected attachment carries the offending file name so the caller can fix
 * the request, but never the bytes.
 * @param attachments - the caller's attachments.
 * @param limits - the limits to enforce; defaults to {@link defaultAttachmentLimits}.
 * @returns `undefined` when the list is admissible, else the refusal.
 */
export function validateAttachments(
  attachments: readonly Attachment[],
  limits: AttachmentLimits = defaultAttachmentLimits,
): SendFailure | undefined {
  if (attachments.length > limits.maxCount) {
    return {
      ok: false,
      code: 'attachment_too_large',
      scope: 'attachment-count',
      message: `attachment: ${attachments.length} attachments exceed the limit of ${limits.maxCount}`,
    }
  }
  let total = 0
  for (const attachment of attachments) {
    const filename = sanitizeFilename(attachment.filename, limits)
    if (filename === undefined) {
      return {
        ok: false,
        code: 'attachment_type_blocked',
        scope: 'attachment-name',
        message: `attachment: "${attachment.filename}" has no usable file name`,
        detail: attachment.filename,
      }
    }
    for (const extension of extensionSegments(filename)) {
      if (limits.deniedExtensions.includes(extension)) {
        return {
          ok: false,
          code: 'attachment_type_blocked',
          scope: 'attachment-extension',
          message: `attachment: "${filename}" has a refused extension (${extension})`,
          detail: filename,
        }
      }
    }
    if (attachment.content.byteLength > limits.maxBytesPerFile) {
      return {
        ok: false,
        code: 'attachment_too_large',
        scope: 'attachment-file-size',
        message: `attachment: "${filename}" is ${size(attachment.content.byteLength)}, over the ${size(limits.maxBytesPerFile)} per-file limit`,
        detail: filename,
      }
    }
    total += attachment.content.byteLength
  }
  if (total > limits.maxTotalBytes) {
    return {
      ok: false,
      code: 'attachment_too_large',
      scope: 'attachment-total-size',
      message: `attachment: attachments total ${size(total)}, over the ${size(limits.maxTotalBytes)} limit`,
    }
  }
  return undefined
}
