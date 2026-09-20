// Reusable behavioral-video recording for Playwright sessions (zero deps).
// Video via chromium recordVideo; the in-frame step banner is the alignment
// ground truth; events.json is the machine-readable step log. See SKILL.md.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BANNER_ID = 'pwr-step-banner';

export const BANNER_CSS = [
  'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
  'background:#111827', 'color:#4ade80',
  'font:600 13px/1.35 ui-monospace,Menlo,monospace',
  'padding:8px 12px', 'border-radius:8px',
  'box-shadow:0 4px 14px rgba(0,0,0,.35)', 'max-width:440px',
  'white-space:pre-wrap',
].join(';');

// Pure: self-evaluating DOM expression creating/updating the banner overlay.
export function stepBannerJs(label) {
  return `(() => {`
    + `const prev=document.getElementById(${JSON.stringify(BANNER_ID)});`
    + `const el=prev??document.createElement('div');`
    + `if(!prev){el.id=${JSON.stringify(BANNER_ID)};`
    + `el.style.cssText=${JSON.stringify(BANNER_CSS)};`
    + `(document.body??document.documentElement).appendChild(el);}`
    + `el.textContent=${JSON.stringify(String(label))};`
    + `})()`;
}

// Single definition of the skill's repo root: <repo>/.agents/skills/
// browser-video-record/scripts/ is exactly four levels below the checkout.
// CLI and examples import this instead of duplicating the walk-up heuristic.
export function resolveRepoRoot(importMetaUrl) {
  return fileURLToPath(new URL('../../../..', importMetaUrl));
}

// Resolve playwright from a repo checkout (root package.json first, then the
// apps/web workspace layout). Pass --repo / repoPath when the caller's
// checkout is not the skill's own repository.
export function resolvePlaywright(repoPath) {
  const root = resolve(repoPath);
  const entries = [join(root, 'package.json'), join(root, 'apps', 'web', 'package.json')];
  for (const entry of entries) {
    try {
      return createRequire(entry)('playwright');
    } catch { /* try the next layout; the error below names every attempt */ }
  }
  throw new Error(`playwright not resolvable from ${entries.join(' or ')} — pass --repo <checkout-with-playwright>`);
}

// Millisecond step log; t_video_ms is non-decreasing by construction.
export function createEventLog(t0 = Date.now()) {
  const events = [];
  return {
    events,
    push(step) { events.push({ t_video_ms: Date.now() - t0, step }); },
    save(file) { saveEventsAtomic(events, file); },
  };
}

// Temp-file + rename so a crash never leaves a truncated events.json that
// could be mistaken for this run's log (adversarial reliability optic).
function saveEventsAtomic(events, file) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(events, null, 2)}\n`);
  renameSync(tmp, file);
}

export async function showStep(page, label, log) {
  log.push(label);
  await page.evaluate(stepBannerJs(label));
}

// Owns the lifecycle traps: context.close() flushes the recording, saveAs
// must run after close and before browser.close, events flush last, and a
// throwing scenario still closes the context and propagates the error.
// Returns { videoPath, events } only on the success path; a scenario throw
// propagates after teardown and leaves no demo.webm/events.json (the raw
// staging file stays under runDir/videos/ for diagnosis).
export async function withVideoRecording(opts, scenario) {
  const { playwright, runDir, width = 1280, height = 800 } = opts ?? {};
  if (!playwright?.chromium) throw new TypeError('opts.playwright with chromium required');
  if (typeof scenario !== 'function') throw new TypeError('scenario must be async ({ page, step, log }) => {}');
  if (!runDir) throw new TypeError('opts.runDir required');
  const videosDir = join(runDir, 'videos');
  mkdirSync(videosDir, { recursive: true });
  const size = { width, height };
  const browser = await playwright.chromium.launch();
  const log = createEventLog();
  let context;
  try {
    context = await browser.newContext({ viewport: size, recordVideo: { dir: videosDir, size } });
    const page = await context.newPage();
    const video = page.video();
    await scenario({ page, log, step: (label) => showStep(page, label, log) });
    await context.close();
    const videoPath = join(runDir, 'demo.webm');
    await video.saveAs(videoPath);
    saveEventsAtomic(log.events, join(runDir, 'events.json'));
    return { videoPath, events: log.events };
  } finally {
    await context?.close().catch(() => {}); // already closed on the success path; guards the error path
    await browser.close();
  }
}

// Pure parser: first video stream of ffprobe JSON -> flat summary.
export function parseFfprobeJson(probe) {
  const stream = probe?.streams?.find((s) => s.codec_type === 'video');
  if (!stream) return null;
  const [num, den] = String(stream.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    codec: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    duration: Number(stream.duration ?? probe?.format?.duration ?? 0),
    fps: den ? num / den : null,
  };
}

// ffprobe -show_format -show_streams -> parseFfprobeJson.
export function ffprobeSummary(file) {
  const res = spawnSync('ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (res.error) {
    throw Object.assign(new Error(`ffprobe not runnable: ${res.error.message} — is ffmpeg installed?`), { code: 'MEDIA_TOOL_MISSING' });
  }
  if (res.status !== 0) {
    throw Object.assign(new Error(`ffprobe failed (${res.status}): ${String(res.stderr).trim()}`), { code: 'MEDIA_TOOL_FAILED' });
  }
  try {
    return parseFfprobeJson(JSON.parse(res.stdout));
  } catch (err) {
    throw Object.assign(new Error(`ffprobe produced unparseable output for ${file}: ${err.message}`), { code: 'MEDIA_TOOL_MALFORMED' });
  }
}
