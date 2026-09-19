/** Identity event migration into V4: only the header version and origin vocabulary change. */

import { SessionFormatError, defineSessionFormatMigration, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV3Header } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatJsonObject, SessionFormatMigrationContext, SessionFormatMigrationStage, SessionFormatMigrationStageInput } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from './validation.ts'

/** Re-emit every released-v3 event unchanged and stamp the target header version. */
export const sessionFormatV3ToV4 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v3-to-v4',
  fromVersion: 3,
  toVersion: 4,
  migrateHeader(header) {
    assertReleasedV3Header(header)
    return { ...header, version: 4 }
  },
  createStage(input) { return new ReleasedV3ToV4Stage(input) },
  validateTargetHeader: assertReleasedV4Header,
})

class ReleasedV3ToV4Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private expectedSeq = 0
  private sourceCut: number | undefined
  private targetCut: number | undefined
  private lastForeignDeliverySeq: number | undefined

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    assertReleasedV3Header(input.sourceHeader)
    this.sourceCut = input.sourceHeader.isSeeded ? undefined : 0
    this.targetCut = input.sourceHeader.isSeeded ? undefined : 0
    if (!input.sourceHeader.isSeeded) this.headerInheritedEventCount = 0
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.expectedSeq) throw new SessionFormatError('format v3 source events must be dense')
    const data = record(event.data, event.type)
    if (event.type === 'session/end-seed' && data['inherited'] === true) {
      if (!this.input.sourceHeader.isSeeded) throw new SessionFormatError('format v3 unseeded Session contains an inherited end-seed marker')
      this.sourceCut = event.seq
      this.targetCut = event.seq
    }
    if (event.type === 'session-log-deepseek/delivery-accepted') {
      if (data['sessionFormatVersion'] === 4) throw new SessionFormatError('format v3 delivery marker claims target format v4')
      if (data['sessionFormatVersion'] === 3 && data['sessionId'] !== this.input.sourceHeader.id) this.lastForeignDeliverySeq = event.seq
    }
    context.emitEvent(event)
    this.expectedSeq += 1
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(_context: SessionFormatMigrationContext): number {
    const cut = sessionFormatCount(this.sourceCut, 'format v3 inherited end-seed marker')
    if (this.input.sourceInheritedEventCount !== undefined && this.input.sourceInheritedEventCount !== cut) {
      throw new SessionFormatError('format v3 inherited end-seed marker disagrees with its source cut')
    }
    if (this.lastForeignDeliverySeq !== undefined
      && (this.input.sourceHeader.parentSession === undefined || this.lastForeignDeliverySeq >= cut)) {
      throw new SessionFormatError('current-generation delivery marker names the wrong Session')
    }
    return sessionFormatCount(this.targetCut, 'format v4 inherited event count')
  }
}

function record(value: unknown, label: string): SessionFormatJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionFormatError(`${label} data must be an object`)
  }
  return value as SessionFormatJsonObject
}
