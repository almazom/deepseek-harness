# browser-video-record

Annotated behavioral video for ANY Playwright-driven browser testing.
Doctrine lives in [SKILL.md](SKILL.md); this README is the integration cookbook.

## Install (nothing to install)

The skill resolves playwright from a repo checkout's `apps/web/package.json`
(`--repo` flag or `resolvePlaywright(repoRoot)`) and needs `ffmpeg`/`ffprobe`
on PATH. No npm dependencies are added anywhere.

## Recipe A — wrap an existing script (3 lines)

```js
const { resolvePlaywright, withVideoRecording } = await import('.../scripts/video-context.mjs');
const playwright = resolvePlaywright(repoRoot);
const { videoPath, events } = await withVideoRecording({ playwright, runDir }, oldScenarioBody);
```

## Recipe B — CLI for one-off runs

```sh
node scripts/pw-video.mjs run scenario.mjs --out .playwright-mcp/video-runs/run-1
```

## Recipe C — audits (plex-music-audit style)

Keep existing screenshots; add one `step('альбом N')` per album and let the
context record continuously. The audit gains a replayable behavioral record at
~0.4 MB / 11s; a one-hour audit is ~100–150 MB.

## Recipe D — analyze a recording

```sh
node scripts/pw-video.mjs info run-1/demo.webm      # fps/codec/duration
node scripts/pw-video.mjs frames run-1/demo.webm frames/ --fps 1
```

VLM queries (timestamps of clicks, state changes): `qmm-quota-router` +
`qwen-mm` `vision_chat` with the video (worked in PoC; omni grounding did not).

## Storage and limits

VP8 webm is frame-on-change: static UI compresses to near-nothing, fast
animations sample at 25 fps. webm does not play in QuickTime — use demo.mp4
or a browser. See SKILL.md "Limitations and traps" for the full list.
