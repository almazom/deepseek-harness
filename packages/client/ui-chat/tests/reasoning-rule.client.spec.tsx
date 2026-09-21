// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const renderMessageImages = () => null

describe('reasoning left rule', () => {
  it('expanded reasoning renders the rule element; collapsed does not', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    // Collapsed: only the summary row exists; the rule-carrying body is not rendered.
    expect(view.container.querySelector('[class*="thinkBody"]')).toBeNull()

    fireEvent.click(view.getByText('思考'))
    const body = view.container.querySelector('[class*="thinkBody"]')
    expect(body).not.toBeNull()
    // The rule lives on this exact element in ReasoningRow.module.css (.thinkBody).
    expect(body?.className).toContain('thinkBody')

    fireEvent.click(view.getByText('思考'))
    expect(view.container.querySelector('[class*="thinkBody"]')).toBeNull()
  })
})
