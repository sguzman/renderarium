#!/usr/bin/env node
/**
 * Verify the REAL production Three.js adapter against the accepted portable
 * source-bound geometry, without a browser, WebGL or a new visual verdict.
 *
 * Uses the existing three/yaml/ajv dependencies and canonical SC3D assembler.
 * The browser adapter is evaluated unchanged apart from rebinding its single
 * browser-only vendor import to the same installed Three.js ESM package.
 *
 * This is runtime Three.js GEOMETRY and triangle-winding parity, not WebGL or rendered pixel parity.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { realizeChatScene } from "../runtime/chat/scene-preview-core.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const scenes=["living-room","kitchen","bathroom","office","backyard","garage","factory"];
const adapterPath=resolve(root,"runtime/sc3d/three-adapter-browser.mjs");
const adapterSource=readFileSync(adapterPath,"utf8");
const vendor='from "/vendor/three.module.js"';
assert.equal(adapterSource.split(vendor).length,2,
  "production adapter must have exactly one known Three.js browser import");
const threeUrl=import.meta.resolve("three");
const nodeSource=adapterSource.replace(vendor,"from "+JSON.stringify(threeUrl));
const {buildSc3dObject}=await import("data:text/javascript;base64,"+
  Buffer.from(nodeSource).toString("base64"));
assert.equal(typeof buildSc3dObject,"function");

const args=process.argv.slice(2);
assert(args.length===0||
  (args.length===2&&args[0]==="--scene"&&scenes.includes(args[1])),
  "usage: node scripts/test-chat-three-adapter-parity.mjs [--scene accepted-name]");
const chosen=args.length?[args[1]]:scenes;
const tolerance=1e-4;
function approximately(a,b){
  return Math.abs(a[0]-b[0])<tolerance&&
    Math.abs(a[1]-b[1])<tolerance&&Math.abs(a[2]-b[2])<tolerance;
}
let meshes=0,vertices=0;
for(const name of chosen){
  const id="block-chibi-"+name+"-v1";
  const preview=JSON.parse(readFileSync(resolve(root,
    "scenes",id,"preview-geometry.json"),"utf8"));
  const assembly="scenes/"+id+"/room.assembly.yml";
  // This must come from canonical YAML/Ajv/SC3D lowering, not reassembled
  // preview JSON or an independently invented substitute.
  const ir=JSON.parse(execFileSync(process.execPath,[
    resolve(root,"scripts/assemble-sc3d-scene.mjs"),
    "--emit-ir-json",assembly
  ],{cwd:root,encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024}));
  assert.equal(ir.asset.id,id);
  const world=buildSc3dObject(ir);
  world.updateMatrixWorld(true);
  const nodes=world.userData.sc3dNodes;
  assert(nodes&&typeof nodes==="object","production Three.js nodes missing");
  const portable=realizeChatScene(preview);
  const rows=preview.parts.split("\n");
  assert.equal(rows.length,portable.objects.length);
  assert.equal(Object.values(ir.parts).filter(part=>part.geometry).length,
    rows.length,"canonical geometry count changed");
  let sceneVertices=0;
  for(let index=0;index<rows.length;index++){
    const [groupNo,localId,,kind]=rows[index].split("|");
    const group=preview.groups[Number(groupNo)];
    assert(group,id+": invalid accepted group "+groupNo);
    const fullId=group.id+"__"+localId;
    const node=nodes[fullId];
    assert(node,id+": missing Three.js hierarchy node "+fullId);
    // Descendant part frames also live below this localSpace. Only inspect
    // geometry directly attached to this particular canonical part.
    const found=node.localSpace.children.filter(obj=>obj.isMesh);
    assert.equal(found.length,1,id+"/"+fullId+": unsupported mesh topology");
    const mesh=found[0];
    assert(mesh.geometry?.getAttribute("position"),
      id+"/"+fullId+": missing Three.js vertex data");
    const attribute=mesh.geometry.getAttribute("position");
    const produced=[];
    for(let k=0;k<attribute.count;k++){
      const pos=new THREE.Vector3().fromBufferAttribute(attribute,k);
      mesh.localToWorld(pos);
      const vertex=[pos.x,pos.y,pos.z];
      assert(vertex.every(Number.isFinite),
        id+"/"+fullId+": Three.js nonfinite vertex");
      if(!produced.some(other=>approximately(other,vertex)))produced.push(vertex);
    }
    assert.equal(produced.length,8,
      id+"/"+fullId+": expected eight geometric corner positions");
    // Vertex agreement alone cannot detect inward-facing polygons. Both
    // supported primitives are convex, so every geometric triangle must
    // face away from the local solid centre. Catch inverted index winding
    // before a WebGL backface-culling/rendering diagnostic is attempted.
    const indices=mesh.geometry.getIndex();
    const triangleCount=(indices?.count??attribute.count)/3;
    assert.equal(triangleCount,12,
      id+"/"+fullId+": expected twelve surface triangles");
    const getVertex=n=>new THREE.Vector3().fromBufferAttribute(attribute,
      indices?indices.getX(n):n);
    for(let triangle=0;triangle<triangleCount;triangle++){
      const v0=getVertex(3*triangle),v1=getVertex(3*triangle+1),
        v2=getVertex(3*triangle+2);
      const normal=new THREE.Vector3().subVectors(v1,v0)
        .cross(new THREE.Vector3().subVectors(v2,v0));
      const midpoint=v0.clone().add(v1).add(v2).multiplyScalar(1/3);
      assert(Number.isFinite(normal.dot(midpoint))&&normal.dot(midpoint)>0,
        id+"/"+fullId+": inward/degenerate triangle winding "+triangle);
    }

    const expected=portable.objects[index].faces.slice(0,2)
      .flatMap(face=>face.vertices);
    assert.equal(expected.length,8);
    for(const vertex of expected){
      assert(produced.some(actual=>approximately(actual,vertex)),
        id+"/"+fullId+": Three.js/portable world-coordinate drift at "+vertex);
      sceneVertices++;
    }
    assert(kind==="b"||kind==="t",id+": unsupported accepted shape");
    const material=mesh.material;
    assert(material?.isMeshStandardMaterial,
      id+"/"+fullId+": production adapter material is not MeshStandardMaterial");
    const authoredColor=rows[index].split("|")[5].toLowerCase();
    assert.equal(material.color.getHexString().toLowerCase(),authoredColor,
      id+"/"+fullId+": Three.js material base color drift");
    meshes++;
  }
  vertices+=sceneVertices;
  console.log("PASS "+id+": "+rows.length+" actual Three.js meshes, "+
    sceneVertices+" source-bound world vertex comparisons");
}
console.log("PASS "+meshes+" Three.js meshes and "+vertices+
  " vertex comparisons against frozen alternate geometry.");
console.log("NOT TESTED: browser, WebGL, GPU acceleration, shaders, raster "+
  "pixels or actual ChatGPT-host delivery.");
