/**
 * HTML letters with inline styles.
 *
 * Mail clients strip `<style>` blocks unpredictably, so every rule that carries
 * meaning is written onto the element itself. The only media query this package
 * knows is the dark-mode block, and it is emitted solely for previews
 * (`includeStyleBlock`), never into a sent letter — a letter whose layout
 * depends on a style block is a letter that renders wrongly in half the inboxes.
 * @module @deepseek-ai/dsh-mail/html
 */

import { renderTemplate, type MailLocale } from './templates.ts'
import type { SendFailure } from './types.ts'

/** Default width of the letter body, in pixels. */
export const LETTER_WIDTH = 600

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * Escape text for an HTML text node.
 * @param text - untrusted text.
 * @returns the escaped text.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * The dark-mode block, used by previews only.
 *
 * Sending it inline is impossible, so a sent letter instead relies on the
 * `color-scheme` meta tag and on colours that keep contrast on both a light and
 * a dark background; the preview file shows what a client with dark mode would
 * do if it honoured the block.
 * @returns the CSS block.
 */
export function darkModeCss(): string {
  return [
    '@media (prefers-color-scheme: dark) {',
    '  body { background: #111418 !important; }',
    '  .letter { background: #1b1f24 !important; color: #e8eaed !important; }',
    '  .muted { color: #9aa0a6 !important; }',
    '  a { color: #8ab4f8 !important; }',
    '}',
  ].join('\n')
}

/** A call to action button in a letter. */
export interface CallToAction {
  /** Button label. */
  readonly label: string
  /** Destination URL. */
  readonly url: string
}

/** Input for {@link renderHtmlLetter}. */
export interface HtmlLetterInput {
  /** Headline. */
  readonly title: string
  /** Body paragraphs, in order. */
  readonly paragraphs: readonly string[]
  /** Optional button. */
  readonly cta?: CallToAction
  /** Optional footer line. */
  readonly footer?: string
  /** Locale, used for the `lang` attribute. */
  readonly locale?: MailLocale
  /** Emit a `<style>` block with the dark-mode query — previews only. */
  readonly includeStyleBlock?: boolean
}

/**
 * Render a standalone HTML letter.
 * @param input - the letter parts.
 * @returns the HTML document.
 */
export function renderHtmlLetter(input: HtmlLetterInput): string {
  const lang = input.locale ?? 'ru'
  const paragraphs = input.paragraphs
    .filter(paragraph => paragraph.length > 0)
    .map(paragraph => `        <p style="margin:0 0 16px;font:16px/1.55 ${FONT_STACK};color:#202124;">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('\n')
  const cta = input.cta === undefined
    ? ''
    : [
      '        <p style="margin:24px 0 8px;">',
      `          <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1a73e8;color:#ffffff;font:600 16px/1.2 ${FONT_STACK};text-decoration:none;">${escapeHtml(input.cta.label)}</a>`,
      '        </p>',
      `        <p style="margin:8px 0 0;font:13px/1.5 ${MONO_STACK};color:#5f6368;word-break:break-all;">${escapeHtml(input.cta.url)}</p>`,
    ].join('\n')
  const footer = input.footer === undefined
    ? ''
    : `\n        <p class="muted" style="margin:24px 0 0;font:13px/1.5 ${FONT_STACK};color:#5f6368;">${escapeHtml(input.footer)}</p>`
  const style = input.includeStyleBlock
    ? `    <style>\n${darkModeCss().split('\n').map(line => `      ${line}`).join('\n')}\n    </style>\n`
    : ''
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    '    <meta name="color-scheme" content="light dark">',
    '    <meta name="supported-color-schemes" content="light dark">',
    `    <title>${escapeHtml(input.title)}</title>`,
    ...(style === '' ? [] : [style.trimEnd()]),
    '  </head>',
    '  <body style="margin:0;padding:24px 12px;background:#f1f3f4;">',
    `    <div class="letter" style="max-width:${LETTER_WIDTH}px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;box-sizing:border-box;color:#202124;">`,
    `      <h1 style="margin:0 0 20px;font:600 22px/1.3 ${FONT_STACK};color:#202124;">${escapeHtml(input.title)}</h1>`,
    paragraphs,
    ...(cta === '' ? [] : [cta]),
    ...(footer === '' ? [] : [footer.trimStart()]),
    '    </div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * Flatten an HTML letter to its text alternative.
 * @param html - the HTML document.
 * @returns the plain-text rendering.
 */
export function htmlToText(html: string): string {
  const withoutHead = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
  const withBreaks = withoutHead
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|h1|h2|li|tr)>/gi, '\n')
  return withBreaks
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A letter with both bodies, as a mailer expects it. */
export interface ThemedLetter {
  /** Subject. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** HTML body. */
  readonly html: string
}

/**
 * Render one template into a text part plus an HTML part.
 *
 * The plain-text part is produced from the template itself rather than by
 * flattening the HTML, so both bodies are deliberate and the text part never
 * inherits markup artefacts.
 * @param id - template id.
 * @param locale - locale.
 * @param variables - template variables.
 * @param options - preview knobs.
 * @returns both bodies, or the refusal from the template renderer.
 */
export function renderThemedLetter(
  id: string,
  locale: MailLocale,
  variables: Readonly<Record<string, string>>,
  options: { readonly includeStyleBlock?: boolean; readonly footer?: string } = {},
): ({ ok: true } & ThemedLetter) | SendFailure {
  const rendered = renderTemplate(id, locale, variables)
  if (!rendered.ok) return rendered
  const html = renderHtmlLetter({
    title: rendered.subject,
    paragraphs: rendered.text.split('\n'),
    locale,
    ...(options.includeStyleBlock === undefined ? {} : { includeStyleBlock: options.includeStyleBlock }),
    ...(options.footer === undefined ? {} : { footer: options.footer }),
  })
  return { ok: true, subject: rendered.subject, text: rendered.text, html }
}
