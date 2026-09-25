/** Tests for the built-client-bundle module-table externals gate. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectArtifactViolations } from './verify-client-bundle-externals.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function buildPackage(root: string, external: readonly string[] = []): string {
  const packageDir = join(root, 'packages', 'client', 'sample')
  const libDir = join(packageDir, 'lib')
  mkdirSync(libDir, { recursive: true })
  const externalField = external.length > 0 ? `,"external": [${external.map(name => JSON.stringify(name)).join(',')}]` : ''
  writeFileSync(
    join(packageDir, 'package.json'),
    `{"name": "@deepseek-ai/dsh-sample", "dsh": {"client": {"inject": [], "platform": "web"${externalField}}}}`,
  )
  return join(libDir, 'client.js')
}

function scan(root: string, bundleSource: string, external: readonly string[] = []): readonly string[] {
  const artifact = buildPackage(root, external)
  writeFileSync(artifact, bundleSource)
  return collectArtifactViolations('@deepseek-ai/dsh-sample', artifact, root).map(violation => violation.specifier)
}

describe('collectArtifactViolations', () => {
  it('rejects an unrequested npm require — the served-boot-failure class', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-externals-'))
    roots.push(root)
    expect(scan(root, 'let zod = require("zod");\n')).toEqual(['zod'])
  })

  it('accepts a specifier the package declares in dsh.client.external', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-externals-'))
    roots.push(root)
    expect(scan(root, 'let x = require("left-pad");\n', ['left-pad'])).toEqual([])
  })

  it('accepts platform modules and relative artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-externals-'))
    roots.push(root)
    expect(scan(root, 'let a = require("@deepseek-ai/cordis");\nlet b = require("./chunk.js");\n')).toEqual([])
  })

  it('ignores require-shaped text inside comments and template strings', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-externals-'))
    roots.push(root)
    expect(scan(root, '\t* const pm = require("picomatch");\n\tthrow new Error(`require("${spec}") missed`);\n')).toEqual([])
  })

  it('ignores node builtins tsdown leaves external by design', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-externals-'))
    roots.push(root)
    expect(scan(root, 'let u = require("url");\nlet f = require("node:fs");\n')).toEqual([])
  })

  it('fails loud when the manifest next to lib/ is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-externals-'))
    roots.push(root)
    const libDir = join(root, 'packages', 'client', 'sample', 'lib')
    mkdirSync(libDir, { recursive: true })
    expect(() => collectArtifactViolations('@deepseek-ai/dsh-sample', join(libDir, 'client.js'), root))
      .toThrowError(/no readable package\.json/)
  })
})
