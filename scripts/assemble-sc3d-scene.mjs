import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";
import { parseSc3dText } from "../runtime/sc3d/load.mjs";

// --check-only validates the entire canonical assembly and SC3D IR without
// writing, renaming, deleting, or replacing any generated snapshot.
const cliArgs = process.argv.slice(2);
const checkOnly = cliArgs.includes("--check-only");
const emitIrJson = cliArgs.includes("--emit-ir-json");
const positional = cliArgs.filter((arg) => arg !== "--check-only" && arg !== "--emit-ir-json");
if (positional.length !== 1 || positional[0].startsWith("-") || (checkOnly && emitIrJson)) {
  console.error("usage: node scripts/assemble-sc3d-scene.mjs [--check-only | --emit-ir-json] <scene-assembly.yml>");
  process.exit(2);
}
const manifestPath = positional[0];

const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest?.format !== "scenarium-sc3d-scene-assembly") {
  throw new Error("expected scenarium-sc3d-scene-assembly");
}
if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
  throw new Error("scene requires components");
}
const rootDir = process.cwd();
const merged = {
  format: "scenarium-constructive-3d",
  version: "0.1",
  units: "meters",
  coordinates: { handedness: "right", up: "y", forward: "-z" },
  asset: {
    id: manifest.id,
    name: manifest.name,
    kind: "environment",
    root: "root",
    description: manifest.description,
    tags: ["block-chibi", "environment", "scene-assembly", "character-free"],
  },
  requires: ["core.primitives", "core.rigid-hierarchy"],
  materials: {},
  geometry_library: {},
  parts: { root: { role: "scene-root", parent: null, articulation: "static" } },
  extensions: {
    scenarium_scene_assembly: {
      manifest: path.relative(rootDir, path.resolve(manifestPath)),
      generated: true,
      source_components: [],
    },
  },
};

const ids = new Set();
function prefixGeometry(value, prefix) {
  if (Array.isArray(value)) return value.map((x) => prefixGeometry(x, prefix));
  if (value === null || typeof value !== "object") return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    next[key] = key === "ref" && typeof child === "string"
      ? `${prefix}${child}`
      : prefixGeometry(child, prefix);
  }
  return next;
}

for (const component of manifest.components) {
  if (!component?.id || !/^[a-z0-9][a-z0-9_-]*$/.test(component.id)) {
    throw new Error("component id must be a nonblank lowercase slug");
  }
  if (ids.has(component.id)) throw new Error(`duplicate component id: ${component.id}`);
  ids.add(component.id);
  const sourcePath = path.resolve(rootDir, component.asset);
  const sourceBytes = fs.readFileSync(sourcePath);
  const source = YAML.parse(sourceBytes.toString("utf8"));
  if (source?.format !== "scenarium-constructive-3d") {
    throw new Error(`${component.id}: source is not an SC3D asset`);
  }
  const sourceRoot = source.asset?.root;
  if (!sourceRoot || !source.parts?.[sourceRoot]) {
    throw new Error(`${component.id}: missing source root`);
  }
  if (source.parts[sourceRoot].geometry || source.parts[sourceRoot].transform) {
    throw new Error(`${component.id}: transformed/visible source roots require explicit handling`);
  }

  const prefix = `${component.id}__`;
  const materialPrefix = `${prefix}mat__`;
  const geometryPrefix = `${prefix}geo__`;
  const group = `${prefix}root`;
  merged.parts[group] = {
    role: "component-root",
    parent: "root",
    articulation: "static",
    transform: structuredClone(component.transform ?? {}),
  };
  for (const [id, material] of Object.entries(source.materials ?? {})) {
    merged.materials[`${materialPrefix}${id}`] = structuredClone(material);
  }
  for (const [id, geometry] of Object.entries(source.geometry_library ?? {})) {
    merged.geometry_library[`${geometryPrefix}${id}`] = prefixGeometry(geometry, geometryPrefix);
  }
  for (const [id, part] of Object.entries(source.parts)) {
    if (id === sourceRoot) continue;
    const next = structuredClone(part);
    next.parent = !next.parent || next.parent === sourceRoot
      ? group : `${prefix}${next.parent}`;
    if (next.material) next.material = `${materialPrefix}${next.material}`;
    if (next.geometry) next.geometry = prefixGeometry(next.geometry, geometryPrefix);
    merged.parts[`${prefix}${id}`] = next;
  }
  merged.extensions.scenarium_scene_assembly.source_components.push({
    id: component.id,
    asset: component.asset,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    transform: structuredClone(component.transform ?? {}),
  });
}

const output = manifest.generated_output?.path;
if (!output || !output.startsWith("scenes/") || output.includes("..")) {
  throw new Error("generated_output.path must be a contained scenes/ path");
}
// Validation MUST precede all filesystem mutation. Never delete an existing
// tracked scene snapshot because an experimental assembly failed to parse.
const serialized = YAML.stringify(merged);
const ir = await parseSc3dText(serialized, {source: output});

// Produce canonical validated/lowered IR entirely in memory for the existing
// Three.js preview server; never inspect or change the generated snapshot.
if (emitIrJson) {
  process.stdout.write(JSON.stringify(ir));
  process.exit(0);
}

// This returns BEFORE any generated-output lookup or filesystem mutation.
// Count authored visible and hidden geometry alike; renderer visibility is a
// separate question. The IR has passed Ajv plus canonical SC3D semantics.
if (checkOnly) {
  const geometryParts = Object.values(ir.parts).filter((part) => part.geometry).length;
  console.log(`SC3D CHECK ONLY: ${ir.asset.id}; ${Object.keys(ir.parts).length} parts; ${geometryParts} geometry parts; ${ids.size} components`);
  console.log("Canonical schema and semantic lowering passed; no output written.");
  process.exit(0);
}

// An already committed source-exact scene may have intentionally different
// formatting or provenance-only fields. Preserve it if its actual asset,
// hierarchy, geometry and materials match the current source assembly.
let unchanged = false;
if (fs.existsSync(output)) {
  const existing = YAML.parse(fs.readFileSync(output, "utf8"));
  unchanged =
    existing?.format === merged.format &&
    existing?.asset?.id === merged.asset.id &&
    isDeepStrictEqual(existing.parts, merged.parts) &&
    isDeepStrictEqual(existing.materials ?? {}, merged.materials) &&
    isDeepStrictEqual(existing.geometry_library ?? {}, merged.geometry_library);
}

if (!unchanged) {
  fs.mkdirSync(path.dirname(output), {recursive: true});
  const temp = path.join(path.dirname(output),
    `.${path.basename(output)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, serialized, {flag: "wx"});
    fs.renameSync(temp, output);
  } finally {
    fs.rmSync(temp, {force: true});
  }
}
console.log(`SC3D scene OK: ${ir.asset.id}; ${Object.keys(ir.parts).length} parts; ${ids.size} components`);
console.log(`snapshot: ${unchanged ? "unchanged (source-exact)" : "atomically refreshed"}`);
console.log(output);
