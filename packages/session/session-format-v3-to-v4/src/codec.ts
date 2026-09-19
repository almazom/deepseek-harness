/** Frozen physical JSON codec for released V4: released-V3 rows under a widened header origin. */

import {
  SessionFormatError,
  sessionFormatCount,
  snapshotSessionFormatJson,
} from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatArtifactDecoder,
  SessionFormatCodec,
  SessionFormatCurrentEncoder,
  SessionFormatEvent,
  SessionFormatHeader,
  SessionFormatJsonObject,
  SessionFormatJsonValue,
  SessionFormatRecovery,
} from '@deepseek-ai/dsh-session-format'
import { releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV4Header } from './validation.ts'

/** Frozen physical JSON codec for released v4. */
export const releasedV4SessionFormatCodec = Object.freeze({
  version: 4,
  decodeHeader(value: unknown) {
    return decodePhysicalHeader(value)
  },
  createDecoder(headerValue: unknown, recovery: SessionFormatRecovery) {
    return createDecoder(headerValue, recovery)
  },
  encodeHeader(header: SessionFormatHeader, inheritedEventCount: number) {
    return encodeHeader(header, inheritedEventCount)
  },
  encodeEvent(event: SessionFormatEvent) {
    return releasedV3SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

function decodePhysicalHeader(value: unknown): SessionFormatHeader {
  const snapshot = snapshotSessionFormatJson(value, 'released v4 physical header')
  const record = jsonRecord(snapshot, 'released v4 physical header')
  if (record['type'] !== 'session' || record['version'] !== 4) {
    throw new SessionFormatError('expected released v4 physical Session header')
  }
  const origin = record['origin']
  if (origin !== undefined && origin !== 'subagent' && origin !== 'headless') {
    throw new SessionFormatError('released v4 header origin must be "subagent" or "headless"')
  }
  // Released v3 owns every other physical field; released validators are frozen,
  // so the borrowed decode under the placeholder origin is deterministic. The v4
  // result keeps the decoded fields and restores the real origin and version.
  const borrowed = releasedV3SessionFormatCodec.decodeHeader({
    ...record,
    version: 3,
    ...(origin === undefined ? {} : { origin: 'subagent' }),
  })
  const header = { ...borrowed, version: 4, ...(origin === undefined ? {} : { origin }) } as SessionFormatHeader
  assertReleasedV4Header(header)
  return header
}

function createDecoder(headerValue: unknown, recovery: SessionFormatRecovery): SessionFormatArtifactDecoder {
  const header = decodePhysicalHeader(headerValue)
  // Released-v3 row admission, canonical validation, and end-seed cut tracking
  // never read the header beyond its seed state, which this seed carries verbatim.
  const decoder = releasedV3SessionFormatCodec.createDecoder({
    type: 'session',
    version: 3,
    id: header.id,
    createdAt: header.createdAt,
    isSeeded: header.isSeeded,
    delegationDepth: header.delegationDepth,
  }, recovery)
  return {
    header,
    decodeRow(value: unknown, context: Parameters<SessionFormatArtifactDecoder['decodeRow']>[1]): void {
      decoder.decodeRow(value, context)
    },
    finish(context: Parameters<SessionFormatArtifactDecoder['finish']>[0]): number {
      return decoder.finish(context)
    },
  }
}

function encodeHeader(header: SessionFormatHeader, inheritedEventCount: number): SessionFormatJsonObject {
  assertReleasedV4Header(header)
  const cut = sessionFormatCount(inheritedEventCount, 'format v4 inherited event count')
  if (!header.isSeeded && cut !== 0) {
    throw new SessionFormatError('unseeded format v4 Session has inherited events')
  }
  return {
    type: 'session',
    version: 4,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
    isSeeded: header.isSeeded,
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    delegationDepth: header.delegationDepth,
    ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
  }
}

function jsonRecord(value: SessionFormatJsonValue | undefined, label: string): SessionFormatJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionFormatError(`${label} must be an object`)
  }
  return value as SessionFormatJsonObject
}
