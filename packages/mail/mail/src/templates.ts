/**
 * Localized letter templates.
 *
 * Every template exists in Russian and English with the same variables, and the
 * parity walk in this module is what the `verify-i18n-mail` gate runs. A
 * template that is missing a locale, a variable, or that was copied from one
 * locale to the other without being translated is a gate failure, reported with
 * the template name and the offending key.
 * @module @deepseek-ai/dsh-mail/templates
 */

import type { SendFailure } from './types.ts'

/** Locales this package ships. */
export type MailLocale = 'ru' | 'en'

/** Every shipped locale. */
export const MAIL_LOCALES: readonly MailLocale[] = ['ru', 'en']

/** One locale's rendering. */
export interface TemplateContent {
  /** Subject line, with `{variables}`. */
  readonly subject: string
  /** Body text, with `{variables}`. */
  readonly body: string
}

/** One template in every locale. */
export interface MailTemplate {
  /** Stable identifier used by the CLI and the MCP tool. */
  readonly id: string
  /** What the template is for, in English, for operators. */
  readonly description: string
  /** One rendering per locale. */
  readonly locales: Readonly<Partial<Record<MailLocale, TemplateContent>>>
}

/** The templates the family mail server actually sends. */
export const mailTemplates: readonly MailTemplate[] = [
  {
    id: 'invite',
    description: 'Invitation to open a family account',
    locales: {
      ru: {
        subject: 'Вход в семейный аккаунт {name}',
        body: [
          'Привет, {name}!',
          '',
          'Для тебя открыт семейный аккаунт. Ссылка для входа живёт {expiresMinutes} минут:',
          '{link}',
          '',
          'Если ты не просил доступ, просто не отвечай на это письмо.',
        ].join('\n'),
      },
      en: {
        subject: 'Family account invitation for {name}',
        body: [
          'Hello {name}!',
          '',
          'A family account has been opened for you. The sign-in link lives for {expiresMinutes} minutes:',
          '{link}',
          '',
          'If you did not ask for access, simply ignore this letter.',
        ].join('\n'),
      },
    },
  },
  {
    id: 'access-recovery',
    description: 'One-time access recovery code',
    locales: {
      ru: {
        subject: 'Код восстановления доступа для {name}',
        body: [
          'Привет, {name}!',
          '',
          'Твой одноразовый код: {code}',
          'Он действует {expiresMinutes} минут и работает один раз.',
          '',
          'Если это был не ты, смени устройство входа и напиши администратору.',
        ].join('\n'),
      },
      en: {
        subject: 'Access recovery code for {name}',
        body: [
          'Hello {name}!',
          '',
          'Your one-time code: {code}',
          'It works for {expiresMinutes} minutes and only once.',
          '',
          'If this was not you, change the sign-in device and tell the administrator.',
        ].join('\n'),
      },
    },
  },
  {
    id: 'nightly-report',
    description: 'Evening report of what the agents did',
    locales: {
      ru: {
        subject: 'Вечерний отчёт за {date}',
        body: [
          'Отчёт за {date}',
          '',
          'Готово: {done}',
          'В работе: {running}',
          'Требует решения: {blocked}',
          '',
          'Подробности: {summary}',
        ].join('\n'),
      },
      en: {
        subject: 'Evening report for {date}',
        body: [
          'Report for {date}',
          '',
          'Done: {done}',
          'Running: {running}',
          'Waiting on you: {blocked}',
          '',
          'Details: {summary}',
        ].join('\n'),
      },
    },
  },
  {
    id: 'test-letter',
    description: 'Delivery probe used by the acceptance suite',
    locales: {
      ru: {
        subject: 'Проверка почты {stamp}',
        body: [
          'Письмо-проверка собрано {stamp}.',
          'Транспорт: {transport}',
          '',
          'Если ты это читаешь, отправка работает.',
        ].join('\n'),
      },
      en: {
        subject: 'Mail probe {stamp}',
        body: [
          'Probe letter assembled at {stamp}.',
          'Transport: {transport}',
          '',
          'If you can read this, sending works.',
        ].join('\n'),
      },
    },
  },
]

/**
 * Find a template by id.
 * @param id - the template id.
 * @returns the template, or `undefined`.
 */
export function templateById(id: string): MailTemplate | undefined {
  return mailTemplates.find(template => template.id === id)
}

/**
 * Variable names used by a text, in order of appearance.
 * @param text - the template text.
 * @returns the unique variable names.
 */
