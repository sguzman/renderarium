#!/usr/bin/env node
/**
 * Parse original authored SC3D YAML and compare every accepted chat preview
 * part and component against it. No source edits, snapshots or web access.
 *
 * node scripts/test-chat-authored-source-parity.mjs [--scene factory]
 *
 * Uses the repo's declared 'yaml' dependency. This is YAML content parity;
 * canonical Ajv schema validation and Three.js remain separate proof gates.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const scenes=new Map([
  ["living-room",[87,9]],["kitchen",[149,11]],["bathroom",[139,10]],
  ["office",[104,12]],["backyard",[181,18]],["garage",[112,8]],
  ["factory",[209,16]]
]);
const args=process.argv.slice(2);
assert(args.length===0 ||
  (args.length===2 && args[0]==="--scene" && scenes.has(args[1])),
  "usage: node scripts/test-chat-authored-source-parity.mjs [--scene accepted-name]");
const chosen=args.length?[args[1]]:[...scenes.keys()];
function bytes(path){
  const abs=resolve(root,path);
  assert(abs.startsWith(root+sep),"asset escapes repo: "+path);
  return readFileSync(abs);
}
function blob(path){
  const data=bytes(path);
  return createHash("sha1").update("blob "+data.length+"\0")
    .update(data).digest("hex");
}
function v(input,defaults,label){
  const out=input==null||input==="-" ? defaults :
    Array.isArray(input)?input:String(input).split(",").map(Number);
  assert(Array.isArray(out)&&out.length===defaults.length&&
    out.every(Number.isFinite),label+": invalid vector");
  return out;
}
function same(a,b,label){
  assert.equal(a.length,b.length,label+": dimension mismatch");
  for(let i=0;i<a.length;i++)assert(Math.abs(a[i]-b[i])<1e-5,
    label+"["+i+"]: source-to-chat numerical drift");
}
function transforms(source,chat,label){
  for(const [key,defaults] of [
    ["translate",[0,0,0]],["rotate_deg",[0,0,0]],["scale",[1,1,1]]
  ]){
    same(v(source?.[key],defaults,label+" authored "+key),
      v(chat?.[key],defaults,label+" chat "+key),label+" "+key);
  }
}
function geometry(g,id){
  assert(g&&typeof g==="object",id+": missing geometry");
  assert(!g.ref&&!g.op&&!g.transform,
    id+": unsupported inline geometry operation/reference");
  if(g.kind==="cuboid")return ["b",g.size];
  if(g.kind==="tapered_box")return [
    "t",[...g.bottom,...g.top,g.height]
  ];
  throw new Error(id+": unsupported geometry kind "+g.kind);
}
let total=0,instances=0;
for(const name of chosen) {
  const id="block-chibi-"+name+"-v1";
  const previewPath="scenes/"+id+"/preview-geometry.json";
  const spec=JSON.parse(bytes(previewPath));
  const assemblyPath="scenes/"+id+"/room.assembly.yml";
  assert.equal(spec.scene,id);
  assert.equal(spec.source_assembly,assemblyPath);
  assert.equal(spec.source_assembly_blob,blob(assemblyPath),
    id+": assembly blob pin drift");
  const manifest=YAML.parse(bytes(assemblyPath).toString("utf8"));
  const [numParts,numGroups]=scenes.get(name);
  assert.equal(manifest.id,id);
  assert.equal(manifest.components.length,numGroups);
  assert.equal(spec.groups.length,numGroups);
  const rows=spec.parts.split("\n");
  assert.equal(rows.length,numParts);
  const byGroup=new Map(spec.groups.map(group=>[group.index,[]]));
  for(const row of rows){
    const cells=row.split("|");
    assert(cells.length===8||cells.length===9,id+": invalid part row arity");
    const index=Number(cells[0]);
    assert(byGroup.has(index),id+": unknown part component");
    byGroup.get(index).push(cells);
  }
  for(const [index,group] of spec.groups.entries()){
    const component=manifest.components[index];
    assert.equal(group.index,index,id+": component order drift");
    assert.equal(component.id,group.id,id+": component ID drift");
    assert.equal(component.asset,group.source,id+": component path drift");
    assert.equal(group.source_blob??group.source_sha,blob(group.source),
      id+": source Git blob revision changed: "+group.source);
    transforms(component.transform,group,id+"/"+group.id);
    const source=YAML.parse(bytes(group.source).toString("utf8"));
    assert.equal(source.format,"scenarium-constructive-3d");
    const sourceRoot=source.asset.root;
    const rootPart=source.parts[sourceRoot];
    assert(rootPart && !rootPart.geometry && !rootPart.transform,
      id+": unsupported source root geometry/transform");
    const sourceGeometry=Object.entries(source.parts)
      .filter(([,part])=>part.geometry);
    const componentRows=byGroup.get(index);
    assert.equal(sourceGeometry.length,componentRows.length,
      id+"/"+group.id+": missing or additional authored primitives");
    const visited=new Set();
    for(const cells of componentRows){
      const [_,localId,parent,type,dims,hex,tr,rot,scale]=cells;
      assert(!visited.has(localId),id+": duplicate part "+localId);
      visited.add(localId);
      const part=source.parts[localId];
      assert(part?.geometry,id+": unknown geometric part "+localId);
      assert.equal(part.parent,parent==="-"?sourceRoot:parent,
        id+"/"+localId+": authored parent mismatch");
      assert(part.visible!==false && !part.pivot && !part.attachment,
        id+"/"+localId+": unsupported rendering semantics");
      const [kind,dimensions]=geometry(part.geometry,id+"/"+localId);
      assert.equal(kind,type,id+"/"+localId+": primitive kind mismatch");
      same(dimensions,v(dims,Array(dimensions.length).fill(0),
        id+"/"+localId+" geometry"),id+"/"+localId+" dimensions");
      assert.equal(source.materials?.[part.material]?.base_color?.toLowerCase(),
        "#"+hex.toLowerCase(),id+"/"+localId+": material color drift");
      transforms(part.transform,{
        translate:tr,rotate_deg:rot,scale:scale??"-"
      },id+"/"+localId);
      total++;
    }
    for(const [localId,part] of sourceGeometry)
      assert(visited.has(localId),
        id+"/"+group.id+": authored part missing from chat: "+localId);
    instances++;
  }
  console.log("PASS "+id+": "+numParts+
    " authored geometries and "+numGroups+" placements match frozen chat");
}
console.log("PASS "+total+" geometry rows and "+instances+
  " component instances checked against source YAML; not a Three.js render.");
