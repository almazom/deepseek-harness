---
name: browser-video-record
description: Record annotated behavioral videos of any Playwright-driven browser session — audits, e2e runs, UI checks — as continuous webm plus converted mp4, with an in-frame step banner and a machine-readable events.json log, instead of or alongside static screenshots; also inspect recordings (ffprobe info) and sample frames locally. Triggers: "record browser video", "behavioral record", "video of the test run", "annotated recording", "pw-video", "запиши видео теста", "видео сессии браузера", "поведенческая запись". Use whenever browser testing should leave a continuous visual record; pair with record-browser-gif for PR demo GIFs and with qmm-quota-router / qwen-mm skills for VLM analysis of the recording.
---

# Browser Video Record

Video is the behavioral record: it captures typing, hovers, animations, scroll
and state transitions that static screenshots cannot show between states.
A screenshot is a state; the video is the path. The alignment ground truth is
INSIDE the recording: every step paints a banner overlay into the frame, and
the same steps go to `events.json` with millisecond timestamps.

## Quick start (CLI)

```sh
node .agents/skills/browser-video-record/scripts/pw-video.mjs run \
  .agents/skills/browser-video-record/examples/demo-scenario.mjs \
  --out .playwright-mcp/video-runs/my-run
node .agents/skills/browser-video-record/scripts/pw-video.mjs info \
  .playwright-mcp/video-runs/my-run/demo.webm
node .agents/skills/browser-video-record/scripts/pw-video.mjs frames \
  .playwright-mcp/video-runs/my-run/demo.webm .playwright-mcp/video-runs/my-run/frames --fps 1
```

Exit codes: `0` ok, `2` usage error, `3` media tool or input missing, `1` runtime error.

## Embed into an existing script (library form)

```js
import { resolvePlaywright, withVideoRecording } from './scripts/video-context.mjs';

const playwright = resolvePlaywright(repoRoot); // <checkout>/apps/web/package.json
const { videoPath, events } = await withVideoRecording(
  { playwright, runDir, width: 1280, height: 800 },
  async ({ page, step }) => {
    await page.goto(url);
    await step('ШАГ 1: открыта страница');
    // ...действия; каждый шаг -> step('ШАГ N: что делаем')
  },
);
```

`withVideoRecording` owns the ordering traps: `context.close()` before
`video.saveAs()`, `saveAs` before `browser.close()`, events flush, and the
error path (scenario throw still closes the context and propagates).

## What a run produces

- `demo.webm` — VP8 recording, viewport-sized (set `recordVideo.size`; without it Playwright shrinks video into 800x800 and text dies)
- `demo.mp4` — H.264 convenience copy (QuickTime plays it; webm does not play natively on macOS)
- `events.json` — `[{ t_video_ms, step }, ...]`, non-decreasing timestamps
- `videos/` — raw Playwright recording staging

## Alignment doctrine

- Call `step('ШАГ N: …')` BEFORE each action; the banner is painted into the
  video frame, so any player or VLM sees the step labels without external logs.
- Script clock and video clock differ (leading idle is trimmed): NEVER align by
  wall-clock math; align by the banner or by `events.json` ordering.
- VLM timestamp recovery without markers is ±1–1.5s at best; with the banner
  it is exact.

## Analytics path (local first, VLM second)

1. `info` — duration/fps/codec via ffprobe (no network).
2. `frames` — local ffmpeg sampling for visual inspection.
3. VLM behavioral queries (timestamps of clicks, state changes) go through the
   qmm skills (`qmm-quota-router` gates the model choice; `vision_chat` with
   the video worked in the PoC; `omni_av_grounding` failed on the current key).
   This skill deliberately contains NO API calls.

## Evidence rules

- One run = one evidence unit: all frames of a claim come from one run dir;
  never splice runs. Re-run from a clean out dir instead.
- Record the exact scenario file + commit + flags next to the artifact when
  the recording is used as evidence (same stance as record-browser-gif).
- Keep run artifacts under gitignored `.playwright-mcp/`.

## Limitations and traps

- Video file exists only after the context closes; save it before closing the browser.
- Recording is frame-on-change: static pauses produce no frames (this is why
  the file is small); fast animations sample at 25 fps.
- Store ~0.4 MB per 11s at 1280x800 — an hour of UI video is ~100–150 MB.
- VLM timestamps are approximate without in-frame markers.

## Relations

- `record-browser-gif` — turns a recording into a PR demo GIF (this skill produces its input).
- `plex-music-audit`, dsh web/mobile e2e — integration targets (see README recipes).
- `qmm-quota-router` + `qwen-mm-plugins-api` — VLM analytics of the recording.
