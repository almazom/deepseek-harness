/**
 * A small SMTP submission client, built on `node:net` and `node:tls`.
 *
 * The family server needs exactly one capability — hand an already-serialized
 * letter to one authenticated relay — so this module implements that path and
 * nothing else: greeting, EHLO, optional STARTTLS, AUTH LOGIN/PLAIN, MAIL
 * FROM, RCPT TO, DATA, QUIT. Anything a full MTA does before that (queues,
 * retries, aliases, routing) is deliberately absent, because retries belong to
 * the caller and the queue belongs to the relay.
 *
 * The transport is dialable through {@link SmtpDialer} so tests drive a
 * scripted conversation without a network.
 * @module @deepseek-ai/dsh-mail/smtp
 */

import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'

/** One complete SMTP reply. */
export interface SmtpResponse {
  /** The three-digit reply code. */
  readonly code: number
  /** Every line of the reply, including multi-line continuations. */
  readonly lines: readonly string[]
}

/** A transport-level failure carrying the SMTP code that caused it. */
export class SmtpError extends Error {
  /** The reply code, when the failure came from a server reply. */
  readonly code: number | undefined

  /**
   * @param message - human-readable description; never contains credentials.
   * @param code - the SMTP reply code, when there was one.
   */
  constructor(message: string, code?: number) {
    super(message)
    this.name = 'SmtpError'
    this.code = code
  }
}

/** A parsed reply stream over an ordered byte stream. */
export class SmtpResponseStream {
  #buffer = ''
  #lines: string[] = []
  #queue: SmtpResponse[] = []
  #waiting: Array<{ resolve: (response: SmtpResponse) => void; reject: (error: Error) => void }> = []
  #failure: Error | undefined

  /**
   * Feed received text into the parser, settling whichever replies completed.
   * @param chunk - decoded text from the socket.
   */
  push(chunk: string): void {
    this.#buffer += chunk
    for (;;) {
      const newline = this.#buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(newline + 1)
      this.#consumeLine(line)
    }
  }

  /**
   * Fail every waiting and future read; a broken socket never resolves.
   * @param error - the failure.
   */
  fail(error: Error): void {
    this.#failure = error
    const waiting = this.#waiting
    this.#waiting = []
    for (const waiter of waiting) waiter.reject(error)
  }

  /**
   * Await the next complete reply.
   * @returns the reply.
   * @throws the failure recorded by {@link fail}.
   */
  next(): Promise<SmtpResponse> {
    const queued = this.#queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.#failure !== undefined) return Promise.reject(this.#failure)
    return new Promise<SmtpResponse>((resolve, reject) => {
      this.#waiting.push({ resolve, reject })
    })
  }

  /**
   * Route one line into the in-flight reply.
   * @param line - the line, without its terminator.
   */
  #consumeLine(line: string): void {
    const match = /^(\d{3})([ -])(.*)$/.exec(line)
    this.#lines.push(line)
    if (match === null) return
    if (match[2] === '-') return
    const response: SmtpResponse = { code: Number.parseInt(match[1] ?? '0', 10), lines: this.#lines }
    this.#lines = []
    const waiter = this.#waiting.shift()
    if (waiter === undefined) this.#queue.push(response)
    else waiter.resolve(response)
  }
}

/** One live connection, abstract enough for tests to fake. */
export interface SmtpLink {
  /** The reply stream of this connection. */
  readonly stream: SmtpResponseStream
  /** Whether the connection is already protected by TLS. */
  readonly tls: boolean
  /**
   * Write raw SMTP text; callers include the CRLF terminator.
   * @param text - the text to send.
   */
  write(text: string): void
  /**
   * Negotiate TLS on an existing plaintext connection (STARTTLS).
   * @param servername - the name to validate the certificate against.
   * @returns the protected link.
   */
  upgrade(servername: string): Promise<SmtpLink>
  /** Close the connection, ignoring late failures. */
  close(): void
}

/** Opens connections; the seam a test replaces. */
export interface SmtpDialer {
  /**
   * Open a connection to the relay.
   * @param target - host, port, and whether TLS is implicit from the first byte.
   * @returns the link.
   */
  connect(target: {
    /** Relay hostname. */
    readonly host: string
    /** Submission port. */
    readonly port: number
    /** True for implicit TLS (465), false for plaintext-then-STARTTLS. */
    readonly implicitTls: boolean
    /** Timeout in milliseconds for connect and for every reply. */
    readonly timeoutMs: number
  }): Promise<SmtpLink>
}

