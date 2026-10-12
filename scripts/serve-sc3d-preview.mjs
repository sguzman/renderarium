import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSc3dFile } from "../runtime/sc3d/load.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetPath = resolve(process.argv[2] ?? "assets/constructive-3d/quest-girl-minimal.sc3d.yml");
const port = Number(process.env.PORT ?? 4177);

const webglHtmlPath = resolve(repoRoot, "scenes/sc3d-preview/index.html");
const softwareHtmlPath = resolve(repoRoot, "scenes/sc3d-software-preview/index.html");
const softwareModulePath = resolve(repoRoot, "runtime/sc3d/canvas-preview-browser.mjs");
const roomInteractionsModulePath = resolve(repoRoot, "scenes/cozy-reader-room-v1/room-interactions-browser.mjs");
const renderBudgetModulePath = resolve(repoRoot, "runtime/sc3d/preview-render-budget.mjs");
const frameProofModulePath = resolve(repoRoot, "runtime/sc3d/preview-frame-proof.mjs");
const qualityExperimentsModulePath = resolve(repoRoot, "runtime/sc3d/quality-experiments.mjs");
const htmlPath = process.env.SC3D_SOFTWARE_PREVIEW === "1"
  ? softwareHtmlPath : webglHtmlPath;
const adapterPath = resolve(repoRoot, "runtime/sc3d/three-adapter-browser.mjs");
const threePath = resolve(repoRoot, "node_modules/three/build/three.module.js");
const threeCorePath = resolve(repoRoot, "node_modules/three/build/three.core.js");

// Scene assemblies are lowered through the SAME canonical schema/semantic
// loader used by production assembly, but stay in memory. Existing direct
// *.sc3d.yml preview behavior remains unchanged.
const ir = assetPath.endsWith(".assembly.yml")
  ? JSON.parse(execFileSync(
      process.execPath,
      [resolve(repoRoot, "scripts/assemble-sc3d-scene.mjs"),
       "--emit-ir-json", relative(repoRoot, assetPath)],
      { cwd: repoRoot, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    ))
  : await loadSc3dFile(assetPath);
const assetJson = JSON.stringify(ir);

const contentType = (path) => ({
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
}[extname(path)] ?? "application/octet-stream");

const routes = new Map([
  ["/", htmlPath],
  ["/index.html", htmlPath],
  ["/runtime/sc3d/three-adapter-browser.mjs", adapterPath],
  ["/vendor/three.module.js", threePath],
  ["/vendor/three.core.js", threeCorePath],
  ["/software", softwareHtmlPath],
  ["/runtime/sc3d/canvas-preview-browser.mjs", softwareModulePath],
  ["/scenes/cozy-reader-room-v1/room-interactions-browser.mjs", roomInteractionsModulePath],
  ["/runtime/sc3d/preview-render-budget.mjs", renderBudgetModulePath],
  ["/runtime/sc3d/preview-frame-proof.mjs", frameProofModulePath],
  ["/runtime/sc3d/quality-experiments.mjs", qualityExperimentsModulePath],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/asset-ir.json") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(assetJson);
      return;
    }

    const path = routes.get(url.pathname);
    if (!path) {
      response.writeHead(404, {"content-type":"text/plain; charset=utf-8"});
      response.end("Not found");
      return;
    }

    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": contentType(path),
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, {"content-type":"text/plain; charset=utf-8"});
    response.end(error.stack ?? String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  // PORT=0 is useful for isolated automated tests: report the actual port
  // allocated by the OS, without assuming a fixed interactive server port.
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  console.log(`SC3D preview: http://127.0.0.1:${listeningPort}/`);
  console.log(`asset: ${assetPath}`);
  console.log(`validated parts: ${Object.keys(ir.parts).length}`);
});
