import { describe, expect, it } from 'vitest'
import { defaultAttachmentLimits, detectContentType, sanitizeFilename, validateAttachments } from '../src/attachments.ts'
import type { Attachment } from '../src/types.ts'

const file = (filename: string, size = 8): Attachment => ({ filename, content: new Uint8Array(size).fill(65) })

describe('attach', () => {
  it('refuses a file above the per-file cap', () => {
    const failure = validateAttachments([file('big.bin', 20)], { ...defaultAttachmentLimits, maxBytesPerFile: 10 })
    expect(failure?.code).toBe('attachment_too_large')
    expect(failure?.scope).toBe('attachment-file-size')
    expect(failure?.detail).toBe('big.bin')
  })

  it('refuses too many files and too many total bytes', () => {
    const count = validateAttachments([file('a.bin'), file('b.bin')], { ...defaultAttachmentLimits, maxCount: 1 })
    expect(count?.scope).toBe('attachment-count')
    const total = validateAttachments([file('a.bin', 8), file('b.bin', 8)], { ...defaultAttachmentLimits, maxTotalBytes: 10 })
    expect(total?.scope).toBe('attachment-total-size')
  })

  it('catches a double extension and a denylisted extension', () => {
    const double = validateAttachments([file('invoice.pdf.exe')])
    expect(double?.code).toBe('attachment_type_blocked')
    expect(double?.scope).toBe('attachment-extension')
    const denied = validateAttachments([file('payload.SCR')])
    expect(denied?.code).toBe('attachment_type_blocked')
    expect(validateAttachments([file('notes.pdf')])).toBeUndefined()
  })

  it('sanitizes traversal and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('a\u0000b.txt')).toBe('a_b.txt')
    expect(sanitizeFilename('..')).toBeUndefined()
    expect(sanitizeFilename('')).toBeUndefined()
    expect(sanitizeFilename(`${'x'.repeat(300)}.txt`)?.length).toBeLessThanOrEqual(defaultAttachmentLimits.maxFilenameLength)
  })

  it('sniffs common content types from the bytes', () => {
    expect(detectContentType('a.bin', new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf')
    expect(detectContentType('a.bin', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectContentType('a.unknown', new Uint8Array([1, 2, 3]))).toBe('application/octet-stream')
  })
})
