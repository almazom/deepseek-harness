#!/usr/bin/env node
// TC-007 (mimo-output-budget-400): model-scoped, clamped output-budget restore
// for billion-context (#546).
//
// Problem: restoreOutputBudget keeps ONE high-water per session. A budget learned
// from a deepseek-official request (DEFAULT_MAX_TOKENS = 256000) is later injected
// into a MiMo request when the client sends a small budget, and the endpoint
// rejects it: "max_completion_tokens is too large: 256000. This model supports at
// most 131072 completion tokens, whereas you provided 256000."
//
// Fix: remember the high-water PER MODEL and clamp the restored value to the model
// declared max output (BILI_LAUNCHER_MODEL_MAX_OUTPUTS), so a foreign provider
// budget can never cross into this route.
//
// Usage:
//   node scripts/patch-bili-restore.mjs --check  [--file <path>]
//   node scripts/patch-bili-restore.mjs --apply  [--file <path>] [--allow-unknown-origin]
//   node scripts/patch-bili-restore.mjs --revert [--file <path>]
//
// Exit 0 when the state is known and the requested action succeeded; 1 when the
// anchors are absent or the build is unfamiliar (the patcher refuses instead of
// guessing). --apply is idempotent: a second run prints "already patched" and
// writes nothing. --apply checks the pre-patch sha256 against KNOWN_PRE_PATCH_SHAS
// and refuses an unknown build unless --allow-unknown-origin is passed, so a
// billion-context bump cannot be rewritten silently.

import { createHash } from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_TARGET = "/Users/mac-mini-m4-almazom/.dsh/profiles/web/node_modules/billion-context/dist/index.js";
export const FN_NAME = "restoreOutputBudget";
export const HELPER_NAME = "launcherModelMaxOutput";
export const MARKER = "outputBudgetHighWaterByModel";

// Dist shas this patcher has been verified against. --apply refuses any other
// pre-patch build unless --allow-unknown-origin is passed: upstream is free to
// rewrite restoreOutputBudget, and silently patching such a build could corrupt it.
export const KNOWN_PRE_PATCH_SHAS = new Set([
  "5c8b1711cc8f6b2fd0dd7b689afe513f2410ac4c33597fbfc18a7e15aa49bc64"
  // billion-context 0.1.138, the pinned build in ~/.dsh/profiles/web/package.json
]);

export const ORIGINAL_TEXT = [
  "function restoreOutputBudget(parsed, session, log2) {",
  "  const field = outputBudgetField(parsed);",
  "  if (!field) return;",
  "  const p2 = parsed;",
  "  const value = readOutputBudget(p2, field);",
  "  if (value === void 0) return;",
  "  if (value > SIDE_REQUEST_MAX_TOKENS) {",
  "    session.metadata.outputBudgetHighWater = value;",
  "    return;",
  "  }",
  "  if (!Array.isArray(p2.tools) || p2.tools.length === 0) return;",
  "  const highWater = session.metadata.outputBudgetHighWater;",
  "  if (typeof highWater === \"number\" && highWater > SIDE_REQUEST_MAX_TOKENS) {",
  "    writeOutputBudget(p2, field, highWater);",
  "    log2(\"info\", `[${session.id}] output budget restored ${value} -> ${highWater} (#546: client shrank it from its raw-history estimate)`);",
  "  }",
  "}"
].join("\n");

export const PATCHED_TEXT = [
  "function restoreOutputBudget(parsed, session, log2) {",
  "  const field = outputBudgetField(parsed);",
  "  if (!field) return;",
  "  const p2 = parsed;",
  "  const value = readOutputBudget(p2, field);",
  "  if (value === void 0) return;",
  "  const model = typeof p2.model === \"string\" && p2.model.length > 0 ? p2.model : \"\";",
  "  let byModel = session.metadata.outputBudgetHighWaterByModel;",
  "  if (!byModel || typeof byModel !== \"object\") {",
  "    byModel = {};",
  "    session.metadata.outputBudgetHighWaterByModel = byModel;",
  "  }",
  "  if (value > SIDE_REQUEST_MAX_TOKENS) {",
  "    session.metadata.outputBudgetHighWater = value;",
  "    byModel[model] = value;",
  "    return;",
  "  }",
  "  if (!Array.isArray(p2.tools) || p2.tools.length === 0) return;",
  "  const declared = launcherModelMaxOutput(model);",
  "  const learned = byModel[model];",
  "  const legacy = session.metadata.outputBudgetHighWater;",
  "  const scoped = typeof learned === \"number\" ? learned : model.length === 0 ? legacy : void 0;",
  "  const base = typeof scoped === \"number\" ? scoped : declared;",
  "  if (typeof base !== \"number\" || base <= SIDE_REQUEST_MAX_TOKENS) return;",
  "  const highWater = typeof declared === \"number\" ? Math.min(base, declared) : base;",
  "  writeOutputBudget(p2, field, highWater);",
  "  const source = typeof learned === \"number\" ? \"model high-water\" : typeof declared === \"number\" ? \"declared max output\" : \"session high-water\";",
  "  const clampNote = typeof declared === \"number\" && base > declared ? ` (clamped from ${base} to the declared max output of ${model})` : \"\";",
  "  log2(\"info\", `[${session.id}] output budget restored ${value} -> ${highWater}${clampNote} (#546: ${source})`);",
  "}",
  "function launcherModelMaxOutput(model) {",
  "  if (typeof model !== \"string\" || model.length === 0) return void 0;",
  "  const declared = LAUNCHER_MODEL_MAX_OUTPUTS[model];",
  "  return typeof declared === \"number\" && Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : void 0;",
  "}"
].join("\n");

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function locateFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1, text: src.slice(start, i + 1) };
    }
  }
  return null;
}

