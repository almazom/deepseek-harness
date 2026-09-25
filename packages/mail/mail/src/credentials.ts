/**
 * Relay credential resolution: environment first, then the harness credentials
 * document (`$DSH_HOME/.credentials.yaml`).
 *
 * The layering mirrors `@deepseek-ai/dsh-credentials-local` — an explicit value
 * in the launching environment outranks the managed store, because the
 * environment is this run's stated intent. Only the record the family server
 * owns (`smtp/mail-relay`, a `grant` carrying a JSON payload) and the flat
 * `refs:` names are read; nothing else in the document is interpreted, and no
 * secret ever reaches a diagnostic.
 *
 * The document reader is deliberately a scalar-only YAML subset: mapping keys,
 * nested mappings, and scalar leaves. Anchors, block scalars, and multi-line
 * strings are NOT supported, which is why a `grant` payload holding only
 * scalars is the supported shape.
 * @module @deepseek-ai/dsh-mail/credentials
 */

import { readFile } from 'node:fs/promises'
import type { CredentialLoad, SmtpCredentials } from './types.ts'

/** Default record key inside the credentials document. */
export const DEFAULT_RECORD_KEY = 'smtp/mail-relay'

/** Default submission port used when neither layer names one. */
export const DEFAULT_SMTP_PORT = 465

/** One parsed credentials document, reduced to what this package consumes. */
export interface CredentialsDocument {
  /** Flat reference entries (`refs:` section). */
  readonly refs: ReadonlyMap<string, string>
  /** Record payloads and scalar fields, keyed by record name. */
  readonly records: ReadonlyMap<string, ReadonlyMap<string, string>>
}

/** A frame of the indentation stack while walking the document. */
interface Frame {
  readonly indent: number
  readonly key: string
}

/**
 * Count leading spaces; tabs are not indentation this document uses.
 * @param line - one raw line.
 * @returns the number of leading spaces.
 */
function indentOf(line: string): number {
  let count = 0
  while (count < line.length && line[count] === ' ') count += 1
  return count
}

/**
 * Split one `key: value` line into its key and optional scalar value.
 * @param body - the line without its indentation.
 * @returns the key and the raw scalar text, or `undefined` for a nested key.
 */
function splitEntry(body: string): { key: string; value: string | undefined } | undefined {
  const colon = body.indexOf(':')
  if (colon <= 0) return undefined
  const key = body.slice(0, colon).trim()
  if (key.length === 0) return undefined
  const raw = body.slice(colon + 1).trim()
  return { key, value: raw.length === 0 ? undefined : raw }
}

/**
 * Unquote one scalar, undoing the escapes a YAML emitter applies inside double
 * quotes. Bare scalars are returned as written.
 * @param raw - the scalar text.
 * @returns the value.
 */
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    const inner = raw.slice(1, -1)
    return inner.replace(/\\(["\\/nrt])/g, (_all, escaped: string) => {
      switch (escaped) {
        case 'n': return '\n'
        case 'r': return '\r'
        case 't': return '\t'
        default: return escaped
      }
    })
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
  return raw
}

/**
 * Parse the scalar subset of a credentials document.
 * @param text - the document text.
 * @returns references and record fields, flattened by record name.
 */
export function parseCredentials(text: string): CredentialsDocument {
  const refs = new Map<string, string>()
  const records = new Map<string, Map<string, string>>()
  const stack: Frame[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.length === 0 || /^\s*#/.test(line)) continue
    const indent = indentOf(line)
    const body = line.slice(indent)
    const entry = splitEntry(body)
    if (entry === undefined) continue
    while (stack.length > 0 && indent <= (stack[stack.length - 1]?.indent ?? -1)) stack.pop()
    const path = stack.map(frame => frame.key)
    if (entry.value === undefined) {
      stack.push({ indent, key: entry.key })
      continue
    }
    const value = unquote(entry.value)
    if (path[0] === 'refs' && path.length === 1) {
      refs.set(entry.key, value)
      continue
    }
    if (path[0] === 'records' && path.length >= 2) {
      const recordName = path[1]
      if (recordName === undefined) continue
      const field = path.length === 2 ? entry.key : `${path.slice(2).join('.')}.${entry.key}`
      const bucket = records.get(recordName) ?? new Map<string, string>()
      bucket.set(field, value)
      records.set(recordName, bucket)
    }
  }
  return { refs, records }
}

