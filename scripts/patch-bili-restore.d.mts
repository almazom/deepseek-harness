export declare const DEFAULT_TARGET: string
export declare const FN_NAME: string
export declare const HELPER_NAME: string
export declare const MARKER: string
export declare const ORIGINAL_TEXT: string
export declare const PATCHED_TEXT: string
export interface LocatedFunction { start: number; end: number; text: string }
export declare function sha256(text: string): string
export declare function locateFunction(src: string, name: string): LocatedFunction | null
export declare function countOccurrences(src: string, needle: string): number
export type PatchState = 'original' | 'patched' | 'missing'
export declare function detectState(src: string): { state: PatchState; fn: LocatedFunction | null }
export type PatchResult = { ok: true; changed: boolean; source: string } | { ok: false; reason: string }
export declare function applyPatch(src: string): PatchResult
export declare function revertPatch(src: string): PatchResult
