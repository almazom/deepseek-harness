#!/usr/bin/env node
// pw-video — record / inspect / sample annotated behavioral videos.
//   run <scenario.mjs> --out <dir> [--w N] [--h N] [--repo path]
//   info <media>
//   frames <media> <outDir> [--fps N]
// Exit codes: 0 ok · 2 usage · 3 media tool or input missing · 1 runtime error.
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ffprobeSummary, resolvePlaywright, withVideoRecording } from './video-context.mjs';

// Skill lives at <repo>/.agents/skills/browser-video-record/scripts/ — repo root is 4 up.
const DEFAULT_REPO = fileURLToPath(new URL('../../../..', import.meta.url));

const USAGE = `usage:
  pw-video run <scenario.mjs> --out <dir> [--w N] [--h N] [--repo path]
  pw-video info <media>
  pw-video frames <media> <outDir> [--fps N]`;

function failUsage(msg) { console.error(`${msg}\n${USAGE}`); process.exit(2); }
function failMissing(msg) { console.error(`MEDIA_TOOL_OR_INPUT_MISSING: ${msg}`); process.exit(3); }

function parseOpts(argv, minPositional) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' }, w: { type: 'string', default: '1280' },
      h: { type: 'string', default: '800' }, repo: { type: 'string' },
      fps: { type: 'string', default: '1' },
    },
    strict: false,
  });
  return positionals.length >= minPositional ? { values, positionals } : null;
}

function toMp4(webm) {
  const out = webm.replace(/\.webm$/i, '.mp4');
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { encoding: 'utf8' });
  return res.status === 0 ? out : null; // mp4 is a convenience copy; webm is the artifact
}

async function cmdRun(values, positionals) {
  const [scenarioPath] = positionals;
  const outDir = resolve(values.out ?? '.');
  const mod = await import(pathToFileURL(resolve(scenarioPath)).href);
  if (typeof mod.default !== 'function') {
    failUsage(`scenario must default-export async ({ page, step, log }) => {}: ${scenarioPath}`);
  }
  let playwright;
  try {
    playwright = resolvePlaywright(values.repo ?? DEFAULT_REPO);
  } catch (err) {
    failMissing(err.message);
  }
  const result = await withVideoRecording(
    { playwright, runDir: outDir, width: Number(values.w), height: Number(values.h) },
    mod.default,
  );
  const mp4 = toMp4(result.videoPath);
  console.log(JSON.stringify({ ok: true, video: result.videoPath, mp4, events: result.events.length, ...ffprobeSummary(result.videoPath) }, null, 2));
}

function cmdInfo(file) {
  if (!existsSync(file)) failMissing(`input not found: ${file}`);
  console.log(JSON.stringify({ ok: true, file, ...ffprobeSummary(file) }, null, 2));
}

function cmdFrames(values, positionals) {
  const [file, outDir] = positionals;
  if (!existsSync(file)) failMissing(`input not found: ${file}`);
  mkdirSync(outDir, { recursive: true });
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `fps=${Number(values.fps)}`, join(outDir, 'frame_%04d.png')], { encoding: 'utf8' });
  if (res.error) failMissing(res.error.message);
  if (res.status !== 0) {
    console.error(`ffmpeg failed (${res.status}): ${String(res.stderr).trim()}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, outDir, fps: Number(values.fps) }));
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'run') {
    const o = parseOpts(rest, 1);
    if (!o) failUsage('run: missing <scenario.mjs>');
    await cmdRun(o.values, o.positionals);
  } else if (cmd === 'info') {
    const o = parseOpts(rest, 1);
    if (!o) failUsage('info: missing <media>');
    cmdInfo(o.positionals[0]);
  } else if (cmd === 'frames') {
    const o = parseOpts(rest, 2);
    if (!o) failUsage('frames: missing <media> <outDir>');
    cmdFrames(o.values, o.positionals);
  } else {
    failUsage(cmd ? `unknown command: ${cmd}` : 'no command');
  }
} catch (err) {
  console.error(err?.message ?? String(err));
  process.exit(1);
}
