import * as THREE from "/vendor/three.module.js";

const DEG = Math.PI / 180;

function applyTransform(object, transform = {}) {
  const t = transform.translate ?? [0, 0, 0];
  const r = transform.rotate_deg ?? [0, 0, 0];
  const s = transform.scale ?? [1, 1, 1];
  object.position.set(t[0], t[1], t[2]);
  object.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, "XYZ");
  object.scale.set(s[0], s[1], s[2]);
}

function taperedBoxGeometry(bottom, top, height) {
  const [bx, bz] = bottom.map((v) => v / 2);
  const [tx, tz] = top.map((v) => v / 2);
  const y0 = -height / 2;
  const y1 = height / 2;

  const vertices = new Float32Array([
    -bx, y0, -bz,   bx, y0, -bz,   bx, y0,  bz,  -bx, y0,  bz,
    -tx, y1, -tz,   tx, y1, -tz,   tx, y1,  tz,  -tx, y1,  tz,
  ]);

  const indices = [
    // bottom (-Y), top (+Y)
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    // front (-Z), right (+X), back (+Z), left (-X)
    0, 5, 1, 0, 4, 5,
    1, 6, 2, 1, 5, 6,
    2, 7, 3, 2, 6, 7,
    3, 4, 0, 3, 7, 4,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wedgeGeometry(size, slope) {
  const [width, height, depth] = size;
  const x0 = -width / 2;
  const x1 = width / 2;
  const y0 = -height / 2;
  const y1 = height / 2;
  const z0 = -depth / 2;
  const z1 = depth / 2;

  // SC3D v0.1 wedge: a box-like volume whose +Y surface slopes along local Z.
  // front-to-back is thick at -Z and tapers to zero height at +Z.
  const frontHigh = slope === "front-to-back";

  const frontTop = frontHigh ? y1 : y0;
  const backTop = frontHigh ? y0 : y1;

  const vertices = new Float32Array([
    x0, y0, z0,  x1, y0, z0,
    x0, y0, z1,  x1, y0, z1,
    x0, frontTop, z0, x1, frontTop, z0,
    x0, backTop, z1,  x1, backTop, z1,
  ]);

  const indices = [
    0, 3, 1, 0, 2, 3,
    0, 1, 5, 0, 5, 4,
    2, 6, 7, 2, 7, 3,
    0, 4, 6, 0, 6, 2,
    1, 3, 7, 1, 7, 5,
    4, 5, 7, 4, 7, 6,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function roundedBoxGeometry(size, radius, segments = 3) {
  const [width, height, depth] = size;
  const r = Math.min(radius, width / 2, height / 2, depth / 2);
  const innerWidth = Math.max(0.000001, width - 2 * r);
  const innerHeight = Math.max(0.000001, height - 2 * r);

  const shape = new THREE.Shape();
  const x0 = -innerWidth / 2;
  const x1 = innerWidth / 2;
  const y0 = -innerHeight / 2;
  const y1 = innerHeight / 2;

  shape.moveTo(x0, -height / 2);
  shape.lineTo(x1, -height / 2);
  shape.quadraticCurveTo(width / 2, -height / 2, width / 2, y0);
  shape.lineTo(width / 2, y1);
  shape.quadraticCurveTo(width / 2, height / 2, x1, height / 2);
  shape.lineTo(x0, height / 2);
  shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, y1);
  shape.lineTo(-width / 2, y0);
  shape.quadraticCurveTo(-width / 2, -height / 2, x0, -height / 2);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.000001, depth - 2 * r),
    bevelEnabled: r > 0,
    bevelSegments: Math.max(1, segments),
    steps: 1,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: Math.max(1, segments),
  });
  geometry.translate(0, 0, -Math.max(0.000001, depth - 2 * r) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function polygonPrismGeometry(profile, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i += 1) {
    shape.lineTo(profile[i][0], profile[i][1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function loftGeometry(sections) {
  const vertexCount = sections[0].profile.length;
  const vertices = [];
  for (const section of sections) {
    for (const [x, y] of section.profile) vertices.push(x, y, section.z);
  }

  const indices = [];
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    const aBase = sectionIndex * vertexCount;
    const bBase = (sectionIndex + 1) * vertexCount;
    for (let i = 0; i < vertexCount; i += 1) {
      const j = (i + 1) % vertexCount;
      const a = aBase + i;
      const aNext = aBase + j;
      const b = bBase + i;
      const bNext = bBase + j;
      indices.push(a, aNext, bNext, a, bNext, b);
    }
  }

  const firstContour = sections[0].profile.map(([x, y]) => new THREE.Vector2(x, y));
  const lastContour = sections.at(-1).profile.map(([x, y]) => new THREE.Vector2(x, y));
  const frontTriangles = THREE.ShapeUtils.triangulateShape(firstContour, []);
  const backTriangles = THREE.ShapeUtils.triangulateShape(lastContour, []);
  const lastBase = (sections.length - 1) * vertexCount;

  for (const [a, b, c] of frontTriangles) indices.push(c, b, a);
  for (const [a, b, c] of backTriangles) indices.push(lastBase + a, lastBase + b, lastBase + c);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ribbonPathGeometry(path, width, depth) {
  const positions = [];
  const indices = [];
  let vertexOffset = 0;
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 1; i < path.length; i += 1) {
    const a = new THREE.Vector3(...path[i - 1]);
    const b = new THREE.Vector3(...path[i]);
    const delta = b.clone().sub(a);
    const length = delta.length();
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    const direction = delta.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
    const matrix = new THREE.Matrix4().compose(
      midpoint,
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );

    const segment = new THREE.BoxGeometry(width, length, depth);
    segment.applyMatrix4(matrix);
    const pos = segment.getAttribute("position");
    const index = segment.getIndex();

    for (let v = 0; v < pos.count; v += 1) {
      positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
    }
    if (index) {
      for (let j = 0; j < index.count; j += 1) {
        indices.push(vertexOffset + index.getX(j));
      }
    } else {
      for (let j = 0; j < pos.count; j += 1) indices.push(vertexOffset + j);
    }
    vertexOffset += pos.count;
    segment.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ribbonSweepGeometry(sections, upHint = [0, 0, 1]) {
  const positions = [];
  const indices = [];
  const up = new THREE.Vector3(...upHint).normalize();
  const fallbackA = new THREE.Vector3(1, 0, 0);
  const fallbackB = new THREE.Vector3(0, 0, 1);

  function tangentAt(i) {
    if (i === 0) {
      return new THREE.Vector3(...sections[1].point)
        .sub(new THREE.Vector3(...sections[0].point))
        .normalize();
    }
    if (i === sections.length - 1) {
      return new THREE.Vector3(...sections[i].point)
        .sub(new THREE.Vector3(...sections[i - 1].point))
        .normalize();
    }
    return new THREE.Vector3(...sections[i + 1].point)
      .sub(new THREE.Vector3(...sections[i - 1].point))
      .normalize();
  }

  let previousSide = null;
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const center = new THREE.Vector3(...section.point);
    const tangent = tangentAt(i);

    let side = new THREE.Vector3().crossVectors(tangent, up);
    if (side.lengthSq() < 1e-8) {
      side = new THREE.Vector3().crossVectors(
        tangent,
        Math.abs(tangent.dot(fallbackA)) < 0.95 ? fallbackA : fallbackB,
      );
    }
    side.normalize();

    if (previousSide && side.dot(previousSide) < 0) side.multiplyScalar(-1);
    previousSide = side.clone();

    const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const hw = section.width / 2;
    const hd = section.depth / 2;

    const corners = [
      center.clone().addScaledVector(side, -hw).addScaledVector(normal, -hd),
      center.clone().addScaledVector(side, hw).addScaledVector(normal, -hd),
      center.clone().addScaledVector(side, hw).addScaledVector(normal, hd),
      center.clone().addScaledVector(side, -hw).addScaledVector(normal, hd),
    ];
    for (const p of corners) positions.push(p.x, p.y, p.z);
  }

  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = i * 4;
    const b = (i + 1) * 4;
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4;
      indices.push(a + side, a + next, b + next, a + side, b + next, b + side);
    }
  }

  indices.push(0, 3, 2, 0, 2, 1);
  const last = (sections.length - 1) * 4;
  indices.push(last, last + 1, last + 2, last, last + 2, last + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function primitiveGeometry(expr) {
  switch (expr.kind) {
    case "cuboid":
      return new THREE.BoxGeometry(expr.size[0], expr.size[1], expr.size[2]);
    case "rounded_box":
      return roundedBoxGeometry(expr.size, expr.radius, expr.segments ?? 3);
    case "sphere":
      return new THREE.SphereGeometry(expr.radius, 16, 12);
    case "ellipsoid": {
      const geometry = new THREE.SphereGeometry(1, 16, 12);
      geometry.scale(expr.radii[0], expr.radii[1], expr.radii[2]);
      return geometry;
    }
    case "cylinder":
      return new THREE.CylinderGeometry(
        expr.radius,
        expr.radius,
        expr.height,
        expr.segments ?? 12,
        1,
        false,
      );
    case "cone":
      return new THREE.CylinderGeometry(
        0,
        expr.radius,
        expr.height,
        expr.segments ?? 12,
        1,
        false,
      );
    case "tapered_box":
      return taperedBoxGeometry(expr.bottom, expr.top, expr.height);
    case "wedge":
      return wedgeGeometry(expr.size, expr.slope);
    case "polygon_prism":
      return polygonPrismGeometry(expr.profile, expr.depth);
    case "loft":
      return loftGeometry(expr.sections);
    case "ribbon_path":
      return ribbonPathGeometry(expr.path, expr.width, expr.depth);
    case "ribbon_sweep":
      return ribbonSweepGeometry(expr.sections, expr.up_hint ?? [0, 0, 1]);
    default:
      throw new Error(
        `SC3D realization unsupported in first renderer: primitive "${expr.kind}"`,
      );
  }
}

function realizeGeometry(expr, ir) {
  if (expr.ref) {
    const target = ir.geometry_library[expr.ref];
    if (!target) throw new Error(`Missing geometry ref "${expr.ref}" after validation`);
    const object = realizeGeometry(target, ir);
    applyTransform(object, expr.transform);
    return object;
  }
  if (expr.op || expr.kind === "sdf") {
    throw new Error(
      `SC3D realization unsupported in first renderer: ${expr.op ?? "sdf"}`,
    );
  }

  const mesh = new THREE.Mesh(primitiveGeometry(expr));
  applyTransform(mesh, expr.transform);
  return mesh;
}

function buildMaterials(ir) {
  return Object.fromEntries(
    Object.entries(ir.materials).map(([id, material]) => {
      const opacity = material.opacity ?? 1;
      return [
        id,
        new THREE.MeshStandardMaterial({
          color: material.base_color ?? "#b9b9b9",
          roughness: material.roughness ?? 0.9,
          metalness: material.metalness ?? 0,
          emissive: material.emissive ?? "#000000",
          emissiveIntensity: material.emissive_intensity ?? 1,
          opacity,
          transparent: opacity < 1,
          side: material.double_sided ? THREE.DoubleSide : THREE.FrontSide,
          flatShading: true,
        }),
      ];
    }),
  );
}

function vec3(value = [0, 0, 0]) {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

export function buildSc3dObject(ir) {
  const materials = buildMaterials(ir);
  const nodes = {};

  for (const [id, part] of Object.entries(ir.parts)) {
    const frame = new THREE.Group();
    frame.name = `sc3d:${id}`;
    frame.userData.sc3dPartId = id;
    frame.userData.sc3dRole = part.role ?? null;

    const pivot = vec3(part.pivot);
    const pivotNode = new THREE.Group();
    pivotNode.name = `sc3d:${id}:pivot`;
    pivotNode.position.copy(pivot);

    const localSpace = new THREE.Group();
    localSpace.name = `sc3d:${id}:local`;
    localSpace.position.copy(pivot).multiplyScalar(-1);

    const authored = part.transform ?? {};
    const rotation = authored.rotate_deg ?? [0, 0, 0];
    const scale = authored.scale ?? [1, 1, 1];
    pivotNode.rotation.set(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, "XYZ");
    pivotNode.scale.set(scale[0], scale[1], scale[2]);

    pivotNode.add(localSpace);
    frame.add(pivotNode);

    if (part.geometry && part.visible !== false) {
      const geometryObject = realizeGeometry(part.geometry, ir);
      if (part.material) {
        geometryObject.traverse((object) => {
          if (object.isMesh) {
            object.material = materials[part.material];
            object.castShadow = true;
            object.receiveShadow = true;
            object.userData.sc3dPartId = id;
          }
        });
      }
      localSpace.add(geometryObject);
    }

    nodes[id] = { frame, pivotNode, localSpace };
  }

  for (const [id, part] of Object.entries(ir.parts)) {
    const node = nodes[id];
    if (part.parent == null) continue;

    const parent = ir.parts[part.parent];
    const parentSpace = nodes[part.parent].localSpace;
    const translate = vec3(part.transform?.translate);
    let attachmentTranslate = new THREE.Vector3();

    if (part.attachment) {
      const parentAnchor = vec3(parent.anchors?.[part.attachment.parent_anchor]);
      const childAnchor = vec3(part.anchors?.[part.attachment.child_anchor]);
      const offset = vec3(part.attachment.offset);
      attachmentTranslate = parentAnchor.sub(childAnchor).add(offset);
    }

    node.frame.position.copy(attachmentTranslate.add(translate));
    parentSpace.add(node.frame);
  }

  const root = nodes[ir.asset.root].frame;
  root.userData.sc3dNodes = nodes;
  return root;
}

export function setStructureMode(root, enabled) {
  root.traverse((object) => {
    if (object.isMesh && object.material) {
      object.material.wireframe = enabled;
    }
  });
}
