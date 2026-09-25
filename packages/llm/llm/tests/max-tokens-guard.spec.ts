/**
 * Guard: a request output cap above the model's declared capability is named and
 * clamped inside the seam instead of leaving DSH as a raw provider 400.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  clampMaxTokensToDeclaredCap,
  GenerateOptions,
  LlmAdapter,
  MAX_TOKENS_CLAMPED_CODE,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'

class CapAdapter extends LlmAdapter {
  private readonly script: StreamChunk[] = []

  constructor(private readonly declared?: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.declared === undefined ? {} : { defaultMaxTokens: this.declared },
    })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * this.script
  }
}

function config(maxTokens?: number): LlmCallConfig {
  return {
    provider: 'route',
    model: 'model',
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

function info(defaultMaxTokens?: number): LlmResolvedModelInfo {
  return {
    provider: 'route',
    id: 'model',
    name: 'Model',
    ...defaultMaxTokens === undefined ? {} : { defaultMaxTokens },
  }
}

describe('maxTokens declared-cap guard', () => {
  it('clamps an over-cap value and emits the named diagnostic', () => {
    const warned: string[] = []
    const guarded = clampMaxTokensToDeclaredCap(config(256_000), info(131_072), m => warned.push(m))
    expect(guarded).toEqual({ provider: 'route', model: 'model', maxTokens: 131_072 })
    expect(config(256_000)).toEqual({ provider: 'route', model: 'model', maxTokens: 256_000 })
    expect(warned).toEqual([
      `${MAX_TOKENS_CLAMPED_CODE}: provider "route" model "model" declares at most 131072 output tokens, `
      + 'but the request asked for 256000; clamping to 131072',
    ])
  })

  it.each([131_072, 8_192])('is silent and identity-preserving at or below the declared cap (%s)', (cap) => {
    const warned: string[] = []
    const input = config(cap)
    expect(clampMaxTokensToDeclaredCap(input, info(131_072), m => warned.push(m))).toBe(input)
    expect(warned).toEqual([])
  })

  it.each([
    ['the model declares no capability', config(256_000), info()],
    ['the request names no cap', config(), info(131_072)],
  ])('leaves the config untouched when %s', (_label, cfg, meta) => {
    const warned: string[] = []
    expect(clampMaxTokensToDeclaredCap(cfg, meta, m => warned.push(m))).toBe(cfg)
    expect(warned).toEqual([])
  })

  it('clamps through the public resolution path and keeps an explicit cap non-defaulted', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new CapAdapter(131_072))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    await expect(ctx.llm.resolveCallConfig(config(256_000))).resolves.toEqual({
      provider: 'route', model: 'model', maxTokens: 131_072,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain(MAX_TOKENS_CLAMPED_CODE)

    const prepared = await ctx.llm.prepareCall(config(256_000))
    expect(prepared.config.maxTokens).toBe(131_072)
    // The caller named a cap, so the header marker must not claim an adapter default.
    expect(prepared.adapterDefaults).toEqual({})
    warn.mockRestore()
  })

  it('still materializes an adapter-owned default within the declared capability', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new CapAdapter(131_072))
    await expect(ctx.llm.resolveCallConfig(config())).resolves.toEqual({
      provider: 'route', model: 'model', maxTokens: 131_072,
    })
    const prepared = await ctx.llm.prepareCall(config())
    expect(prepared.adapterDefaults).toEqual({ maxTokens: true })
  })
})
