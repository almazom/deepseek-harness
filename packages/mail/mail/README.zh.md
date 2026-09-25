---
description: "DeepSeek Harness 的出站邮件：一个由 Config 选择的 seam（console 或 SMTP）、带护栏的信件，以及 agent 可调用的 CLI 与 MCP 入口。"
kind: "package-library"
---

# @deepseek-ai/dsh-mail

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-mail` 为 harness 提供唯一的发信方式。调用方描述一封信；seam 校验收件人与发件身份，应用护栏栈（速率限制、发送日志、审计链），序列化 MIME（纯文本部分，可选 HTML 部分），然后交给 transport。transport 只由配置决定——默认 `console`，它只打印信件而不发送；配置成 `smtp` 时，用 harness 凭据库中的凭据投递给中继。因此同一次调用在笔记本上安全，在家庭服务器上真实生效。

状态存放在 `$DSH_HOME/mail/`（`$DSH_HOME` 默认为 `~/.dsh`）：`send-log.jsonl`（收件人哈希化，不含正文）、`rate-state.json`、`audit.log`（哈希链）和 `recipient-salt`。本包提供 CLI（`mail-send`、`mail-preview`、`mail-status`、`mail-accept`）、带四个工具的 MCP 服务器（`mail-mcp`），以及供其他包使用的库 API。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

当 harness 中有什么需要发信时使用本包：魔法链接信件、夜间报告、验收探针。请通过 seam 发送，而不要自己直接说 SMTP，因为身份、策略、速率限制与审计都在 seam 里——第二条发送路径会绕开全部四项。

### 由 agent 发送

注册 MCP 服务器，然后调用它的工具。服务器通过 stdio 说 JSON-RPC，暴露 `send_email`、`send_batch`（最多 50 封）、`render_template` 和 `delivery_status`；每次工具调用都走同一个 seam，因此模型发起的发送同样受限制与审计约束。

```bash
mail-mcp            # stdio MCP server; register it in the harness MCP config
```

### 从 shell 发送

```bash
mail-send --to someone@example.com --subject "Nightly report" --body-file report.txt --json
mail-send --template invite --locale ru --var name=Тимур --var link=https://example.test/i/1 --var expiresMinutes=10 --to timur@example.com
mail-preview --template invite --locale ru --out /tmp/invite-ru.html --style
mail-status --json
mail-accept --dry-run
```

退出码是契约的一部分：`0` 已发送（或 dry run 通过），`2` 被拒绝——JSON 错误会说明原因——`3` 用法错误。拒绝是数据，从不崩溃：`mail-send` 打印 `{"ok":false,"error":{"code":...}}` 并以 2 退出。

### 配置

所有开关都是 `resolveConfig` 读取的环境变量：`MSH_TRANSPORT`（`console` 或 `smtp`）、`MSH_FROM`、`MSH_IDENTITIES`、`MSH_CREDENTIALS`、`MSH_LOG`、`MSH_STATE`、`MSH_DATA_DIR`、`MSH_ALLOW`、`MSH_DENY`、`MSH_MAX_PER_DAY`、`MSH_MAX_PER_HOUR`，以及附件上限 `MSH_MAX_ATTACHMENTS`、`MSH_MAX_ATTACHMENT_BYTES`、`MSH_MAX_ATTACHMENT_TOTAL_BYTES`。SMTP 凭据来自 `$DSH_HOME/.credentials.yaml`（0600 权限）中的 `smtp/mail-relay` 记录，或用 `MSH_SMTP_HOST`/`MSH_SMTP_PORT`/`MSH_SMTP_USER`/`MSH_SMTP_PASS` 做一次性运行。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

seam 就是一个函数。`createMailer(config, options)` 返回一个 `Mailer`，它的 `send(request)` 依次执行五步：装配（`assembleLetter`——收件人格式、发件身份对照名单、主题格式、保留头、附件上限、收件人策略）、护栏（每个 guard 的 `beforeSend`，因此速率限制会在任何其他动作之前拒绝）、序列化（`renderLetter`——RFC 2047 头部、multipart/alternative、带附件的 multipart/mixed、`Message-ID`）、transport（`ConsoleTransport` 打印；`SmtpTransport` 打开 `node:net`/`node:tls`，465 端口用隐式 TLS，否则 STARTTLS，AUTH LOGIN 并以 PLAIN 兜底），以及收尾钩子（每个 guard 的 `afterSend` 写入日志行与审计条目）。失败会短路为结构化的 `SendFailure`，而护栏仍会通过 `onRefusal` 看到它。

护栏栈是固定的，两个宿主入口共用：`RateLimiter`（滚动窗口——每分钟、每小时、每天、每收件人每天、每小时首次联系人、批量收件人上限；窗口从不重置，因此回拨时钟也无法开出一个免费窗口）、`SendLog`（收件人哈希化的 JSONL 行，5 MiB 或 30 天轮转，带去重窗口的失败告警，以及 DMARC 报告解析）和 `AuditLog`（对 `sha256(prev + canonicalJson(payload))` 的哈希链，`verifyAuditChain` 可重新走一遍）。

模板以数据形式放在 `templates.ts`：四个 id（`invite`、`access-recovery`、`nightly-report`、`test-letter`），每个都有 `ru` 与 `en`，且占位符集合相同。`verifyTemplateParity` 会在缺少某个语言、缺少或多出某个键、正文未翻译或正文为空时失败，`generateMailI18nReport` 打印 `verify-i18n-mail` 门禁消费的 `PASS`/`FAIL` 行。HTML 信件把每个样式都内联；`<style>` 块只出现在本地预览中，因此发出的信件没有 `<style>` 标签，纯文本部分由同一模板生成。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

运行 `mail-accept` 可得到内置验收表：它覆盖模板一致性、HTML 内联、console 发送、身份伪造、策略、速率限制、附件护栏、日志行、审计链、MCP 工具面、脚本化 SMTP 会话与 dry-run 纯净性，然后每个检查打印一行 PASS/FAIL。

<a id="model-experience"></a>
## Model Experience

#### What the model sees

注册 `mail-mcp` 服务器后，模型看到四个带 JSON schema 的工具：`send_email`、`send_batch`、`render_template` 和 `delivery_status`。被拒绝的发送作为工具输出返回，而不是 transport 错误，因此模型读到 `{"ok":false,"error":{"code":"rate_limited","scope":"per-hour","retryAfterSeconds":900}}`，可以解释或等待。模型永远看不到 SMTP 凭据；seam 在服务端解析它们。

#### Token effect

工具面是注册该服务器的会话一次付清的固定成本：四个工具定义及其 schema，约 600 token。单次调用只增加它发送的参数——主题与正文——被拒绝时增加一个简短的结构化错误。邮件传输的任何内容都不会流进上下文。

#### KV Cache effect

工具定义是静态的，因此它们留在缓存的提示前缀里，不会在轮次之间使其失效。发信不会在调用方自己的工具调用与结果之外追加模型可见的历史，本包也不注入任何自己的按次上下文。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- 出站路径是单向的。入站邮件、轮询退信的 IMAP，以及读取邮箱都在范围之外；退信通过 `recordBounce` 或 DMARC 报告目录进入日志。
- 随附的中继配置是变体 A：复用已有的外部中继，因此 `From` 身份受限于该提供方的邮箱。要从 harness 自己的域名发信需要变体 B（自建 MTA 并配置 SPF、DKIM、DMARC 与 PTR），另行跟踪。
- `rate-state.json` 假定单写入进程。两个进程同时发送可能丢计数；该文件没有锁。
- 发送日志默认把收件人藏在加盐哈希之后；`exposeAddresses` 可为仅本地的 0600 日志关闭它。按设计，没有任何东西能把哈希后的收件人还原。
- DMARC 摘要只覆盖你指向的聚合 XML 报告。它不会从 `rua` 邮箱抓取报告，且在测试时不联系任何外部提供方。
- 本包不依赖 harness 运行时，也尚未接线为宿主服务：MCP 注册与夜间报告调用方是运维任务。

<a id="dev-note"></a>
## Dev Note

```bash
pnpm --filter @deepseek-ai/dsh-mail test          # vitest: 11 spec files, one per capability
pnpm run verify-i18n-mail                         # template parity gate
./node_modules/.bin/tsx packages/mail/mail/src/cli.ts accept   # acceptance table
```

transport 可注入（`createMailer(config, {transports, dialer})`），SMTP 测试正是借此在本地 `node:net` 对端上跑真实 ESMTP 会话，而无需网络。
