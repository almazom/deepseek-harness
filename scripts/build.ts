/** Run the complete repository build and bind its client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  CLIENT_BUILD_PROFILE_SELECTOR,
  clientBuildProcessEnvironment,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { collectClientBundleViolations } from './verify-client-bundle-externals.ts'

/**
 * Fail the build before the web shell consumes the artifacts when a built
 * client bundle requires a specifier its module table cannot answer — the
 * boot failure class the loader can only report per-browser after a deploy.
 * @param root - repository root whose packages hold built `lib/client.js` artifacts.
 * @param after - build step label used in the failure message.
 */
async function verifyClientBundleExternals(root: string, after: string): Promise<void> {
  const violations = await collectClientBundleViolations(root)
  if (violations.length > 0) {
    const lines = violations.map(violation =>
      `${violation.artifact}: require("${violation.specifier}") is not in ${violation.packageName}'s module-table requests`,
    )
    throw new Error(`${after}: ${lines.length} unanswerable client-bundle require(s)\n${lines.join('\n')}`)
  }
}

/** Run one package script through the package manager that invoked this build. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const invocation = pnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Run the full build selected by `--profile` or `DSH_BUILD_CLIENT_PROFILE`. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { profile: { type: 'string' } },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const repositoryEnvironment = repositoryClientBuildEnvironment(root, process.env)
  const profile = values.profile ?? process.env[CLIENT_BUILD_PROFILE_SELECTOR]
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, profile)
  const buildEnvironment = clientBuildProcessEnvironment(process.env, clientEnvironment)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  runScript('build:native-system', buildEnvironment)
  runScript('build:lib', buildEnvironment)
  await verifyClientBundleExternals(root, 'build:lib')
  runScript('build:web', buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) main()
