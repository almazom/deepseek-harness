import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import {
  BANNER_ID, createEventLog, parseFfprobeJson, resolvePlaywright,
  showStep, stepBannerJs,
} from '../scripts/video-context.mjs';

test('stepBannerJs builds a parseable expression carrying id, css and label', () => {
  const src = stepBannerJs('ШАГ 2: клик');
  assert.equal(typeof new Function(`return ${src}`), 'function'); // must parse
  assert.ok(src.includes(BANNER_ID));
  assert.ok(src.includes('position:fixed'));
  assert.ok(src.includes('ШАГ 2: клик'));
});

test('createEventLog pushes non-decreasing timestamps and saves json', () => {
  const log = createEventLog(Date.now() - 1000);
  log.push('a');
  log.push('b');
  assert.deepEqual(log.events.map((e) => e.step), ['a', 'b']);
  assert.ok(log.events[0].t_video_ms <= log.events[1].t_video_ms);
  const file = join(mkdtempSync(join(tmpdir(), 'pwr-')), 'events.json');
  log.save(file);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 2);
});

test('parseFfprobeJson extracts the video stream summary and nulls without one', () => {
  const probe = parseFfprobeJson({
    streams: [
      { codec_type: 'audio', codec_name: 'opus' },
      { codec_type: 'video', codec_name: 'vp8', width: 1280, height: 800, r_frame_rate: '25/1', duration: '10.92' },
    ],
    format: { duration: '10.92' },
  });
  assert.deepEqual(probe, { codec: 'vp8', width: 1280, height: 800, duration: 10.92, fps: 25 });
  assert.equal(parseFfprobeJson({ streams: [] }), null);
  assert.equal(parseFfprobeJson(undefined), null);
});

test('resolvePlaywright names the fix in its error message', () => {
  assert.throws(() => resolvePlaywright('/definitely/not/a/repo'), /--repo/);
});

test('showStep writes through the injected evaluator (fake page, no browser)', async () => {
  const calls = [];
  const log = createEventLog();
  const fakePage = { evaluate: async (src) => calls.push(src) };
  await showStep(fakePage, 'ШАГ 1: тест', log);
  assert.equal(log.events.length, 1);
  assert.match(calls[0], /ШАГ 1: тест/);
});
