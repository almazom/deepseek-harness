import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { MailMcpServer, MCP_TOOLS, MCP_TOOL_NAMES, runStdioServer } from '../src/mcp.ts'
import { createMailer } from '../src/seam.ts'
import { tempHome, testConfig } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

/**
 * Build a server over a console mailer.
 * @param home - temp home.
 * @returns the server.
 */
async function server(home: string): Promise<MailMcpServer> {
  const config = testConfig(home)
  return new MailMcpServer({ mailer: createMailer(config, { write: () => {} }), config })
}

describe('mcp', () => {
  it('answers initialize with a protocol version', async () => {
    const home = await tempHome(); homes.push(home)
    const response = await (await server(home)).handle({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const result = response?.result as { protocolVersion: string; serverInfo: { name: string } }
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.serverInfo.name).toBe('mail-mcp')
  })

  it('lists exactly the four tools with schemas', async () => {
    const home = await tempHome(); homes.push(home)
    const response = await (await server(home)).handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const result = response?.result as { tools: { name: string; inputSchema: unknown }[] }
    expect(result.tools.map(tool => tool.name)).toEqual([...MCP_TOOL_NAMES])
    expect(MCP_TOOLS.length).toBe(4)
    expect(result.tools.every(tool => tool.inputSchema !== undefined)).toBe(true)
  })

  it('sends a letter through send_email', async () => {
    const home = await tempHome(); homes.push(home)
    const response = await (await server(home)).handle({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'send_email', arguments: { to: ['timur@example.test'], subject: 'mcp', text: 'hello' } },
    })
    const result = response?.result as { content: { text: string }[]; isError?: boolean }
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text) as { ok: boolean; messageId: string }
    expect(payload.ok).toBe(true)
    expect(payload.messageId).toContain('@dsh-mail.local')
  })

  it('rejects an invalid send_email argument', async () => {
    const home = await tempHome(); homes.push(home)
    const response = await (await server(home)).handle({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'send_email', arguments: { to: ['a@b.test'], subject: 'x', text: '' } },
    })
    const result = response?.result as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it('renders a template without sending', async () => {
    const home = await tempHome(); homes.push(home)
    const response = await (await server(home)).handle({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'render_template', arguments: { template: 'test-letter', locale: 'en', variables: { stamp: 'now', transport: 'console' } } },
    })
    const result = response?.result as { content: { text: string }[] }
    const payload = JSON.parse(result.content[0].text) as { ok: boolean; subject: string }
    expect(payload.ok).toBe(true)
    expect(payload.subject.length).toBeGreaterThan(0)
  })

  it('returns delivery status and refuses unknown tools', async () => {
    const home = await tempHome(); homes.push(home)
    const instance = await server(home)
    const status = await instance.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'delivery_status', arguments: {} } })
    const statusResult = status?.result as { content: { text: string }[] }
    expect((JSON.parse(statusResult.content[0]?.text ?? '{}') as { ok?: boolean }).ok).toBe(true)
    const unknown = await instance.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope', arguments: {} } })
    expect((unknown?.result as { isError?: boolean }).isError).toBe(true)
  })

  it('frames stdio traffic line by line', async () => {
    const home = await tempHome(); homes.push(home)
    const lines: string[] = []
    const input = (async function * () {
      yield '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n'
      yield 'not json\n'
    })()
    await runStdioServer(await server(home), { input, output: (line) => { lines.push(line) } })
    const initialized = JSON.parse(lines[0] ?? '{}') as { result?: { protocolVersion?: string } }
    expect(initialized.result?.protocolVersion).toBe('2025-06-18')
    const parseError = JSON.parse(lines[1] ?? '{}') as { error?: { code?: number } }
    expect(parseError.error?.code).toBe(-32700)
  })
})
