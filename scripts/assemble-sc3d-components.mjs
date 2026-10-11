import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

function usage() {
  console.error("usage: node scripts/assemble-sc3d-components.mjs <assembly.yml>");
  process.exit(2);
}

function rewriteGeometry(value, geometryPrefix) {
  if (Array.isArray(value)) return value.map((item) => rewriteGeometry(item, geometryPrefix));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "ref" && typeof item === "string") {
      out[key] = `${geometryPrefix}${item}`;
    } else {
      out[key] = rewriteGeometry(item, geometryPrefix);
    }
  }
  return out;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const manifestPath = process.argv[2];
if (!manifestPath) usage();

const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest?.format !== "scenarium-reference-fit-component-assembly") {
  throw new Error("not a Scenarium reference-fit component assembly");
}
if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
  throw new Error("assembly requires at least one component");
}

const cwd = process.cwd();
const merged = {
  format: "scenarium-constructive-3d",
  version: "0.1",
  units: "meters",
  coordinates: { handedness: "right", up: "y", forward: "-z" },
  asset: {
    id: manifest.id.replace(/^assembly:/, ""),
    name: manifest.id,
    kind: "character",
    root: "root",
    description: "Deterministic assembly of independently authored reference-fit components.",
    tags: ["reference-fit", "generated-assembly"],
  },
  requires: ["core.primitives", "core.rigid-hierarchy"],
  materials: {},
  geometry_library: {},
  parts: {
    root: { role: "root", parent: null, articulation: "static" },
  },
  extensions: {
    scenarium_reference_fit: {
      assembly_manifest: path.relative(cwd, manifestPath),
      source_components: [],
      generated: true,
      canonical: false,
    },
  },
};

for (const component of manifest.components) {
  const sourcePath = path.resolve(cwd, component.asset);
  const source = YAML.parse(fs.readFileSync(sourcePath, "utf8"));
  if (source?.format !== "scenarium-constructive-3d") {
    throw new Error(`component ${component.id} is not SC3D: ${component.asset}`);
  }

  const prefix = `${component.id}__`;
  const materialPrefix = `${prefix}mat__`;
  const geometryPrefix = `${prefix}geom__`;
  const componentRootId = `${prefix}root`;

  merged.parts[componentRootId] = {
    role: "component-root",
    parent: "root",
    transform: structuredClone(component.transform ?? {}),
    articulation: "static",
    extensions: {
      source_component_id: component.id,
      source_asset: component.asset,
    },
  };

  for (const [id, material] of Object.entries(source.materials ?? {})) {
    const target = `${materialPrefix}${id}`;
    if (merged.materials[target] && !sameJson(merged.materials[target], material)) {
      throw new Error(`material collision at ${target}`);
    }
    merged.materials[target] = material;
  }

  for (const [id, geometry] of Object.entries(source.geometry_library ?? {})) {
    merged.geometry_library[`${geometryPrefix}${id}`] =
      rewriteGeometry(geometry, geometryPrefix);
  }

  const sourceRoot = source.asset?.root ?? "root";
  for (const [id, part] of Object.entries(source.parts ?? {})) {
    if (id === sourceRoot) continue;
    const targetId = `${prefix}${id}`;
    const next = structuredClone(part);
    next.parent =
      next.parent == null || next.parent === sourceRoot
        ? componentRootId
        : `${prefix}${next.parent}`;
    if (next.material) next.material = `${materialPrefix}${next.material}`;
    if (next.geometry) next.geometry = rewriteGeometry(next.geometry, geometryPrefix);
    merged.parts[targetId] = next;
  }

  merged.extensions.scenarium_reference_fit.source_components.push({
    id: component.id,
    asset: component.asset,
    component_transform: structuredClone(component.transform ?? {}),
  });
}

const output = manifest.generated_output?.path;
if (!output) throw new Error("assembly manifest requires generated_output.path");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, YAML.stringify(merged), "utf8");
console.log(output);
