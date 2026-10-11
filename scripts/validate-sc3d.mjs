import { resolve } from "node:path";
import { loadSc3dFile } from "../runtime/sc3d/load.mjs";

const file = resolve(process.argv[2] ?? "assets/constructive-3d/quest-girl-minimal.sc3d.yml");

try {
  const ir = await loadSc3dFile(file);
  console.log(`SC3D OK: ${ir.asset.id}`);
  console.log(`  version: ${ir.version}`);
  console.log(`  parts: ${Object.keys(ir.parts).length}`);
  console.log(`  materials: ${Object.keys(ir.materials).length}`);
  console.log(`  root: ${ir.asset.root}`);
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
}
