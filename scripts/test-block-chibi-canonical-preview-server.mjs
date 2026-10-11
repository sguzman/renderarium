#!/usr/bin/env node
/**
 * Canonical assembly -> IR -> existing Three.js preview server integration.
 * This test does not launch a browser, mutate an approved scene or use CI.
 *
 * Run: node scripts/test-block-chibi-canonical-preview-server.mjs
 * Requires the repository's existing yaml, ajv, and three dependencies.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const id = "block-chibi-factory-v1";
const assembly = "scenes/" + id + "/room.assembly.yml";
const output = resolve(root, "scenes", id, "generated", id + ".sc3d.yml");
const before = existsSync(output) ? readFileSync(output) : null;
const server = resolve(root, "scripts/serve-sc3d-preview.mjs");

const child = spawn(process.execPath, [server, assembly], {
  cwd: root,
  env: {...process.env, PORT: "0"},
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", chunk => { stderr += chunk; });

function waitForServer() {
  return new Promise((resolveReady, reject) => {
    let log = "";
    const timeout = setTimeout(() => {
      reject(new Error("SC3D server did not start within 20 seconds: " + stderr));
    }, 20000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    function onError(error) { cleanup(); reject(error); }
    function onExit(code) {
      cleanup();
      reject(new Error("SC3D server exited " + code + " before ready: " + stderr));
    }
    function onData(chunk) {
      log += chunk.toString("utf8");
      const match = log.match(/SC3D preview: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match) return;
      cleanup();
      resolveReady(match[1]);
    }
    child.stdout.on("data", onData);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

function checkSnapshotUnchanged() {
  const after = existsSync(output) ? readFileSync(output) : null;
  assert.deepEqual(after, before,
    "Canonical preview must not create or rewrite the frozen generated scene snapshot");
}

try {
  const url = await waitForServer();
  const irResponse = await fetch(new URL("asset-ir.json", url), {
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(irResponse.status, 200, "canonical IR endpoint did not respond");
  const ir = await irResponse.json();
  assert.equal(ir.ir_kind, "Constructive3DIR");
  assert.equal(ir.asset.id, id);
  const geometry = Object.values(ir.parts).filter(part => part.geometry);
  const instances = Object.values(ir.parts).filter(part => part.role === "component-root");
  assert.equal(geometry.length, 209, "source-derived Factory geometry count changed");
  assert.equal(instances.length, 16, "Factory component count changed");
  assert.equal(ir.parts["shell__root"].parent, "root");
  assert.equal(ir.parts["forming-press__root"].parent, "root");

  const requests = [
    ["", "<script type=\"module\">"],
    ["runtime/sc3d/three-adapter-browser.mjs", "buildSc3dObject"],
    ["vendor/three.module.js", "WebGLRenderer"],
  ];
  for (const [route, expected] of requests) {
    const response = await fetch(new URL(route, url), {
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.status, 200, route + ": canonical preview asset unavailable");
    const body = await response.text();
    assert(body.includes(expected), route + ": expected canonical renderer contract missing");
  }
  checkSnapshotUnchanged();
  console.log("PASS canonical Factory preview server: Ajv + SC3D IR, " +
    "209 geometry parts, 16 component roots, Three.js routes, no snapshot writes.");
  console.log("Not tested: actual browser drawing, WebGL, GPU, or visual acceptance.");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  checkSnapshotUnchanged();
}
