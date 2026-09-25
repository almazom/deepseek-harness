/**
 * Outbound mail for DeepSeek Harness.
 *
 * The package owns one seam: callers describe a letter, the seam validates it,
 * guards it, serializes it, and hands it to a transport. The transport is
 * chosen from configuration (`console` by default, `smtp` when a relay is
 * provisioned), so the same call is safe on a developer machine and real on
 * the family server.
 * @module @deepseek-ai/dsh-mail
 */

export type {
  Attachment,
  CredentialLoad,
  CredentialSource,
  Letter,
  MailConfig,
  RateLimits,
  RecipientPolicy,
  SendErrorCode,
  SendFailure,
  SendOutcome,
  SendSuccess,
  SmtpCredentials,
  Transport,
} from './types.ts'

export { defaultLimits, defaultPolicy, parseTransport, resolveConfig, type MailEnvironment } from './config.ts'

export {
  DEFAULT_RECORD_KEY,
  DEFAULT_SMTP_PORT,
  loadSmtpCredentials,
  parseCredentials,
  readCredentialsDocument,
  type CredentialsDocument,
} from './credentials.ts'

export {
  describeAttachment,
  dotStuff,
  encodeHeaderValue,
  previewHeaders,
  renderLetter,
  type RenderedLetter,
} from './mime.ts'

export {
  defaultAttachmentLimits,
  validateAttachments,
  type AttachmentLimits,
} from './attachments.ts'

export {
  defaultDialer,
  sendViaSmtp,
  SmtpError,
  SmtpResponseStream,
  type SmtpDelivery,
  type SmtpDialer,
  type SmtpLink,
  type SmtpResponse,
  type SmtpSubmission,
} from './smtp.ts'

export {
  assembleLetter,
  checkPolicy,
  ConsoleTransport,
  createMailer,
  DEFAULT_SMTP_TIMEOUT_MS,
  isAddress,
  Mailer,
  matchesPattern,
  parseRecipients,
  SmtpTransport,
  type MailerOptions,
  type MailGuard,
  type MailTransport,
  type PreparedLetter,
  type RefusalContext,
  type SendRequest,
  type TransportContext,
} from './seam.ts'

export {
  buildGuards,
  limitsFromConfig,
  type GuardStackOptions,
} from './guards.ts'

export {
  checkLimits,
  defaultVolumeLimits,
  RateLimiter,
  readRateState,
  writeRateState,
  type RateLimiterOptions,
  type RateRecord,
  type RateState,
  type VolumeLimits,
} from './limits.ts'

export {
  appendSendLogRecord,
  ensureSalt,
  FailureAlerter,
  formatDmarcDigest,
  formatSendLogSummary,
  hashRecipient,
  openSendLog,
  parseDmarcReport,
  readDmarcReports,
  readSendLog,
  rotateSendLog,
  SendLog,
  summarizeSendLog,
  type DmarcRecord,
  type SendLogOptions,
  type SendLogRecord,
  type SendLogSummary,
} from './sendlog.ts'

export {
  auditHash,
  AuditLog,
  canonicalJson,
  defaultActor,
  readAuditLog,
  resolveSender,
  verifyAuditChain,
  type AuditEntry,
  type AuditEvent,
  type AuditLogOptions,
  type IdentityRoster,
} from './identity.ts'

export {
  generateMailI18nReport,
  mailTemplates,
  placeholders,
  renderTemplate,
  templateById,
  verifyTemplateParity,
  MAIL_LOCALES,
  type MailLocale,
  type MailTemplate,
  type TemplateContent,
  type TemplateParityProblem,
} from './templates.ts'

export {
  darkModeCss,
  escapeHtml,
  htmlToText,
  LETTER_WIDTH,
  renderHtmlLetter,
  renderThemedLetter,
  type CallToAction,
  type HtmlLetterInput,
  type ThemedLetter,
} from './html.ts'

export {
  completionScript,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_USAGE,
  helpText,
  main,
  parseArgv,
  runCli,
  type CliInvocation,
  type CliIo,
} from './cli.ts'

export {
  createServerFromEnv,
  MailMcpServer,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  runStdioServer,
  type JsonRpcRequest,
  type MailMcpServerOptions,
  type McpToolDefinition,
} from './mcp.ts'

export {
  formatAcceptanceTable,
  runAcceptance,
  type AcceptanceCheck,
  type AcceptanceLiveResult,
  type AcceptanceOptions,
  type AcceptanceResult,
} from './accept.ts'
