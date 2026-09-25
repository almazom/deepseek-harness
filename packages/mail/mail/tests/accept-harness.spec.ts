import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { formatAcceptanceTable, runAcceptance } from '../src/accept.ts'
import type { AcceptanceResult } from '../src/accept.ts'
import { tempHome, testConfig } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

describe('accept-harness', () => {
  it('passes every offline probe', async () => {
    const home = await tempHome(); homes.push(home)
    const result = await runAcceptance({ config: testConfig(home) })
    const failed = result.checks.filter(check => !check.ok)
    expect(failed.map(check => `${check.name}: ${check.detail}`)).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.checks.length).toBeGreaterThanOrEqual(10)
  })

  it('ends the table with a RESULT line', async () => {
    const home = await tempHome(); homes.push(home)
    const result: AcceptanceResult = await runAcceptance({ config: testConfig(home), dryRun: true })
    const table = formatAcceptanceTable(result)
    expect(table).toContain('PASS  templates-ru-en-parity')
    expect(table.trimEnd().split('\n').pop()).toBe(`RESULT: PASS (${result.checks.length}/${result.checks.length})`)
  })
})
