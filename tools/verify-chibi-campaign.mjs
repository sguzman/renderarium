#!/usr/bin/env node
/**
 * Audit the frozen seven-scene block-chibi campaign without GitHub Actions,
 * external packages, or renderer assumptions.
 *
 * Run: node tools/verify-chibi-campaign.mjs
 *
 * Scope: source Git-blob pins and structural consistency of recorded preview
 * primitives. This is NOT a canonical Three.js, WebGL, visual or CI pass.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenes = Object.freeze([
  ["living-room", 87, 9],
  ["kitchen", 149, 11],
  ["bathroom", 139, 10],
  ["office", 104, 12],
  ["backyard", 181, 18],
  ["garage", 112, 8],
  ["factory", 209, 16],
]);

function fail(message) {
  throw new Error(message);
}

function numericVector(value, count, label, { positive = false, allowDefault = true } = {}) {
  let result;
  if (value === "-" || value == null) {
    assert(allowDefault, label + ": missing required dimensions");
    result = Array(count).fill(positive ? 1 : 0);
  } else if (Array.isArray(value)) {
    result = value;
  } else if (typeof value === "string") {
    result = value.split(",").map(Number);
  } else {
    fail(label + ": expected vector, comma-separated vector, or '-'");
  }
  assert.equal(result.length, count, label + ": wrong vector length");
  assert(result.every(n => Number.isFinite(n) && (!positive || n > 0)),
    label + ": nonfinite or nonpositive vector member");
  return result;
}

function pinnedFile(path, sha, label, pins, verifiedPaths) {
  assert(typeof path === "string" && path.length > 0,
    label + ": missing source path");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/,
    label + ": missing or invalid source Git blob hash");
  const previous = pins.get(path);
  if (previous != null) {
    assert.equal(sha, previous, label + ": conflicting pins for " + path);
    return;
  }
  const resolved = resolve(root, path);
  assert(resolved.startsWith(root + sep), label + ": source outside repository");
  // Git blob IDs hash the literal file content preceded by a binary header.
  const bytes = readFileSync(resolved);
  const actual = createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
  assert.equal(actual, sha, label + ": source contents drifted: " + path);
  pins.set(path, sha);
  verifiedPaths.add(path);
}

function verifyScene(name, expectedParts, expectedGroups, pins, verifiedPaths) {
  const id = "block-chibi-" + name + "-v1";
  const location = "scenes/" + id + "/preview-geometry.json";
  const spec = JSON.parse(readFileSync(resolve(root, location), "utf8"));
  assert.equal(spec.scene, id, id + ": preview scene ID mismatch");
  assert.equal(spec.mesh_count ?? spec.geometry_count, expectedParts,
    id + ": accepted primitive count changed");
  assert.equal(spec.groups?.length, expectedGroups,
    id + ": accepted group count changed");
  assert.equal(typeof spec.parts, "string", id + ": missing geometry records");
  const lines = spec.parts.split("\n");
  assert.equal(lines.length, expectedParts, id + ": actual primitive count differs");

  pinnedFile(spec.source_assembly, spec.source_assembly_blob,
    id + " assembly", pins, verifiedPaths);

  for (const [index, group] of spec.groups.entries()) {
    assert.equal(group.index, index, id + ": group order drift");
    assert(typeof group.id === "string" && group.id.length > 0,
      id + ": unnamed group " + index);
    pinnedFile(group.source, group.source_blob ?? group.source_sha,
      id + " group " + group.id, pins, verifiedPaths);
    numericVector(group.translate, 3, id + " " + group.id + " translate");
    numericVector(group.rotate_deg, 3, id + " " + group.id + " rotate");
    numericVector(group.scale, 3, id + " " + group.id + " scale",
      { positive: true });
  }

  const partsByGroup = new Map();
  const allPartIds = new Set();
  const parents = [];
  let cuboids = 0;
  let tapered = 0;
  for (const [index, line] of lines.entries()) {
    const columns = line.split("|");
    assert([8, 9].includes(columns.length), id + ": record " + index + " wrong arity");
    const [groupText, partId, parent, type, dimensions, hex, pos, rot, scale] = columns;
    assert(/^(0|[1-9]\d*)$/.test(groupText), id + ": invalid group index");
    const group = Number(groupText);
    assert(group < expectedGroups, id + ": primitive outside group range");
    assert(partId.length > 0, id + ": empty part ID");
    const key = group + "/" + partId;
    assert(!allPartIds.has(key), id + ": duplicate part identity " + key);
    allPartIds.add(key);
    assert(parent.length > 0, id + ": empty parent field");
    if (parent !== "-") parents.push({ key, parent: group + "/" + parent });
    assert(type === "b" || type === "t", id + ": unknown primitive type " + type);
    numericVector(dimensions, type === "b" ? 3 : 5, id + ": " + key + " dimensions",
      { positive: true, allowDefault: false });
    assert.match(hex, /^[a-f0-9]{6}$/i, id + ": " + key + " invalid material hex");
    numericVector(pos, 3, id + ": " + key + " position");
    numericVector(rot, 3, id + ": " + key + " rotation");
    if (columns.length === 9) {
      numericVector(scale, 3, id + ": " + key + " scale", { positive: true });
    }
    partsByGroup.set(group, (partsByGroup.get(group) ?? 0) + 1);
    if (type === "b") cuboids++; else tapered++;
  }

  for (const { key, parent } of parents) {
    assert(allPartIds.has(parent), id + ": " + key + " missing parent " + parent);
  }
  for (const group of spec.groups) {
    assert((partsByGroup.get(group.index) ?? 0) > 0,
      id + ": empty group " + group.id);
  }
  console.log("PASS " + id + ": " + lines.length +
    " primitives (" + cuboids + " cuboids, " + tapered +
    " tapered), " + spec.groups.length + " groups, " + parents.length +
    " parent links");
  return { parts: lines.length, groups: spec.groups.length, pins:
    new Set([spec.source_assembly, ...spec.groups.map(g => g.source)]).size };
}

function main() {
  const pins = new Map();
  const verifiedPaths = new Set();
  const summary = scenes.map(([name, parts, groups]) =>
    verifyScene(name, parts, groups, pins, verifiedPaths));
  const counts = summary.reduce((acc, item) => ({
    parts: acc.parts + item.parts,
    groups: acc.groups + item.groups,
    scenePins: acc.scenePins + item.pins
  }), { parts: 0, groups: 0, scenePins: 0 });
  assert.equal(counts.parts, 981, "campaign geometry total changed");
  assert.equal(counts.scenePins, 76, "campaign pin reference count changed");
  console.log("PASS campaign: 7 scenes, " + counts.parts + " primitives, " +
    counts.groups + " instances, " + counts.scenePins + " per-scene source references, " +
    verifiedPaths.size + " distinct Git-pinned source files.");
  console.log("Not tested: visual acceptance, canonical runtime, WebGL, GPU or hosted CI.");
}

try {
  main();
} catch (error) {
  console.error("FAIL block-chibi campaign source audit: " + error.message);
  process.exitCode = 1;
}
