import { z } from 'zod'

/**
 * Configuration for the semantic map refresh pipeline.
 *
 * `digestBudget` caps how many tokens of the session tail are turned into a
 * model digest per scan chunk; `carryEchoTokens` caps the echo of previously
 * sealed unit labels carried into the labeler; `timeoutMs` bounds one labeler
 * invocation.
 *
 * `.strict()` rejects unknown keys so a typo in cordis.yml fails loudly instead
 * of being silently ignored.
 */
export const SemanticMapConfig = z
  .object({
    digestBudget: z
      .number()
      .int()
      .positive()
      .default(6000),
    carryEchoTokens: z
      .number()
      .int()
      .positive()
      .default(300),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .default(60000),
  })
  .strict()
  .prefault({})

export type SemanticMapConfig = z.infer<typeof SemanticMapConfig>
/** Raw shape accepted before parsing (all fields optional — defaults fill them). */
export type SemanticMapConfigInput = z.input<typeof SemanticMapConfig>
