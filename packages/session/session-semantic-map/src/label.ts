import type { SemanticMapConfig } from './config.ts'
import type { SemanticMapUnit } from './types.ts'
import { buildDigest, type DigestLine } from './digest.ts'

export interface LabelerInput {
  digest: string
  truncated: boolean
  carry: string
}

/**
 * The labeling strategy seam. The default (TC-003) path is the deterministic
 * fallback; TC-004's `session-semantic-map-llm` package supplies the
 * cloud-flash implementation behind this interface so raw model calls stay
 * out of this package until they are logged (model-visible <=> logged).
 */
export interface SemanticMapLabeler {
  label(input: LabelerInput, config: SemanticMapConfig): Promise<SemanticMapUnit[]>
}

export interface LabelChunksInput {
  lines: readonly DigestLine[]
  carry: string
}

/**
 * Chunked tail scan: walks the digest lines in `digestBudget`-sized windows,
 * chaining each window's unit labels into the carry echo of the next so the
 * labeler sees continuity without ever receiving the full raw log
 * (spec: digest > BUDGET -> chunk chain, else single call).
 */
export async function labelWithChunks(
  labeler: SemanticMapLabeler,
  input: LabelChunksInput,
  config: SemanticMapConfig,
): Promise<SemanticMapUnit[]> {
  const units: SemanticMapUnit[] = []
  let carry = input.carry
  let offset = 0

  for (;;) {
    const digest = buildDigest(input.lines.slice(offset), config.digestBudget)
    if (digest.text.length === 0) break

    const labeled = await labeler.label({ digest: digest.text, truncated: digest.truncated, carry }, config)
    units.push(...labeled)
    carry = carryEcho(units, config)
    offset += digest.consumed

    if (!digest.truncated) break
  }

  return units
}

/**
 * Carry echo: labels of the most recently produced units, clipped to
 * `carryEchoTokens * 4` chars (tokens->chars heuristic), so the next chunk
 * knows where the previous one left off.
 */
export function carryEcho(units: readonly SemanticMapUnit[], config: SemanticMapConfig): string {
  const labels = units.slice(-3).map(unit => unit.label)
  return labels.join('\n').slice(0, config.carryEchoTokens * 4)
}
