import { describe, expect, it } from 'vitest'
import { MAIL_LOCALES, generateMailI18nReport, mailTemplates, placeholders, renderTemplate, templateById, verifyTemplateParity } from '../src/templates.ts'

describe('render', () => {
  it('keeps every template in both locales with identical variables', () => {
    expect(verifyTemplateParity()).toEqual([])
    expect(generateMailI18nReport()).toContain('PASS')
    expect(MAIL_LOCALES).toEqual(['ru', 'en'])
    for (const template of mailTemplates) {
      expect(template.locales.ru).toBeDefined()
      expect(template.locales.en).toBeDefined()
    }
  })

  it('renders ru and en variants of every template', () => {
    for (const template of mailTemplates) {
      for (const locale of MAIL_LOCALES) {
        const content = template.locales[locale]
        const variables = Object.fromEntries(placeholders(`${content?.subject ?? ''} ${content?.body ?? ''}`).map(name => [name, `v-${name}`]))
        const rendered = renderTemplate(template.id, locale, variables)
        expect(rendered.ok).toBe(true)
        if (rendered.ok) expect(rendered.text).not.toContain('{')
      }
    }
  })

  it('names the missing variable and the missing template', () => {
    const missing = renderTemplate('invite', 'ru', { name: 'Тимур' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.code).toBe('assembly')
      expect(missing.scope).toBe('template-variable')
    }
    const unknown = renderTemplate('nope', 'ru', {})
    if (!unknown.ok) expect(unknown.scope).toBe('template')
  })

  it('deduplicates placeholders in order', () => {
    expect(placeholders('{a} {b} {a}')).toEqual(['a', 'b'])
    expect(templateById('test-letter')?.id).toBe('test-letter')
    expect(templateById('missing')).toBeUndefined()
  })

  it('detects a template that drifted between locales', () => {
    const drifted = [{
      id: 'drifted',
      description: 'test fixture',
      locales: {
        ru: { subject: 'Привет {name}', body: 'Текст {name}' },
        en: { subject: 'Hello {firstName}', body: 'Text {firstName}' },
      },
    }]
    const problems = verifyTemplateParity(drifted)
    expect(problems.length).toBeGreaterThan(0)
    expect(generateMailI18nReport(drifted)).toContain('FAIL')
  })
})
