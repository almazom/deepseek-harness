/**
 * Shared test scaffolding: temporary homes and a scripted SMTP peer.
 * @module @deepseek-ai/dsh-mail/tests/helpers
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/config.ts'
import type { MailConfig } from '../src/types.ts'

/**
 * Create a throwaway DSH home.
 * @param prefix - directory prefix.
 * @returns the directory path.
 */
export async function tempHome(prefix = 'msh-test-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

/**
 * Delete a throwaway home.
 * @param path - directory to remove.
 */
export async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

/**
 * Resolve a console-transport configuration rooted in a temp home.
 * @param home - the home directory.
 * @param overrides - per-test overrides.
 * @returns the configuration.
 */
export function testConfig(home: string, overrides: Partial<MailConfig> = {}): MailConfig {
  return { ...resolveConfig({ DSH_HOME: home }, home), transport: 'console', ...overrides }
}

/** A scripted SMTP server a test can talk to. */
export interface SmtpPeer {
  /** Port the peer listens on. */
  readonly port: number
  /** Every line the client sent. */
  readonly transcript: string[]
  /** Stop listening. */
  close(): Promise<void>
}

/**
 * Start a local SMTP peer that accepts one submission.
 * @param options - failure modes the test wants to exercise.
 * @returns the peer handle.
 */
export async function startSmtpPeer(
  options: { rejectRecipient?: boolean; rejectAddress?: string; failGreeting?: boolean } = {},
): Promise<SmtpPeer> {
  const transcript: string[] = []
  let authStep = 0
  let inData = false
  const server = createServer((socket) => {
    socket.write(options.failGreeting ? '421 service not available\r\n' : '220 peer.local ESMTP\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let index = buffer.indexOf('\r\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        index = buffer.indexOf('\r\n')
        transcript.push(line)
        if (inData) {
          if (line === '.') {
            inData = false
            socket.write('250 2.0.0 queued as PEER1\r\n')
          }
          continue
        }
        const command = line.toUpperCase()
        if (options.failGreeting) continue
        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250-peer.local\r\n250 AUTH LOGIN PLAIN\r\n')
        else if (command.startsWith('AUTH LOGIN')) { authStep = 1; socket.write('334 VXNlcm5hbWU6\r\n') }
        else if (authStep === 1) { authStep = 2; socket.write('334 UGFzc3dvcmQ6\r\n') }
        else if (authStep === 2) { authStep = 3; socket.write('235 2.7.0 authenticated\r\n') }
        else if (command.startsWith('MAIL FROM')) socket.write('250 2.1.0 ok\r\n')
        else if (command.startsWith('RCPT TO')) {
          const refused = options.rejectRecipient
            || (options.rejectAddress !== undefined && command.toLowerCase().includes(options.rejectAddress.toLowerCase()))
          socket.write(refused ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n')
        }
        else if (command.startsWith('DATA')) { inData = true; socket.write('354 end with <CRLF>.<CRLF>\r\n') }
        else if (command.startsWith('QUIT')) { socket.write('221 2.0.0 bye\r\n'); socket.end() }
        else socket.write('250 2.0.0 ok\r\n')
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    transcript,
    close: async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) },
  }
}
