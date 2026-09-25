/**
 * Build-time gate: every built dynamic client bundle (`lib/client.js`) may
 * require only specifiers the loader module table answers for it — the
 * platform baseline plus the package's own `dsh.client.external` requests.
 * Anything else is the build-time externals drift the runtime loader names
 * ("require(...) missed the module table"): the browser would throw at
 * materialization after a healthy deploy, so the failure must be caught here,
 * before the artifact is served.
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
/** Client-plane sources of the allowed set; loaded at runtime because
 *  `packages/client` is outside the host face's tsconfig program (TS6307 on a
 *  static import), while the gate itself runs under tsx/vitest loaders. */
interface ClientExternals {
  readonly requestedExternals: (packageName: string, dshClient: unknown) => readonly string[]
  readonly PLATFORM_MODULES: readonly string[]
  readonly PRELOADED_CLIENT_EXTERNALS: readonly string[]
}
let clientExternals: Promise<ClientExternals> | null = null

/** @returns the client-plane module-table sources, loaded once per process. */
async function loadClientExternals(): Promise<ClientExternals> {
  clientExternals ??= (async () => {
    // specifiers are built at runtime so the host tsc program never has to
    // include the client-plane sources; tsx and vitest resolve the .ts imports
    const [tsdown, platform] = await Promise.all([
      import(new URL('../packages/client/tsdown.client.ts', import.meta.url).href) as unknown as Promise<ClientExternals>,
      import(new URL('../packages/client/web/src/platform.ts', import.meta.url).href) as unknown as Promise<ClientExternals>,
    ])
    return { ...platform, requestedExternals: tsdown.requestedExternals }
  })()
  return clientExternals
}

const GATE = 'verify-client-bundle-externals'

/** One unanswerable require: the specifier plus the artifact that carries it. */
export interface BundleExternalViolation {
  /** Package name from the artifact's manifest. */
  readonly packageName: string
  /** Artifact-relative path, repository-root based. */
  readonly artifact: string
  /** The bare specifier a `require()` in the bundle asks for. */
  readonly specifier: string
}

/** Static `require("<specifier>")` / `require('<specifier>')` calls in a CJS factory bundle. */
const REQUIRE_SPECIFIER = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g

/**
 * A bare npm specifier: letters/digits/`@` first, then package-name characters.
 * Rejects template-literal fragments the bundle carries inside error-message
 * strings (for example `require("${spec}")` in the loader's own diagnostics),
 * which are text, not calls.
 */
const BARE_SPECIFIER = /^[A-Za-z0-9@][A-Za-z0-9@/._-]*$/

/** Node builtins tsdown leaves external on the browser platform by design;
 *  dual-environment code (pdf.js-style) keeps them in unreachable branches. */
const NODE_BUILTINS = new Set(
  builtinModules.flatMap(name => [name, `node:${name}`]),
)

/** Whether the require sits in a comment: bundled dependencies document themselves with `* const pm = require('pkg')` examples. */
function isCommentContext(linePrefix: string): boolean {
  const trimmed = linePrefix.trim()
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')
}

/** Whether a specifier resolves inside the bundle itself (relative artifacts are bundled by construction). */
function isRelative(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/')
}

/** The module-table request set one package's factory may answer against. */
type ClientManifest = { dsh?: { client?: { external?: unknown } } }

async function allowedSpecifiers(packageName: string, manifest: ClientManifest): Promise<ReadonlySet<string>> {
  const { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS, requestedExternals } = await loadClientExternals()
  return new Set([
    ...PLATFORM_MODULES,
    ...PRELOADED_CLIENT_EXTERNALS,
    ...requestedExternals(packageName, manifest.dsh?.client ?? {}),
  ])
}

/**
 * Scan one built client bundle.
 * @param packageName - package name the manifest declares.
 * @param artifactPath - absolute path to the built `lib/client.js`.
 * @param root - repository root, used for violation diagnostics.
 * @returns the unanswerable specifiers found, empty when the bundle is clean.
 */
export async function collectArtifactViolations(
  packageName: string,
  artifactPath: string,
  root: string,
): Promise<readonly BundleExternalViolation[]> {
  let manifest: { name?: string; dsh?: { client?: { external?: unknown } } }
  const manifestPath = join(artifactPath, '..', '..', 'package.json')
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
  } catch (error) {
    throw new Error(
      `${GATE}: ${packageName ?? manifestPath} has no readable package.json next to lib/ (${String(error)})`,
    )
  }
  const name = manifest.name ?? packageName
  const allowed = await allowedSpecifiers(name, manifest)
  const source = readFileSync(artifactPath, 'utf8')
  const violations: BundleExternalViolation[] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(REQUIRE_SPECIFIER)) {
    const specifier = match[2]
    const matchIndex = match.index
    if (specifier === undefined || matchIndex === undefined) continue
    if (seen.has(specifier) || isRelative(specifier) || allowed.has(specifier)) continue
    if (!BARE_SPECIFIER.test(specifier) || NODE_BUILTINS.has(specifier)) continue
    const lineStart = source.lastIndexOf('\n', matchIndex) + 1
    if (isCommentContext(source.slice(lineStart, match.index))) continue
    seen.add(specifier)
    violations.push({
      packageName: name,
      artifact: artifactPath.slice(root.length + 1),
      specifier,
    })
  }
  return violations
}

/**
 * Scan every built client bundle in the repository.
 * @param root - repository root whose packages hold built `lib/client.js` artifacts.
 * @returns all unanswerable specifiers across the built bundles, sorted.
 */
export async function collectClientBundleViolations(root: string): Promise<readonly BundleExternalViolation[]> {
  const violations: BundleExternalViolation[] = []
  for (const artifact of globSync('packages/*/*/lib/client.js', { cwd: root }).sort()) {
    const artifactPath = resolve(root, artifact)
    const packageName = artifact.split('/').at(-3)
    if (packageName === undefined) continue
    violations.push(...(await collectArtifactViolations(packageName, artifactPath, root)))
  }
  return violations
}

/** CLI entry: exit 1 listing every violation, silent clean pass prints one summary line. */
async function main(): Promise<void> {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const violations = await collectClientBundleViolations(root)
  if (violations.length > 0) {
    const lines = violations.map(violation =>
      `${violation.artifact}: require("${violation.specifier}") is not in ${violation.packageName}'s module-table requests`,
    )
    throw new Error(`${GATE}: ${lines.length} unanswerable require(s) in built client bundles\n${lines.join('\n')}`)
  }
  console.log(`${GATE}: all built client bundles require only answerable module-table specifiers`)
}

if (import.meta.main) await main()
