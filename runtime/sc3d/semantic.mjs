import { fail } from "./errors.mjs";

export const CORE_CAPABILITIES = new Set([
  "core.primitives",
  "core.rigid-hierarchy",
]);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isParamRef(value) {
  return isObject(value) &&
    Object.keys(value).length === 1 &&
    typeof value.param === "string";
}

function resolveScalar(value, env, path) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("SC3D-E208", "number must be finite", path);
    return value;
  }
  if (isParamRef(value)) {
    if (!(value.param in env)) {
      fail("SC3D-E205", `unresolved parameter "${value.param}"`, path);
    }
    return env[value.param];
  }
  fail("SC3D-E208", "expected a number or parameter reference", path);
}

function resolveTree(value, env, path = "$") {
  if (isParamRef(value)) return resolveScalar(value, env, path);
  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveTree(entry, env, `${path}[${index}]`));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveTree(entry, env, `${path}.${key}`),
      ]),
    );
  }
  return value;
}

function positive(value, path) {
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
    fail("SC3D-E208", "value must be a finite positive number", path);
  }
}

function finiteVec(value, length, path, { nonZero = false, positiveOnly = false } = {}) {
  if (!Array.isArray(value) || value.length !== length) {
    fail("SC3D-E208", `expected a ${length}-vector`, path);
  }
  value.forEach((n, index) => {
    if (!(typeof n === "number" && Number.isFinite(n))) {
      fail("SC3D-E208", "vector component must be finite", `${path}[${index}]`);
    }
    if (positiveOnly && n <= 0) {
      fail("SC3D-E208", "vector component must be positive", `${path}[${index}]`);
    }
    if (nonZero && n === 0) {
      fail("SC3D-E208", "scale component must be non-zero", `${path}[${index}]`);
    }
  });
}

function validateTransform(transform, path) {
  if (!transform) return;
  if (transform.translate) finiteVec(transform.translate, 3, `${path}.translate`);
  if (transform.rotate_deg) finiteVec(transform.rotate_deg, 3, `${path}.rotate_deg`);
  if (transform.scale) finiteVec(transform.scale, 3, `${path}.scale`, { nonZero: true });
}