/**
 * Read the credentials document, treating absence as an empty store.
 * @param path - absolute path of the document.
 * @returns the parsed document, or `undefined` when the file does not exist.
 * @throws when the file exists but cannot be read; a present document that
 * cannot be trusted is never silently treated as "no credentials".
 */
export async function readCredentialsDocument(path: string): Promise<CredentialsDocument | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return parseCredentials(text)
}

/** The environment names this module accepts, in precedence order. */
export interface SmtpEnvironment {
  /** `MSH_SMTP_HOST`, `MSH_SMTP_PORT`, `MSH_SMTP_USER`, `MSH_SMTP_PASS`, `MSH_CREDENTIAL_KEY`. */
  readonly [name: string]: string | undefined
}

/**
 * Assemble credentials from a partially known set.
 * @param host - relay host, when known.
 * @param port - submission port, when known.
 * @param user - login, when known.
 * @param password - password, when known.
 * @returns the credentials, or `undefined` while any required field is missing.
 */
function assemble(
  host: string | undefined,
  port: string | undefined,
  user: string | undefined,
  password: string | undefined,
): SmtpCredentials | undefined {
  if (host === undefined || user === undefined || password === undefined) return undefined
  const parsed = port === undefined ? DEFAULT_SMTP_PORT : Number.parseInt(port, 10)
  return {
    host,
    port: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SMTP_PORT,
    user,
    password,
  }
}

/**
 * Resolve relay credentials from the environment, then the credentials store.
 *
 * Environment variables beat the store field by field: a deployment that sets
 * only `MSH_SMTP_PASS` overrides the stored password while still reading host,
 * port, and login from the document.
 * @param options - document path, record key, and environment.
 * @returns the credentials plus their source, or a problem phrased without secrets.
 */
export async function loadSmtpCredentials(options: {
  /** Absolute path of the credentials document. */
  readonly path: string
  /** Record name to consult; defaults to {@link DEFAULT_RECORD_KEY}. */
  readonly recordKey?: string
  /** Environment variables; defaults to `process.env`. */
  readonly env?: SmtpEnvironment
}): Promise<CredentialLoad> {
  const env = options.env ?? process.env
  let document: CredentialsDocument | undefined
  let readError: string | undefined
  try {
    document = await readCredentialsDocument(options.path)
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error)
  }
  const recordKey = env['MSH_CREDENTIAL_KEY'] ?? options.recordKey ?? DEFAULT_RECORD_KEY
  const record = document?.records.get(recordKey)
  const refs = document?.refs
  const stored = {
    host: record?.get('payload.host') ?? refs?.get('SMTP_HOST'),
    port: record?.get('payload.port') ?? refs?.get('SMTP_PORT'),
    user: record?.get('payload.user') ?? refs?.get('SMTP_USER'),
    password: record?.get('payload.pass') ?? refs?.get('SMTP_PASSWORD'),
  }

  const credentials = assemble(
    env['MSH_SMTP_HOST'] ?? stored.host,
    env['MSH_SMTP_PORT'] ?? stored.port,
    env['MSH_SMTP_USER'] ?? stored.user,
    env['MSH_SMTP_PASS'] ?? stored.password,
  )
  if (credentials !== undefined) {
    const fromEnv = env['MSH_SMTP_HOST'] !== undefined && env['MSH_SMTP_USER'] !== undefined
      && env['MSH_SMTP_PASS'] !== undefined
    return { credentials, source: fromEnv ? 'env' : 'store' }
  }
  if (readError !== undefined) {
    return { source: 'none', problem: `credentials document ${options.path} could not be read: ${readError}` }
  }
  if (document === undefined) {
    return { source: 'none', problem: `no credentials document at ${options.path}` }
  }
  return {
    source: 'none',
    problem: `no complete SMTP credential set in the environment or record "${recordKey}" of ${options.path}`,
  }
}
