#!/usr/bin/env node
// Static regression guard for the diagnostic-only Backyard full-effects benchmark.
// This deliberately does not claim real browser rendering, GPU timings, or visual approval.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inflateSync} from "node:zlib";
import {Script} from "node:vm";

const original = readFileSync("experiments/integration/backyard-unified-effects-v1-1-precision-fix-2026-10-15.html", "utf8");
const benchmark = readFileSync("experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html", "utf8");
const sourceChunks = text => {
  const match = text.match(/const chunks=\[([\s\S]*?)\];/);
  assert.ok(match, "Missing packed canonical Backyard data");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).join("");
};
const a = sourceChunks(original), b = sourceChunks(benchmark);
assert.equal(a, b, "Benchmark must not change the accepted 179-part source");

const raw = inflateSync(Buffer.from(b, "base64"));
assert.equal(raw.subarray(0, 4).toString("ascii"), "RB01", "Canonical source signature");
assert.equal(raw.length, 3235, "Canonical source byte length");
let fingerprint = 2166136261;
for (const byte of raw) fingerprint = Math.imul(fingerprint ^ byte, 16777619) >>> 0;
assert.equal(fingerprint, 3583097875, "Canonical source FNV-1a checksum");
let p = 4;
const paletteSize = raw[p++]; p += paletteSize * 3;
const groupCount = raw[p++]; p += groupCount * 18;
assert.equal(groupCount, 18, "Canonical hierarchy groups");
assert.equal(raw.readUInt16LE(p), 179, "Accepted geometry part count");

const shaderNames = [
  "cam", "quadVS", "meshVS", "meshFS", "skyFS", "outlineFS",
  "shaftFS", "extractFS", "blurFS", "gradeFS", "fxaaFS",
  "particleVS", "particleFS",
];
const shader = (text, name) => {
  const match = text.match(new RegExp("const " + name + "=\`([\\s\\S]*?)\`;"));
  assert.ok(match, "Missing GLSL shader " + name);
  return match[1];
};
for (const name of shaderNames) {
  assert.equal(shader(benchmark, name), shader(original, name), name + " GLSL or camera projection changed");
}
assert.ok(benchmark.includes("const programs=[program(meshVS,meshFS)"), "Canonical program compilation chain missing");
for (const label of ["Minimal", "Outlines", "Shafts", "Bloom", "Dust", "FXAA", "Combined"]) {
  assert.ok(benchmark.includes("['" + label + "',"), "Missing benchmark scenario " + label);
}
for (const required of [
  "mark('setup')", "mark('sky')", "mark('mesh')", "mark('outline')",
  "mark('shafts')", "mark('bloom')", "mark('grading')", "mark('weather')",
  "mark('fxaa')", "beginGpu(rec)", "endGpu(activeQuery)",
  "GPU_DISJOINT_EXT", "benchAdvance(now)", "drawCalls++", "document.visibilityState",
]) assert.ok(benchmark.includes(required), "Missing benchmark guard: " + required);
const body = benchmark.match(/<script>\s*([\s\S]*?)<\/script><\/body><\/html>/);
assert.ok(body, "No standalone browser script found");
new Script(body[1], {filename: "backyard-full-effects-benchmark-v2.js"});
assert.ok(benchmark.includes("id=\"benchRun\""), "Benchmark run UI missing");
assert.ok(benchmark.includes("id=\"benchCopy\""), "Results export UI missing");
console.log("PASS Backyard effects benchmark v2 static regression: canonical payload, 13 shaders, seven profiles, script syntax, and instrumentation");
