#!/usr/bin/env node
/**
 * Linux desktop launcher for the real source-bound WebGL environments.
 * No geometry conversion, screenshots, or substitute renderer.
 */
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const command = resolve(root, "scripts/serve-sc3d-preview.mjs");
const args = process.argv.slice(2);
if (args.some(arg => !["--no-open"].includes(arg))) {
  console.error("Usage: node scripts/launch-environments.mjs [--no-open]");
  process.exit(2);
}
const noOpen = args.includes("--no-open");
const server = spawn(process.execPath, [command, "--environments"], {
  cwd: root, env: process.env, stdio: ["inherit", "pipe", "inherit"],
});
let seenUrl = false;
let buffered = "";
server.stdout.setEncoding("utf8");
server.stdout.on("data", chunk => {
  process.stdout.write(chunk);
  buffered += chunk;
  if (!seenUrl) {
    const match = buffered.match(/SC3D preview: (http:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) {
      seenUrl = true;
      const target = match[1] + "?scene=living-room";
      console.log("Interactive WebGL Living Room: " + target);
      if (!noOpen) {
        const opener = spawn("xdg-open", [target], {
          stdio: "ignore", detached: true,
        });
        opener.on("error", error => {
          console.error("Browser could not open automatically. Open the address above:", error.message);
        });
        opener.unref();
      }
    }
  }
  if (buffered.length > 2000) buffered = buffered.slice(-500);
});
server.on("error", error => {
  console.error("Preview server failed:", error.message);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => {
  if (!seenUrl) console.error("Preview server exited before becoming ready.");
  process.exitCode = code === 0 ? 0 : 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { if (!server.killed) server.kill(signal); });
}
