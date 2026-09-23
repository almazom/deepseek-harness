/** CSS checks for the completed-turn footer's spacing: the tail row is spaced by
 * the column's flow token alone, with no additive footer offset. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

describe('completed-turn spacing', () => {
  it('spaces the turn tail with the flow token alone', () => {
    expect(read('ChatView.module.css')).toMatch(/margin-top:\s*var\(--dsh-chat-flow-gap, 16px\)/)
    const tail = read('TurnTailNodeView.module.css')
    // The 4px that used to sit here was inside the row's own box, so the
    // interval before the tail read 20px while every other pair of neighbouring
    // transcript rows read the column token (measured live 2026-09-23).
    expect(tail).not.toMatch(/\.actions\s*\{[^}]*margin-top/s)
    expect(tail).toMatch(/\.actions\s*\{[^}]*margin-left:\s*-6px/s)
  })
})
