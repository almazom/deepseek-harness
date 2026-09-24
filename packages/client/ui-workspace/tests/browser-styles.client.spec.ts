/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * row fills share the shell's trailing inset, the stable scrollbar counts
 * inside it, and flat, grouped, and search views keep their intended rhythm.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  const root = declarations('.root')
  const listArea = declarations('.listArea')
  const list = declarations('.list')

  it('is the scrolling region', () => {
    expect(list).toBeDefined()
    expect(list!.get('overflow-y')).toBe('auto')
  })

  it('counts the themed scrollbar inside the shell trailing inset', () => {
    expect(root?.get('--dsh-session-list-edge-inset')).toBe('var(--dsh-sidebar-inline-padding)')
    expect(root?.get('--dsh-session-list-scrollbar-width')).toBe('8px')
    expect(root?.get('--dsh-session-list-scrollbar-offset')).toBe('2px')
    expect(root?.get('padding-right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(listArea?.get('margin-left')).toBe('-4px')
    expect(listArea?.get('padding-left')).toBe('4px')
    expect(listArea?.get('margin-right')).toBe('calc(-1 * var(--dsh-session-list-edge-inset))')
    expect(declarations('.fade')?.get('right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(list?.get('margin-right')).toBe('var(--dsh-session-list-scrollbar-offset)')
    expect(list?.get('margin-left')).toBe('-4px')
    expect(list?.get('padding-left')).toBe('4px')
    expect(list?.get('padding-right')).toBe([
      'calc(',
      'var(--dsh-session-list-edge-inset)',
      '- var(--dsh-session-list-scrollbar-width)',
      '- var(--dsh-session-list-scrollbar-offset)',
      ')',
    ].join(' '))
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('reserves the scrollbar whether or not the list overflows', () => {
    expect(list!.get('scrollbar-gutter')).toBe('stable')
  })

  it('keeps 2px between rows and 4px between workspace groups', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('4px')
  })

  it('gives the full-page landing one card per group with hairline-divided rows', () => {
    const card = declarations('.wide .groupSection')
    expect(card?.get('background')).toBe('var(--dsw-alias-button-floating-fill)')
    expect(card?.get('border-radius')).toBe('16px')
    expect(card?.get('padding')).toBe('0 8px')
    for (const sel of ['.wide .flatList > * + *', '.wide .groupSection > * + *']) {
      expect(declarations(sel)?.get('border-top')).toBe('0.5px solid var(--dsw-alias-border-l1)')
      expect(declarations(sel)?.get('margin-top')).toBe('0')
    }
    expect(declarations('.wide .groupSection > .dayHeader + *')?.get('border-top')).toBe('none')
    /* The sidebar keeps its dense, frameless rhythm. */
    expect(declarations('.sidebar .groupSection')).toBeUndefined()
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    const listTopMarker = declarations('.listTopDropIndicator')
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the compact fade, overflow control, search field, and row heights', () => {
    expect(declarations('.fade')?.get('height')).toBe('24px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('28px')
    expect(declarations('.searchExpanded')?.get('height')).toBe('30px')
    expect(rowDeclarations('.projectRow')?.get('height')).toBe('34px')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('32px')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('20px')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('keeps the session title one rung above its 12px meta and time', () => {
    expect(rowDeclarations('.title')?.get('font-size')).toBe('16px')
    expect(rowDeclarations('.title')?.get('line-height')).toBe('22px')
    expect(rowDeclarations('.searchResultTitle')?.get('font-size')).toBe('16px')
    expect(rowDeclarations('.renameInput')?.get('font-size')).toBe('16px')
    expect(rowDeclarations('.meta')?.get('font-size')).toBe('12px')
    expect(rowDeclarations('.time')?.get('font-size')).toBe('12px')
  })

  it('opens every session row title with a capital letter without touching the stored string', () => {
    expect(rowDeclarations('.sessionRow .title::first-letter')?.get('text-transform')).toBe('uppercase')
    expect(rowDeclarations('.searchResultTitle::first-letter')?.get('text-transform')).toBe('uppercase')
  })

  it('keeps the live card surface on the phone and leaves the desktop list unlit', () => {
    const phoneAt = rowsCss.indexOf('@media (max-width: 768px)')
    expect(phoneAt).toBeGreaterThan(-1)
    const desktopCss = rowsCss.slice(0, phoneAt)
    const phoneCss = rowsCss.slice(phoneAt)
    const live = declarationsFrom(desktopCss, '.sessionRowLive')
    expect(live?.get('--dsh-live-inset')).toBe('var(--dsh-session-list-edge-inset, 20px)')
    expect(live?.get('--dsh-live-fill')).toBe('var(--dsw-alias-button-floating-fill)')
    expect(live?.get('--dsh-live-hover')).toBe('var(--dsw-alias-interactive-bg-hover)')
    /* Operator red pen 2026-09-23 («на десктопной версии у активной сессии
       инвертированная фоновая подсветка… надо это убрать, она здесь мешает»):
       the fill resolves LIGHTER than its panel while every other interactive
       surface in the app darkens, so the painted card is a phone-only surface.
       On desktop a live row is a plain row that keeps the ink/size hierarchy,
       and hover/selection stay the app's own full-bleed tint.
       The loud version (2px accent bar, full-bleed tint) must not come back
       either, and the frame must stay the row's own background: a
       pseudo-element frame painted ABOVE the text and washed the titles out. */
    expect(live?.get('background')).toBeUndefined()
    expect(live?.get('border-radius')).toBeUndefined()
    expect(live?.get('box-shadow')).toBeUndefined()
    expect(declarationsFrom(desktopCss, '.sessionRowLive::after')).toBeUndefined()
    for (const state of ['.sessionRowLive:hover', '.sessionRowLive.selected', '.sessionRowLive.menuOpen']) {
      expect(declarationsFrom(desktopCss, state)).toBeUndefined()
    }
    const phone = declarationsFrom(phoneCss, '.sessionRowLive')
    expect(phone?.get('border-radius')).toBe('10px')
    expect(phone?.get('background')).toContain('var(--dsh-live-inset) 1px / calc(100% - var(--dsh-live-inset)) calc(100% - 2px)')
    for (const state of ['.sessionRowLive:hover', '.sessionRowLive.selected', '.sessionRowLive.menuOpen']) {
      expect(declarationsFrom(phoneCss, state)?.get('background')).toContain('var(--dsh-live-hover)')
    }
    /* The ink and size hierarchy is surface-independent. */
    expect(rowDeclarations('.sessionRowLive .time')?.get('color')).toBe('var(--dsw-alias-label-secondary)')
    const settled = rowDeclarations('.sessionRow:not(.sessionRowLive):not(.selected) .title')
    expect(settled?.get('font-size')).toBe('15px')
    expect(settled?.get('color')).toBe('var(--dsw-alias-label-secondary)')
  })

  it('pins both rail controls to the shared left anchor during the column slide', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('36px')
    expect(declarations('.rail .search')?.get('width')).toBe('36px')
  })
})