function validatePrimitive(expr, path) {
  switch (expr.kind) {
    case "cuboid":
      finiteVec(expr.size, 3, `${path}.size`, { positiveOnly: true });
      break;
    case "rounded_box":
      finiteVec(expr.size, 3, `${path}.size`, { positiveOnly: true });
      positive(expr.radius, `${path}.radius`);
      if (expr.radius > Math.min(...expr.size) / 2) {
        fail("SC3D-E209", "rounded-box radius exceeds half the smallest dimension", `${path}.radius`);
      }
      break;
    case "sphere":
      positive(expr.radius, `${path}.radius`);
      break;
    case "ellipsoid":
      finiteVec(expr.radii, 3, `${path}.radii`, { positiveOnly: true });
      break;
    case "cylinder":
    case "cone":
      positive(expr.radius, `${path}.radius`);
      positive(expr.height, `${path}.height`);
      break;
    case "capsule":
      positive(expr.radius, `${path}.radius`);
      positive(expr.length, `${path}.length`);
      break;
    case "tapered_box":
      finiteVec(expr.bottom, 2, `${path}.bottom`, { positiveOnly: true });
      finiteVec(expr.top, 2, `${path}.top`, { positiveOnly: true });
      positive(expr.height, `${path}.height`);
      break;
    case "wedge":
      finiteVec(expr.size, 3, `${path}.size`, { positiveOnly: true });
      break;
    case "polygon_prism":
      if (!Array.isArray(expr.profile) || expr.profile.length < 3) {
        fail("SC3D-E208", "polygon_prism requires at least three profile vertices", `${path}.profile`);
      }
      expr.profile.forEach((point, index) =>
        finiteVec(point, 2, `${path}.profile[${index}]`));
      positive(expr.depth, `${path}.depth`);
      break;
    case "loft": {
      if (!Array.isArray(expr.sections) || expr.sections.length < 2) {
        fail("SC3D-E208", "loft requires at least two sections", `${path}.sections`);
      }
      let expectedCount = null;
      let previousZ = null;
      expr.sections.forEach((section, sectionIndex) => {
        const sectionPath = `${path}.sections[${sectionIndex}]`;
        if (!(typeof section.z === "number" && Number.isFinite(section.z))) {
          fail("SC3D-E208", "loft section z must be finite", `${sectionPath}.z`);
        }
        if (previousZ !== null && !(section.z > previousZ)) {
          fail("SC3D-E208", "loft section z values must be strictly increasing", `${sectionPath}.z`);
        }
        previousZ = section.z;
        if (!Array.isArray(section.profile) || section.profile.length < 3) {
          fail("SC3D-E208", "loft section requires at least three profile vertices", `${sectionPath}.profile`);
        }
        if (expectedCount === null) expectedCount = section.profile.length;
        if (section.profile.length !== expectedCount) {
          fail("SC3D-E208", "all loft profiles must have the same vertex count", `${sectionPath}.profile`);
        }
        section.profile.forEach((point, pointIndex) =>
          finiteVec(point, 2, `${sectionPath}.profile[${pointIndex}]`));
      });
      break;
    }
    case "ribbon_path": {
      if (!Array.isArray(expr.path) || expr.path.length < 2) {
        fail("SC3D-E208", "ribbon_path requires at least two path points", `${path}.path`);
      }
      expr.path.forEach((point, pointIndex) =>
        finiteVec(point, 3, `${path}.path[${pointIndex}]`));
      for (let i = 1; i < expr.path.length; i += 1) {
        const a = expr.path[i - 1];
        const b = expr.path[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        if (dx * dx + dy * dy + dz * dz <= 1e-12) {
          fail("SC3D-E208", "ribbon_path consecutive points must be distinct", `${path}.path[${i}]`);
        }
      }
      positive(expr.width, `${path}.width`);
      positive(expr.depth, `${path}.depth`);
      break;
    }
    case "ribbon_sweep": {
      if (!Array.isArray(expr.sections) || expr.sections.length < 2) {
        fail("SC3D-E208", "ribbon_sweep requires at least two sections", `${path}.sections`);
      }
      expr.sections.forEach((section, sectionIndex) => {
        const sectionPath = `${path}.sections[${sectionIndex}]`;
        finiteVec(section.point, 3, `${sectionPath}.point`);
        positive(section.width, `${sectionPath}.width`);
        positive(section.depth, `${sectionPath}.depth`);
      });
      for (let i = 1; i < expr.sections.length; i += 1) {
        const a = expr.sections[i - 1].point;
        const b = expr.sections[i].point;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        if (dx * dx + dy * dy + dz * dz <= 1e-12) {
          fail("SC3D-E208", "ribbon_sweep consecutive points must be distinct", `${path}.sections[${i}].point`);
        }
      }
      if (expr.up_hint !== undefined) {
        finiteVec(expr.up_hint, 3, `${path}.up_hint`);
        const [x, y, z] = expr.up_hint;
        if (x * x + y * y + z * z <= 1e-12) {
          fail("SC3D-E208", "ribbon_sweep up_hint must be non-zero", `${path}.up_hint`);
        }
      }
      break;
    }
    default:
      fail("SC3D-E208", `unknown primitive kind "${expr.kind}"`, path);
  }
  validateTransform(expr.transform, `${path}.transform`);
}

function validateSdf(field, path) {
  if (field.op) {
    if (["union", "intersection", "smooth_union", "smooth_intersection"].includes(field.op)) {
      if (!Array.isArray(field.children) || field.children.length < 2) {
        fail("SC3D-E210", `${field.op} requires at least two children`, `${path}.children`);
      }
      if (field.op.startsWith("smooth_")) positive(field.radius, `${path}.radius`);
      field.children.forEach((child, index) => validateSdf(child, `${path}.children[${index}]`));
    } else if (["difference", "smooth_difference"].includes(field.op)) {
      if (field.op === "smooth_difference") positive(field.radius, `${path}.radius`);
      validateSdf(field.base, `${path}.base`);
      if (!Array.isArray(field.subtract) || field.subtract.length < 1) {
        fail("SC3D-E210", `${field.op} requires at least one subtract operand`, `${path}.subtract`);
      }
      field.subtract.forEach((child, index) => validateSdf(child, `${path}.subtract[${index}]`));
    } else {
      fail("SC3D-E211", `unsupported SDF operator "${field.op}"`, path);
    }
    validateTransform(field.transform, `${path}.transform`);
    return;
  }
  validatePrimitive(field, path);
}

function validateGeometry(expr, path, geometryLibrary) {
  if (expr.ref) {
    if (!(expr.ref in geometryLibrary)) {
      fail("SC3D-E201", `unresolved geometry reference "${expr.ref}"`, `${path}.ref`);
    }
    validateTransform(expr.transform, `${path}.transform`);
    return;
  }

  if (expr.op) {
    if (["union", "intersection"].includes(expr.op)) {
      if (!Array.isArray(expr.children) || expr.children.length < 2) {
        fail("SC3D-E210", `${expr.op} requires at least two children`, `${path}.children`);
      }
      expr.children.forEach((child, index) =>
        validateGeometry(child, `${path}.children[${index}]`, geometryLibrary));
    } else if (expr.op === "difference") {
      validateGeometry(expr.base, `${path}.base`, geometryLibrary);
      if (!Array.isArray(expr.subtract) || expr.subtract.length < 1) {
        fail("SC3D-E210", "difference requires at least one subtract operand", `${path}.subtract`);
      }
      expr.subtract.forEach((child, index) =>
        validateGeometry(child, `${path}.subtract[${index}]`, geometryLibrary));
    } else {
      fail("SC3D-E210", `unknown CSG operator "${expr.op}"`, path);
    }
    validateTransform(expr.transform, `${path}.transform`);
    return;
  }

  if (expr.kind === "sdf") {
    validateSdf(expr.field, `${path}.field`);
    if (expr.realization?.bounds) {
      const min = expr.realization.bounds.min;
      const max = expr.realization.bounds.max;
      finiteVec(min, 3, `${path}.realization.bounds.min`);
      finiteVec(max, 3, `${path}.realization.bounds.max`);
      for (let i = 0; i < 3; i += 1) {
        if (!(min[i] < max[i])) {
          fail("SC3D-E211", "SDF bounds require min < max on every axis", `${path}.realization.bounds`);
        }
      }
    }
    if (expr.realization?.target_cell_size !== undefined) {
      positive(expr.realization.target_cell_size, `${path}.realization.target_cell_size`);
    }
    validateTransform(expr.transform, `${path}.transform`);
    return;
  }

  validatePrimitive(expr, path);
}

function detectCycles(parts) {
  const visiting = new Set();
  const visited = new Set();

  function visit(id, trail) {
    if (visiting.has(id)) {
      fail("SC3D-E202", `hierarchy cycle: ${[...trail, id].join(" -> ")}`, `$.parts.${id}.parent`);
    }
    if (visited.has(id)) return;

    visiting.add(id);
    const parent = parts[id]?.parent;
    if (parent != null) visit(parent, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }

  Object.keys(parts).forEach((id) => visit(id, []));
}

export function validateAndLowerSc3d(document, {
  supportedCapabilities = CORE_CAPABILITIES,
} = {}) {
  const requirements = document.requires ?? [];
  for (const requirement of requirements) {
    if (!supportedCapabilities.has(requirement)) {
      fail("SC3D-E212", `unsupported required capability "${requirement}"`, "$.requires");
    }
  }

  const parameterEnv = {};
  for (const [name, definition] of Object.entries(document.parameters ?? {})) {
    const value = definition.default;
    if (!Number.isFinite(value)) {
      fail("SC3D-E208", "parameter default must be finite", `$.parameters.${name}.default`);
    }
    if (definition.min !== undefined && value < definition.min) {
      fail("SC3D-E208", "parameter default is below min", `$.parameters.${name}.default`);
    }
    if (definition.max !== undefined && value > definition.max) {
      fail("SC3D-E208", "parameter default is above max", `$.parameters.${name}.default`);
    }
    parameterEnv[name] = value;
  }

  const geometryLibrary = resolveTree(document.geometry_library ?? {}, parameterEnv, "$.geometry_library");
  const parts = resolveTree(document.parts ?? {}, parameterEnv, "$.parts");

  const root = document.asset.root;
  if (!(root in parts)) {
    fail("SC3D-E203", `asset root "${root}" does not name an existing part`, "$.asset.root");
  }
  if (parts[root].parent != null) {
    fail("SC3D-E203", "asset root must not have a parent", `$.parts.${root}.parent`);
  }

  for (const [id, part] of Object.entries(parts)) {
    const path = `$.parts.${id}`;
    if (id !== root && part.parent == null) {
      fail("SC3D-E201", "non-root part must declare a parent", `${path}.parent`);
    }
    if (part.parent != null && !(part.parent in parts)) {
      fail("SC3D-E201", `unknown parent part "${part.parent}"`, `${path}.parent`);
    }
    if (part.material && !(part.material in (document.materials ?? {}))) {
      fail("SC3D-E204", `unresolved material "${part.material}"`, `${path}.material`);
    }

    validateTransform(part.transform, `${path}.transform`);
    if (part.pivot) finiteVec(part.pivot, 3, `${path}.pivot`);
    for (const [anchorName, anchor] of Object.entries(part.anchors ?? {})) {
      finiteVec(anchor, 3, `${path}.anchors.${anchorName}`);
    }

    if (part.attachment) {
      if (part.parent == null) {
        fail("SC3D-E206", "root/unparented part cannot declare an attachment", `${path}.attachment`);
      }
      const parent = parts[part.parent];
      if (!(part.attachment.parent_anchor in (parent.anchors ?? {}))) {
        fail(
          "SC3D-E206",
          `parent "${part.parent}" has no anchor "${part.attachment.parent_anchor}"`,
          `${path}.attachment.parent_anchor`,
        );
      }
      if (!(part.attachment.child_anchor in (part.anchors ?? {}))) {
        fail(
          "SC3D-E207",
          `part "${id}" has no anchor "${part.attachment.child_anchor}"`,
          `${path}.attachment.child_anchor`,
        );
      }
      if (part.attachment.offset) {
        finiteVec(part.attachment.offset, 3, `${path}.attachment.offset`);
      }
    }

    if (part.geometry) validateGeometry(part.geometry, `${path}.geometry`, geometryLibrary);
  }

  detectCycles(parts);

  for (const [name, geometry] of Object.entries(geometryLibrary)) {
    validateGeometry(geometry, `$.geometry_library.${name}`, geometryLibrary);
  }

  const childrenByPart = Object.fromEntries(Object.keys(parts).map((id) => [id, []]));
  for (const [id, part] of Object.entries(parts)) {
    if (part.parent != null) childrenByPart[part.parent].push(id);
  }

  return {
    ir_kind: "Constructive3DIR",
    format: document.format,
    version: document.version,
    units: document.units,
    coordinates: document.coordinates,
    asset: document.asset,
    requirements,
    parameter_environment: parameterEnv,
    materials: document.materials ?? {},
    geometry_library: geometryLibrary,
    parts,
    children_by_part: childrenByPart,
  };
}