export function countOccurrences(src, needle) {
  let n = 0;
  let at = src.indexOf(needle);
  while (at >= 0) { n += 1; at = src.indexOf(needle, at + needle.length); }
  return n;
}

export function detectState(src) {
  const fn = locateFunction(src, FN_NAME);
  if (!fn) return { state: "missing", fn: null };
  const patched = src.includes("function " + HELPER_NAME + "(") && fn.text.includes(MARKER);
  return { state: patched ? "patched" : "original", fn };
}

export function applyPatch(src) {
  const st = detectState(src);
  if (st.state === "missing") return { ok: false, reason: "anchor function " + FN_NAME + " not found" };
  if (st.state === "patched") return { ok: true, changed: false, source: src };
  const out = src.slice(0, st.fn.start) + PATCHED_TEXT + src.slice(st.fn.end);
  return { ok: true, changed: true, source: out };
}

export function revertPatch(src) {
  const st = detectState(src);
  if (st.state === "missing") return { ok: false, reason: "anchor function " + FN_NAME + " not found" };
  if (st.state === "original") return { ok: true, changed: false, source: src };
  let out = src.slice(0, st.fn.start) + ORIGINAL_TEXT + src.slice(st.fn.end);
  const helper = locateFunction(out, HELPER_NAME);
  if (helper) out = out.slice(0, helper.start - 1) + out.slice(helper.end);
  return { ok: true, changed: true, source: out };
}

function usage() {
  console.log("usage: node scripts/patch-bili-restore.mjs --check|--apply|--revert [--file <path>] [--allow-unknown-origin]");
  console.log("default target: " + DEFAULT_TARGET);
}

function parseArgs(argv) {
  const out = { action: null, file: DEFAULT_TARGET, allowUnknownOrigin: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--check" || a === "--apply" || a === "--revert") out.action = a.slice(2);
    else if (a === "--allow-unknown-origin") out.allowUnknownOrigin = true;
    else if (a === "--file") { i += 1; out.file = argv[i]; }
    else if (a === "--help" || a === "-h") out.action = "help";
    else { console.error("unknown argument: " + a); out.action = "bad"; }
  }
  return out;
}

function report(file, source) {
  const st = detectState(source);
  const verdict = st.state === "missing" ? "ANCHORS-MISSING" : st.state === "patched" ? "ALREADY-PATCHED" : "READY-TO-PATCH";
  console.log("BILLI-RESTORE PATCH CHECK");
  console.log("file: " + file);
  console.log("sha256: " + sha256(source));
  console.log("anchor hits (function " + FN_NAME + "): " + countOccurrences(source, "function " + FN_NAME + "("));
  console.log("state: " + st.state);
  console.log("verdict: " + verdict);
  return st.state;
}

function saveSource(file, text) {
  const tmp = file + ".bili-restore-tmp";
  writeFileSync(tmp, text, { encoding: "utf8", mode: statSync(file).mode });
  renameSync(tmp, file);
}

function loadSource(file) {
  try { statSync(file); } catch { return null; }
  return readFileSync(file, "utf8");
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.action === "help") { usage(); return 0; }
  if (args.action === "bad") { usage(); return 2; }
  if (args.action === null) { usage(); return 2; }
  const source = loadSource(args.file);
  if (source === null) { console.error("target not found: " + args.file); return 1; }
  const before = sha256(source);
  if (args.action === "check") {
    const state = report(args.file, source);
    return state === "missing" ? 1 : 0;
  }
  if (args.action === "apply") {
    const state = report(args.file, source);
    if (state === "original" && !KNOWN_PRE_PATCH_SHAS.has(before) && !args.allowUnknownOrigin) {
      console.error("REFUSED: " + before + " is not a known pre-patch billion-context dist;");
      console.error("patching an unfamiliar build could corrupt it. Re-run with --allow-unknown-origin to override.");
      return 1;
    }
    const res = applyPatch(source);
    if (!res.ok) { console.error("REFUSED: " + res.reason); return 1; }
    if (!res.changed) { console.log("already patched; file left byte-identical (" + before + ")"); return 0; }
    saveSource(args.file, res.source);
    console.log("patched: " + args.file);
    console.log("sha256 before: " + before);
    console.log("sha256 after:  " + sha256(res.source));
    return 0;
  }
  if (args.action === "revert") {
    report(args.file, source);
    const res = revertPatch(source);
    if (!res.ok) { console.error("REFUSED: " + res.reason); return 1; }
    if (!res.changed) { console.log("already original; file left byte-identical (" + before + ")"); return 0; }
    saveSource(args.file, res.source);
    console.log("reverted: " + args.file);
    console.log("sha256 after:  " + sha256(res.source));
    return 0;
  }
  usage();
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