/** Wire a stream-less socket into an {@link SmtpLink}. */
function linkFromSocket(socket: Socket | TLSSocket, tls: boolean, timeoutMs: number): SmtpLink {
  const stream = new SmtpResponseStream()
  socket.setEncoding('utf8')
  socket.setTimeout(timeoutMs, () => {
    stream.fail(new SmtpError(`smtp: timed out after ${timeoutMs}ms waiting for the relay`, undefined))
    socket.destroy()
  })
  socket.on('data', (chunk: string) => { stream.push(chunk) })
  socket.on('error', (error: Error) => { stream.fail(new SmtpError(`smtp: connection error: ${error.message}`)) })
  socket.on('close', () => { stream.fail(new SmtpError('smtp: connection closed by the relay')) })
  return {
    stream,
    tls,
    write: (text: string) => { socket.write(text) },
    upgrade: (servername: string) => new Promise<SmtpLink>((resolve, reject) => {
      const secured = tlsConnect({ socket, servername }, () => {
        resolve(linkFromSocket(secured, true, timeoutMs))
      })
      secured.once('error', (error: Error) => { reject(new SmtpError(`smtp: STARTTLS failed: ${error.message}`)) })
    }),
    close: () => { socket.end() },
  }
}

/** The dialer used in production. */
export const defaultDialer: SmtpDialer = {
  connect: ({ host, port, implicitTls, timeoutMs }) => new Promise<SmtpLink>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SmtpError(`smtp: connect to ${host}:${port} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onError = (error: Error): void => {
      clearTimeout(timer)
      reject(new SmtpError(`smtp: connect to ${host}:${port} failed: ${error.message}`))
    }
    if (implicitTls) {
      const socket = tlsConnect({ host, port, servername: host }, () => {
        clearTimeout(timer)
        socket.removeListener('error', onError)
        resolve(linkFromSocket(socket, true, timeoutMs))
      })
      socket.once('error', onError)
      return
    }
    const socket = netConnect({ host, port }, () => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      resolve(linkFromSocket(socket, false, timeoutMs))
    })
    socket.once('error', onError)
  }),
}

/** What the relay accepted. */
export interface SmtpDelivery {
  /** Recipients the relay accepted. */
  readonly accepted: readonly string[]
  /** Recipients the relay refused, with its reply. */
  readonly rejected: readonly { address: string; reply: string }[]
  /** Whether the conversation ended up protected by TLS. */
  readonly tls: boolean
  /** The final reply to the DATA command. */
  readonly reply: string
}

/** Everything one submission needs. */
export interface SmtpSubmission {
  /** Relay hostname. */
  readonly host: string
  /** Submission port. */
  readonly port: number
  /** Login name. */
  readonly user: string
  /** Password; never logged. */
  readonly password: string
  /** Envelope sender. */
  readonly from: string
  /** Envelope recipients. */
  readonly recipients: readonly string[]
  /** Serialized letter, already dot-stuffed. */
  readonly raw: string
  /** Timeout per step, in milliseconds. */
  readonly timeoutMs: number
  /** Reject the send unless TLS is active; required on public relays. */
  readonly requireTls: boolean
  /** Dialer override, for tests. */
  readonly dialer?: SmtpDialer
}

/**
 * Read one reply and assert its code.
 * @param stream - the reply stream.
 * @param allowed - acceptable reply codes.
 * @param step - the step name used in the error message.
 * @returns the reply.
 * @throws SmtpError when the code is not acceptable, or the read times out.
 */
async function expect(stream: SmtpResponseStream, allowed: readonly number[], step: string): Promise<SmtpResponse> {
  const response = await stream.next()
  if (!allowed.includes(response.code)) {
    throw new SmtpError(`smtp: ${step} rejected: ${response.lines.join(' / ')}`, response.code)
  }
  return response
}

/**
 * Extract an EHLO capability line, e.g. `AUTH LOGIN PLAIN`.
 * @param lines - the EHLO reply lines.
 * @param name - the capability name.
 * @returns the capability arguments, or `undefined` when not advertised.
 */
function capability(lines: readonly string[], name: string): string[] | undefined {
  for (const line of lines) {
    const trimmed = line.slice(4).trim()
    if (trimmed.toUpperCase().startsWith(name)) return trimmed.slice(name.length).trim().split(/\s+/).filter(Boolean)
  }
  return undefined
}

/**
 * Submit one letter to the relay.
 *
 * The conversation is strictly sequential and every step is asserted, so the
 * caller learns which step refused the letter. Nothing is retried here: a
 * retry is a new call, and because the Message-ID is generated at render time
 * a retry is visibly a new letter rather than a silent duplicate.
 * @param submission - relay, envelope, and the serialized letter.
 * @returns what the relay accepted.
 * @throws SmtpError when any step is refused.
 */
export async function sendViaSmtp(submission: SmtpSubmission): Promise<SmtpDelivery> {
  const dialer = submission.dialer ?? defaultDialer
  const implicitTls = submission.port === 465
  let link = await dialer.connect({
    host: submission.host,
    port: submission.port,
    implicitTls,
    timeoutMs: submission.timeoutMs,
  })
  try {
    await expect(link.stream, [220], 'greeting')
    let capabilities = await ehlo(link)
    if (!link.tls) {
      if (!capabilities.starttls) {
        if (submission.requireTls) {
          throw new SmtpError('smtp: relay does not advertise STARTTLS and requireTls is set')
        }
      } else {
        link.write('STARTTLS\r\n')
        await expect(link.stream, [220], 'STARTTLS')
        link = await link.upgrade(submission.host)
        capabilities = await ehlo(link)
      }
    }
    if (submission.requireTls && !link.tls) throw new SmtpError('smtp: refusing to send credentials over plaintext')
    await authenticate(link, capabilities.auth, submission.user, submission.password)
    link.write(`MAIL FROM:<${submission.from}>\r\n`)
    await expect(link.stream, [250], 'MAIL FROM')
    const accepted: string[] = []
    const rejected: { address: string; reply: string }[] = []
    for (const recipient of submission.recipients) {
      link.write(`RCPT TO:<${recipient}>\r\n`)
      const response = await link.stream.next()
      if (response.code === 250 || response.code === 251) accepted.push(recipient)
      else rejected.push({ address: recipient, reply: response.lines.join(' / ') })
    }
    if (accepted.length === 0) {
      throw new SmtpError(`smtp: every recipient was refused: ${rejected.map(entry => `${entry.address} (${entry.reply})`).join('; ')}`)
    }
    link.write('DATA\r\n')
    await expect(link.stream, [354], 'DATA')
    link.write(`${submission.raw}\r\n.\r\n`)
    const completed = await expect(link.stream, [250], 'end of DATA')
    link.write('QUIT\r\n')
    return { accepted, rejected, tls: link.tls, reply: completed.lines.join(' / ') }
  } finally {
    link.close()
  }
}

/** The EHLO capabilities this client cares about. */
interface Capabilities {
  /** True when the relay advertises STARTTLS. */
  readonly starttls: boolean
  /** The offered SASL mechanisms, when AUTH is advertised. */
  readonly auth: readonly string[]
}

/**
 * Send EHLO and read the capability set.
 * @param link - the live connection.
 * @returns the capabilities.
 */
async function ehlo(link: SmtpLink): Promise<Capabilities> {
  link.write('EHLO dsh-mail.local\r\n')
  const response = await expect(link.stream, [250], 'EHLO')
  return {
    starttls: capability(response.lines, 'STARTTLS') !== undefined,
    auth: capability(response.lines, 'AUTH') ?? [],
  }
}

/**
 * Authenticate with AUTH LOGIN (the mechanism Mail.ru offers), falling back to
 * AUTH PLAIN when the relay advertises it.
 * @param link - the live connection.
 * @param offered - mechanisms the relay advertised.
 * @param user - login name.
 * @param password - password.
 */
async function authenticate(link: SmtpLink, offered: readonly string[], user: string, password: string): Promise<void> {
  const mechanisms = offered.map(entry => entry.toUpperCase())
  if (mechanisms.includes('LOGIN')) {
    link.write('AUTH LOGIN\r\n')
    await expect(link.stream, [334], 'AUTH LOGIN')
    link.write(`${Buffer.from(user, 'utf8').toString('base64')}\r\n`)
    await expect(link.stream, [334], 'AUTH username')
    link.write(`${Buffer.from(password, 'utf8').toString('base64')}\r\n`)
    await expect(link.stream, [235], 'AUTH password')
    return
  }
  if (mechanisms.includes('PLAIN')) {
    link.write(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`, 'utf8').toString('base64')}\r\n`)
    await expect(link.stream, [235], 'AUTH PLAIN')
    return
  }
  throw new SmtpError('smtp: relay advertises no supported AUTH mechanism (LOGIN or PLAIN)')
}
