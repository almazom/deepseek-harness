import { describe, expect, it } from 'vitest'
import { SemanticMapConfig } from '../src/config.ts'
import { Config } from '../src/index.ts'

describe('SemanticMapConfig', () => {
  it('applies the card defaults (AC1: digestBudget 6000, carry 300, timeout 60000)', () => {
    expect(SemanticMapConfig.parse({})).toEqual({
      digestBudget: 6000,
      carryEchoTokens: 300,
      timeoutMs: 60000,
    })
  })

  it('rejects unknown keys (AC1: strict schema catches cordis.yml typos)', () => {
    expect(() => SemanticMapConfig.parse({ digestBudgt: 1 })).toThrow()
  })

  it('accepts overrides and rejects non-positive or fractional limits', () => {
    expect(SemanticMapConfig.parse({ digestBudget: 100 })).toEqual({
      digestBudget: 100,
      carryEchoTokens: 300,
      timeoutMs: 60000,
    })
    expect(() => SemanticMapConfig.parse({ digestBudget: 0 })).toThrow()
    expect(() => SemanticMapConfig.parse({ digestBudget: 1.5 })).toThrow()
    expect(() => SemanticMapConfig.parse({ carryEchoTokens: -1 })).toThrow()
    expect(() => SemanticMapConfig.parse({ timeoutMs: 0 })).toThrow()
  })

  it('is exported as the plugin Config (Loader standard-schema seam)', () => {
    expect(Config).toBe(SemanticMapConfig)
  })
})