export function placeholders(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Render a template in one locale.
 * @param id - the template id.
 * @param locale - the locale.
 * @param variables - values for the template's variables.
 * @returns the subject and body, or a refusal naming the missing variable.
 */
export function renderTemplate(
  id: string,
  locale: MailLocale,
  variables: Readonly<Record<string, string>>,
): { ok: true; subject: string; text: string } | SendFailure {
  const template = templateById(id)
  if (template === undefined) {
    return {
      ok: false,
      code: 'assembly',
      scope: 'template',
      detail: id,
      message: `assembly: unknown template "${id}" (known: ${mailTemplates.map(entry => entry.id).join(', ')})`,
    }
  }
  const content = template.locales[locale]
  if (content === undefined) {
    return {
      ok: false,
      code: 'assembly',
      scope: 'locale',
      detail: locale,
      message: `assembly: template "${id}" has no ${locale} locale`,
    }
  }
  const missing = [...placeholders(content.subject), ...placeholders(content.body)]
    .find(name => variables[name] === undefined)
  if (missing !== undefined) {
    return {
      ok: false,
      code: 'assembly',
      scope: 'template-variable',
      detail: missing,
      message: `assembly: template "${id}" needs a value for "${missing}"`,
    }
  }
  const fill = (text: string): string => text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_all, name: string) => variables[name] ?? '')
  return { ok: true, subject: fill(content.subject), text: fill(content.body) }
}

/** One i18n defect found by the parity walk. */
export interface TemplateParityProblem {
  /** Template the problem belongs to. */
  readonly template: string
  /** Locale the problem belongs to, when it is locale-bound. */
  readonly locale?: MailLocale
  /** What kind of defect this is. */
  readonly kind: 'missing-locale' | 'missing-key' | 'extra-key' | 'untranslated' | 'empty'
  /** A human-readable description naming the key. */
  readonly detail: string
}

/**
 * Compare every locale of every template.
 *
 * The `untranslated` check compares the literal text with the placeholders
 * removed: two locales with identical literal text are a copy-paste, which is
 * exactly the stray hardcoded string the gate is meant to catch.
 * @param templates - the templates to check; defaults to every shipped template.
 * @returns the problems, empty when the set is consistent.
 */
export function verifyTemplateParity(templates: readonly MailTemplate[] = mailTemplates): TemplateParityProblem[] {
  const problems: TemplateParityProblem[] = []
  for (const template of templates) {
    const reference: MailLocale = MAIL_LOCALES[0] ?? 'ru'
    const referenceContent = template.locales[reference]
    if (referenceContent === undefined) {
      problems.push({ template: template.id, locale: reference, kind: 'missing-locale', detail: `no ${reference} rendering` })
      continue
    }
    const referenceKeys = new Set([...placeholders(referenceContent.subject), ...placeholders(referenceContent.body)])
    for (const locale of MAIL_LOCALES.slice(1)) {
      const content = template.locales[locale]
      if (content === undefined) {
        problems.push({ template: template.id, locale, kind: 'missing-locale', detail: `no ${locale} rendering` })
        continue
      }
      const keys = new Set([...placeholders(content.subject), ...placeholders(content.body)])
      for (const key of referenceKeys) {
        if (!keys.has(key)) problems.push({ template: template.id, locale, kind: 'missing-key', detail: `{${key}} missing from ${locale}` })
      }
      for (const key of keys) {
        if (!referenceKeys.has(key)) problems.push({ template: template.id, locale, kind: 'extra-key', detail: `{${key}} exists only in ${locale}` })
      }
      const literal = (text: string): string => text.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
      if (literal(content.body) === literal(referenceContent.body) && literal(content.subject) === literal(referenceContent.subject)) {
        problems.push({ template: template.id, locale, kind: 'untranslated', detail: `${locale} is a copy of ${reference}` })
      }
      if (content.subject.trim().length === 0 || content.body.trim().length === 0) {
        problems.push({ template: template.id, locale, kind: 'empty', detail: `${locale} has an empty subject or body` })
      }
    }
    if (referenceContent.subject.trim().length === 0 || referenceContent.body.trim().length === 0) {
      problems.push({ template: template.id, locale: reference, kind: 'empty', detail: `${reference} has an empty subject or body` })
    }
  }
  return problems
}

/**
 * Render the parity walk as the report the `verify-i18n-mail` gate prints.
 * @param templates - the templates to check.
 * @returns a report ending in `PASS` or `FAIL`.
 */
export function generateMailI18nReport(templates: readonly MailTemplate[] = mailTemplates): string {
  const problems = verifyTemplateParity(templates)
  const lines = [
    `mail i18n: ${templates.length} template(s), ${MAIL_LOCALES.length} locales`,
    ...templates.map((template) => {
      const keys = [...new Set([...placeholders(template.locales.ru?.subject ?? ''), ...placeholders(template.locales.ru?.body ?? '')])]
      return `  ${template.id}: locales=${MAIL_LOCALES.filter(locale => template.locales[locale] !== undefined).join(',')} keys=${keys.join(',') || '-'}`
    }),
    ...problems.map(problem => `  FAIL ${problem.template}${problem.locale === undefined ? '' : `/${problem.locale}`}: ${problem.kind} — ${problem.detail}`),
  ]
  lines.push(problems.length === 0 ? 'PASS' : `FAIL (${problems.length} problem(s))`)
  return lines.join('\n')
}
