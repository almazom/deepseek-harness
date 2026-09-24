import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { SemanticMapConfig } from '../src/config.ts'
import {
  carryEcho,
  labelWithChunks,
  type LabelerInput,
  type SemanticMapLabeler,
} from '../src/label.ts'
import type { SemanticMapUnit } from '../src/types.ts'

const unit = (id: string, label: string, sealed = true): SemanticMapUnit => ({
  id,
  kind: 'direction',
  label,
  fromSeq: SessionSeq(0),
  toSeq: SessionSeq(0),
  sealed,
  eventCount: 1,
})

function countingLabeler(): { labeler: SemanticMapLabeler; inputs: LabelerInput[] } {
  const inputs: LabelerInput[] = []
  const labeler: SemanticMapLabeler = {
    label: async (input) => {
      inputs.push(input)
      return [unit(`u${inputs.length}`, `L${inputs.length}`)]
    },
  }
  return { labeler, inputs }
}

describe('carryEcho', () => {
  it('echoes the labels of the last three units', () => {
    const config = SemanticMapConfig.parse({})
    const units = ['a', 'b', 'c', 'd'].map((label, i) => unit(`u${i}`, label))
    expect(carryEcho(units, config)).toBe('b\nc\nd')
  })

  it('clips the echo to carryEchoTokens * 4 chars', () => {
    const config = SemanticMapConfig.parse({ carryEchoTokens: 1 })
    expect(carryEcho([unit('u0', 'long-label')], config)).toBe('long')
  })
})

describe('labelWithChunks', () => {
  it('makes a single labeler call when the digest fits the budget', async () => {
    const { labeler, inputs } = countingLabeler()
    const config = SemanticMapConfig.parse({})
    const lines = [
      { seq: 1, text: 'first direction' },
      { seq: 2, text: 'second direction' },
    ]
    const units = await labelWithChunks(labeler, { lines, carry: 'prior seal' }, config)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ truncated: false, carry: 'prior seal' })
    expect(inputs[0]?.digest).toBe('first direction\nsecond direction')
    expect(units.map(u => u.label)).toEqual(['L1'])
  })

  it('chains budget-sized chunks, threading each chunk into the next carry (AC3)', async () => {
    const { labeler, inputs } = countingLabeler()
    const config = SemanticMapConfig.parse({ digestBudget: 2 })
    const lines = [
      { seq: 1, text: 'line-01' },
      { seq: 2, text: 'line-02' },
      { seq: 3, text: 'line-03' },
    ]
    const units = await labelWithChunks(labeler, { lines, carry: '' }, config)
    expect(inputs).toHaveLength(3)
    expect(inputs[0]).toMatchObject({ digest: 'line-01', truncated: true, carry: '' })
    expect(inputs[1]).toMatchObject({ digest: 'line-02', truncated: true })
    expect(inputs[1]?.carry).toContain('L1')
    expect(inputs[2]).toMatchObject({ digest: 'line-03', truncated: false })
    expect(inputs[2]?.carry).toContain('L2')
    expect(units.map(u => u.label)).toEqual(['L1', 'L2', 'L3'])
  })

  it('never calls the labeler when there is nothing to scan', async () => {
    const { labeler, inputs } = countingLabeler()
    const config = SemanticMapConfig.parse({})
    const units = await labelWithChunks(labeler, { lines: [], carry: '' }, config)
    expect(inputs).toHaveLength(0)
    expect(units).toEqual([])
  })
})
