#!/usr/bin/env node
/**
 * Canonical SC3D schema/semantic assembly gate for the seven graduated
 * block-chibi scenes. No generated snapshots are written.
 *
 * Usage:
 *   node scripts/check-block-chibi-canonical.mjs
 *   node scripts/check-block-chibi-canonical.mjs --scene factory
 *
 * Requires the repository's existing yaml/ajv dependencies.
 * This does not execute a Three.js renderer or a browser/GPU pipeline.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenes = new Map([
  ["living-room", { geometry: 87, instances: 9 }],
  ["kitchen", { geometry: 149, instances: 11 }],
  ["bathroom", { geometry: 139, instances: 10 }],
  ["office", { geometry: 104, instances: 12 }],
  ["backyard", { geometry: 181, instances: 18 }],
  ["garage", { geometry: 112, instances: 8 }],
  ["factory", { geometry: 209, instances: 16 }],
]);
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--scene" && scenes.has(args[1]))) {
  console.error("usage: node scripts/check-block-chibi-canonical.mjs [--scene living-room|kitchen|bathroom|office|backyard|garage|factory]");
  process.exit(2);
}
const chosen = args.length ? [args[1]] : [...scenes.keys()];
function vector(value, defaults, label) {
  const parsed = value == null || value === "-"
    ? defaults
    : Array.isArray(value) ? value : String(value).split(",").map(Number);
  assert.equal(parsed.length, defaults.length, label + ": vector arity differs");
  for (const number of parsed) {
    assert(Number.isFinite(number), label + ": nonfinite vector element");
  }
  return parsed;
}
function assertVectorEqual(preview, source, defaults, label) {
  const a = vector(preview, defaults, label + " preview");
  const b = vector(source, defaults, label + " manifest");
  for (let i = 0; i < defaults.length; i++) {
    assert(Math.abs(a[i] - b[i]) < 1e-5,
      label + "[" + i + "]: preview/manifest drift (" + a[i] + " vs " + b[i] + ")");
  }
}


let success = 0;
for (const name of chosen) {
  const id = "block-chibi-" + name + "-v1";
  const assembly = "scenes/" + id + "/room.assembly.yml";
  const expected = scenes.get(name);
  const spec = JSON.parse(readFileSync(resolve(root,
    "scenes", id, "preview-geometry.json"), "utf8"));
  assert.equal(spec.scene, id, id + ": unexpected preview identity");
  assert.equal(spec.mesh_count ?? spec.geometry_count, expected.geometry,
    id + ": frozen preview mesh count changed");
  assert.equal(spec.groups.length, expected.instances,
    id + ": frozen preview instance count changed");
  const manifest = YAML.parse(readFileSync(resolve(root, assembly), "utf8"));
  assert.equal(manifest.format, "scenarium-sc3d-scene-assembly",
    id + ": canonical manifest format changed");
  assert.equal(manifest.id, id, id + ": canonical manifest ID differs");
  assert.equal(manifest.components.length, expected.instances,
    id + ": actual assembly instance count changed");
  for (const [index, component] of manifest.components.entries()) {
    const recorded = spec.groups[index];
    assert.equal(recorded.index, index, id + ": preview instance order drift");
    assert.equal(recorded.id, component.id, id + ": component identity drift");
    assert.equal(recorded.source, component.asset, id + ": component source drift");
    for (const [property, defaults] of [
      ["translate", [0, 0, 0]], ["rotate_deg", [0, 0, 0]],
      ["scale", [1, 1, 1]]
    ]) {
      assertVectorEqual(recorded[property], component.transform?.[property],
        defaults, id + " / " + component.id + " / " + property);
    }
  }


  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [resolve(root, "scripts/assemble-sc3d-scene.mjs"),
       "--check-only", assembly],
      {cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024},
    );
  } catch (error) {
    console.error("FAIL " + id + ": canonical schema/semantic assembly rejected source");
    if (error.stdout) console.error(String(error.stdout).trim());
    if (error.stderr) console.error(String(error.stderr).trim());
    throw error;
  }
  const match = stdout.match(/^SC3D CHECK ONLY: ([^;]+); (\d+) parts; (\d+) geometry parts; (\d+) components$/m);
  assert(match, id + ": assembler emitted no canonical verification receipt");
  assert.equal(match[1], id, id + ": canonical identity drift");
  assert.equal(Number(match[3]), expected.geometry,
    id + ": canonical geometry does not match accepted preview count");
  assert.equal(Number(match[4]), expected.instances,
    id + ": canonical assembly instance count drift");
  assert(stdout.includes("no output written."),
    id + ": missing nonmutating assembly confirmation");
  console.log("PASS " + id + ": " + Number(match[2]) + " IR parts, " +
    match[3] + " geometry parts, " + match[4] + " components; schema + semantics valid");
  success++;
}
console.log("Canonical SC3D source assembly: " + success + "/" + chosen.length +
  " checked. No generated scene snapshots modified.");
console.log("Not tested: Three.js rendering, pixel parity, WebGL hardware or GitHub Actions.");
