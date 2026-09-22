// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPagePathBridge } from '../src/client/index.ts'

beforeEach(() => { history.replaceState({}, '', '/') })
afterEach(() => { history.replaceState({}, '', '/') })

describe('createPagePathBridge', () => {
  it('pushes the page path with the marker and preserves the query', () => {
    history.replaceState({}, '', '/?token=abc')
    const bridge = createPagePathBridge()
    bridge.push('sessions')
    expect(location.pathname).toBe('/sessions')
    expect(location.search).toBe('?token=abc')
    expect(history.state).toEqual({ dshPagePath: true })
  })

  it('returns to base from a UI-nav entry', () => {
    const bridge = createPagePathBridge()
    bridge.push('sessions')
    bridge.returnToBase()
    expect(location.pathname).toBe('/')
    expect(history.state).toEqual({})
  })

  it('returns to base from a cold deep-link entry without a prior entry', () => {
    // Fresh-tab deep link: the token URL redirected to /sessions, so this is
    // the only history entry and history.back() would be a no-op (or reload
    // the token URL). The bridge must replace instead.
    history.replaceState({ dshPagePath: true }, '', '/sessions?token=abc')
    const lengthBefore = history.length
    const bridge = createPagePathBridge()
    bridge.returnToBase()
    expect(location.pathname).toBe('/')
    expect(location.search).toBe('')
    expect(history.length).toBe(lengthBefore)
  })

  it('maps known page paths to panels and unknown paths to null', () => {
    const bridge = createPagePathBridge()
    history.replaceState({}, '', '/sessions')
    expect(bridge.panelFromPath()).toBe('sessions')
    history.replaceState({}, '', '/dsh/sessions')
    expect(bridge.panelFromPath()).toBe('sessions')
    history.replaceState({}, '', '/')
    expect(bridge.panelFromPath()).toBeNull()
    history.replaceState({}, '', '/other')
    expect(bridge.panelFromPath()).toBeNull()
  })
})
