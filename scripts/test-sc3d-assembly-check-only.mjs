#!/usr/bin/env node
/**
 * Read-only SC3D assembler regression. Operates entirely in an ephemeral
 * directory; never modifies an accepted source or generated scene.
 *
 * Run: node scripts/test-sc3d-assembly-check-only.mjs
 * Requires the repository's existing yaml/ajv dependencies.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assembler = resolve(root, "scripts/assemble-sc3d-scene.mjs");
const sample = resolve(root,
  "assets/constructive-3d/factories/block-chibi-pastel-toy-block-v1.sc3d.yml");
const temp = mkdtempSync(join(tmpdir(), "scenarium-sc3d-readonly-"));
const out = "scenes/read-only-probe/generated/probe.sc3d.yml";
const absOut = resolve(temp, out);
const fixture = "scenes/read-only-probe/room.assembly.yml";
const absFixture = resolve(temp, fixture);
const absAsset = resolve(temp, "assets/probe.sc3d.yml");
const text = [
  "format: scenarium-sc3d-scene-assembly",
  'version: "0.1"',
  "id: read-only-probe",
  "name: Read Only Probe",
  "description: Ephemeral canonical assembly check without touching real scenes.",
  "components:",
  "  - id: toy",
  "    asset: assets/probe.sc3d.yml",
  "    transform: {translate: [1, 0, 0]}",
  "generated_output:",
  "  path: " + out,
  ""
].join("\n");

function invoke(...args) {
  return spawnSync(process.execPath, [assembler, ...args], {
    cwd: temp, encoding: "utf8", timeout: 20000,
  });
}
function ensureSuccess(result, label) {
  assert.equal(result.status, 0,
    label + ": " + (result.stderr || result.error?.message || result.stdout));
  assert.match(result.stdout, /SC3D CHECK ONLY: read-only-probe;/,
    label + ": canonical SC3D receipt missing");
  assert.match(result.stdout, /no output written\./,
    label + ": read-only confirmation missing");
}

try {
  mkdirSync(dirname(absOut), {recursive:true});
  mkdirSync(dirname(absAsset), {recursive:true});
  copyFileSync(sample, absAsset);
  writeFileSync(absFixture, text);

  // An initial check does not create the configured snapshot.
  ensureSuccess(invoke("--check-only", fixture), "snapshot absent");
  assert(!existsSync(absOut), "check-only unexpectedly created a snapshot");

  // A preexisting arbitrary blob must survive a successful semantic check.
  const sentinel = Buffer.from("SCENARIUM_GENERATED_OUTPUT_MUST_NOT_CHANGE\n");
  writeFileSync(absOut, sentinel);
  ensureSuccess(invoke("--check-only", fixture), "snapshot present");
  assert.deepEqual(readFileSync(absOut), sentinel,
    "check-only rewrote an existing snapshot");

  // The browser-server IR transport must be valid JSON and equally
  // read-only. Check stable identity and geometric primitive count.
  const transport = invoke("--emit-ir-json", fixture);
  assert.equal(transport.status, 0, transport.stderr);
  const ir = JSON.parse(transport.stdout);
  assert.equal(ir.ir_kind, "Constructive3DIR");
  assert.equal(ir.asset.id, "read-only-probe");
  assert.equal(ir.parts.toy__root.parent, "root");
  assert(Object.values(ir.parts).some(part => part.geometry),
    "lowered scene IR has no geometric parts");
  assert.deepEqual(readFileSync(absOut), sentinel,
    "IR JSON export rewrote the snapshot");

  // Even a failed check cannot mutate the generated output.
  writeFileSync(absAsset, "invalid-source: true\n");
  const invalid = invoke("--check-only", fixture);
  assert.notEqual(invalid.status, 0, "malformed SC3D unexpectedly passed");
  assert.deepEqual(readFileSync(absOut), sentinel,
    "failed validation rewrote an existing snapshot");

  const badTransport = invoke("--emit-ir-json", fixture);
  assert.notEqual(badTransport.status, 0,
    "invalid source unexpectedly exported canonical IR");
  assert.deepEqual(readFileSync(absOut), sentinel,
    "failed JSON export touched the snapshot");

  // Strict CLI usage rejects unknown flags without any filesystem writes.
  const unknown = invoke("--check-only", "--unexpected", fixture);
  assert.equal(unknown.status, 2, "unknown CLI option did not fail closed");
  assert.deepEqual(readFileSync(absOut), sentinel);

  console.log(
    "PASS SC3D check-only: no snapshot creation, no rewrite, no failure-side " +
    "effects, canonical IR transport, strict CLI arguments"
  );
} finally {
  rmSync(temp, {recursive:true, force:true});
}
