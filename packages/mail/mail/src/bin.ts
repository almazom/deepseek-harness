/**
 * Command dispatch for the `mail-*` binaries.
 *
 * One committed entry point backs five installed names; the name decides the
 * CLI command, so `mail-send`, `mail-preview`, `mail-status`, `mail-accept`,
 * and `mail-mcp` share one implementation and one seam.
 * @module @deepseek-ai/dsh-mail/bin
 */

import { basename } from 'node:path'
import { runCli } from './cli.ts'
import { createServerFromEnv, runStdioServer } from './mcp.ts'

/** Maps an installed bin name to the command it runs. */
export const BIN_COMMANDS: Readonly<Record<string, string>> = {
  'mail-send': 'send',
  'mail-preview': 'preview',
  'mail-status': 'status',
  'mail-accept': 'accept',
  'mail-mcp': 'mcp',
}

/**
 * Resolve the command an installed name runs.
 * @param executable - `process.argv[1]` or a bare bin name.
 * @returns the command name, or undefined for an unknown name.
 */
export function binCommandFor(executable: string): string | undefined {
  return BIN_COMMANDS[basename(executable)]
}

/**
 * Run the entry point named by `executable`.
 * @param executable - the invoked path.
 * @param argv - arguments after the program name.
 * @returns the process exit code.
 */
export async function runBin(executable: string, argv: readonly string[] = []): Promise<number> {
  const command = binCommandFor(executable)
  if (command === undefined) {
    process.stderr.write(
      `mail: unknown entry point "${basename(executable)}" — expected one of ${Object.keys(BIN_COMMANDS).join(', ')}\n`,
    )
    return 3
  }
  if (command === 'mcp') {
    await runStdioServer(createServerFromEnv())
    return 0
  }
  return await runCli([command, ...argv])
}

// Invoked as a mail-* binary (directly or through its link); importable by tests.
const invoked = process.argv[1]
if (invoked !== undefined && binCommandFor(invoked) !== undefined) {
  process.exitCode = await runBin(invoked, process.argv.slice(2))
}
