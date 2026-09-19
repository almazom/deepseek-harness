/** Native V4 header validation; released-V3 event relationships remain authoritative. */

import { isAbsolute } from 'node:path'
import { SessionFormatError, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { restoreReleasedV3Artifact } from '@deepseek-ai/dsh-session-format-v2-to-v3'

const HEADER_REQUIRED = ['version', 'id', 'createdAt', 'isSeeded', 'delegationDepth'] as const
const HEADER_OPTIONAL = ['cwd', 'parentSession', 'origin', 'agentPreset'] as const

/**
 * Validate the exact logical header written by released v4: the released-v3
 * field set with `origin` opened to the headless value.
 * @param header - decoded v4 Session header.
 * @throws {SessionFormatError} when the header is not an exact released-v4 value.
 */
export function assertReleasedV4Header(header: SessionFormatHeader): void {
  const allowed = new Set<string>([...HEADER_REQUIRED, ...HEADER_OPTIONAL])
  const missing = HEADER_REQUIRED.find(key => !Object.hasOwn(header, key))
  if (missing !== undefined) throw new SessionFormatError(`format v4 header lacks ${missing}`)
  const unexpected = Object.keys(header).find(key => !allowed.has(key))
  if (unexpected !== undefined) throw new SessionFormatError(`format v4 header has unexpected field ${unexpected}`)
  if (header.version !== 4) throw new SessionFormatError('expected format v4 header')
  if (typeof header.id !== 'string') throw new SessionFormatError('format v4 header id must be a string')
  sessionFormatCount(header.createdAt, 'format v4 header createdAt')
  sessionFormatCount(header.delegationDepth, 'format v4 header delegationDepth')
  if (typeof header.isSeeded !== 'boolean') throw new SessionFormatError('format v4 header isSeeded must be boolean')
  if (header.cwd !== undefined && (typeof header.cwd !== 'string' || !isAbsolute(header.cwd))) {
    throw new SessionFormatError('format v4 header cwd must be absolute')
  }
  for (const key of ['parentSession', 'agentPreset'] as const) {
    if (header[key] !== undefined && typeof header[key] !== 'string') {
      throw new SessionFormatError(`format v4 header ${key} must be a string`)
    }
  }
  const origin: unknown = header.origin
  if (origin !== undefined && origin !== 'subagent' && origin !== 'headless') {
    throw new SessionFormatError('format v4 header origin must be "subagent" or "headless"')
  }
}

/**
 * Validate a detached v4 artifact with released-v3 event relationships.
 * The v4 header only widens `origin`, and v3 event validation never reads the
 * header beyond its own admission check, so the borrowed check runs under the
 * placeholder origin while the returned artifact keeps its v4 header unchanged.
 * @param artifact - detached v4 artifact.
 * @param knownEventTypes - event types understood by the installed Session package.
 * @returns the same validated artifact.
 */
export function restoreReleasedV4Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertReleasedV4Header(artifact.header)
  restoreReleasedV3Artifact({
    ...artifact,
    header: { ...artifact.header, version: 3, ...(artifact.header.origin === undefined ? {} : { origin: 'subagent' }) },
  }, knownEventTypes)
  return artifact
}
