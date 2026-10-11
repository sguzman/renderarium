#!/usr/bin/env node
// Zero-dependency consistency gate for the Factory v1 review viewers.
// Run from any directory: node tools/verify-factory-preview.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { resolve, dirname, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scene = resolve(root, "scenes/block-chibi-factory-v1");
const spec = JSON.parse(readFileSync(resolve(scene, "preview-geometry.json"), "utf8"));
const sourceRows = spec.parts.split("\n");
assert.equal(spec.mesh_count, 209, "Factory source mesh count must not change without explicit scene revision");
assert.equal(spec.groups.length, 16, "Factory instance count changed");
assert.equal(sourceRows.length, spec.mesh_count);

// A preview can match both HTML viewers while no longer matching the actual
// SC3D files. Verify the assembly and the exact source revisions pinned by the
// human-approved preview before comparing rendered primitive definitions.
function verifyPinnedSource(path, expectedSha) {
  assert.equal(typeof path, "string", "Source path must be a string");
  assert.match(expectedSha, /^[0-9a-f]{40}$/, `${path}: missing Git blob SHA`);
  const absolute = resolve(root, path);
  assert(absolute.startsWith(root + sep), `${path}: source escapes repository root`);
  const bytes = readFileSync(absolute);
  const actualSha = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  assert.equal(actualSha, expectedSha, `${path}: source changed after Factory approval; revise the preview explicitly`);
}
const pins = new Map();
for (const item of [
  { path: spec.source_assembly, sha: spec.source_assembly_blob },
  ...spec.groups.map(group => ({ path: group.source, sha: group.source_blob }))
]) {
  if (pins.has(item.path)) {
    assert.equal(pins.get(item.path), item.sha, `${item.path}: conflicting pinned revisions`);
  } else {
    verifyPinnedSource(item.path, item.sha);
    pins.set(item.path, item.sha);
  }
}
console.log(`PASS ${pins.size} pinned Factory SC3D source files (Git blob SHA-1)`);

function extract(viewer) {
  const html = readFileSync(resolve(scene, viewer), "utf8");
  const from = html.indexOf("const roots=");
  const to = html.indexOf("const parts=pieces;");
  assert(from >= 0 && to > from, `${viewer}: embedded geometry definition missing`);
  const vm = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const { roots, pieces } = runInContext(html.slice(from, to) + "\n({roots, pieces})", vm, { timeout: 1000 });
  assert.equal(pieces.length, spec.mesh_count, `${viewer}: wrong part count`);
  assert.equal(roots.length, spec.groups.length, `${viewer}: wrong group count`);
  assert(!html.includes("polys.sort("), `${viewer}: average-depth painter sorting returned`);
  assert(html.includes("new Float32Array(ww*hh)"), `${viewer}: software Z buffer missing`);
  assert(html.includes("invZ<=depth[i]"), `${viewer}: per-pixel depth comparison missing`);
  return { html, roots, pieces };
}

const validNumber = n => Number.isFinite(n);
function matches(a, b, detail) {
  assert.equal(a.length, b.length, `${detail}: vector dimension drift`);
  for (let i = 0; i < a.length; i++) {
    assert(validNumber(Number(a[i])) && validNumber(Number(b[i])), `${detail}: nonfinite value`);
    assert(Math.abs(Number(a[i]) - Number(b[i])) < 1e-5, `${detail}: index ${i} geometry drift ${a[i]} vs ${b[i]}`);
  }
}

function sourcePart(row) {
  const [group, id, parent, type, dimensions, hex, position, rotation] = row.split("|");
  assert.equal(parent, "-", `${id}: hierarchical realization requires expanded transforms`);
  return { group: Number(group), id, type, dimensions: dimensions.split(",").map(Number), hex,
    position: position === "-" ? [0,0,0] : position.split(",").map(Number),
    rotation: rotation === "-" ? [0,0,0] : rotation.split(",").map(Number) };
}

const authoritative = sourceRows.map(sourcePart);
let tested = 0;
for (const file of ["review-depth-buffered.html", "review-depth-cpu-only.html"]) {
  const { html, roots, pieces } = extract(file);
  for (let g = 0; g < spec.groups.length; g++) {
    matches(roots[g], spec.groups[g].translate, `${file}: group ${g} root`);
  }
  for (let i = 0; i < authoritative.length; i++) {
    const expected = authoritative[i], actual = pieces[i];
    assert.equal(actual.g, expected.group, `${file}: group drift at ${i} ${expected.id}`);
    assert.equal(actual.type, expected.type, `${file}: primitive drift at ${i} ${expected.id}`);
    assert.equal(actual.color.map(n => n.toString(16).padStart(2, "0")).join(""), expected.hex,
      `${file}: material drift at ${i} ${expected.id}`);
    matches(actual.d, expected.dimensions, `${file}: dimensions of ${expected.id}`);
    matches(actual.p, expected.position, `${file}: position of ${expected.id}`);
    matches(actual.r, expected.rotation, `${file}: orientation of ${expected.id}`);
    tested++;
  }
  if (file === "review-depth-buffered.html") {
    assert(html.includes("gl.enable(gl.DEPTH_TEST)"), "WebGL depth test missing");
  } else {
    assert(html.includes("const gl=null;"), "CPU-only viewer must disable GPU branch");
  }
  console.log(`PASS ${file}: 16 roots, 209 parts, dimensions, materials, transforms, depth testing`);
}
console.log(`PASS total: ${tested} source/renderer piece equivalences (2 review modes)`);
