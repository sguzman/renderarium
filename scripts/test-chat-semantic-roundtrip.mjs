#!/usr/bin/env node
/**
 * Actual SC3D semantic-lowerer compatibility with the accepted chat grammar.
 * Sources here are the frozen preview JSON records reconstructed into SC3D,
 * NOT the authoritative scene YAML. Canonical Ajv/schema validation of those
 * YAML sources is a separate, still-required integration gate.
 *
 * No dependencies, GitHub Actions, local preview or user QA.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAndLowerSc3d } from "../runtime/sc3d/semantic.mjs";
import { verifyCanonicalPrimitiveRow } from "../runtime/chat/verify-canonical-primitive.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const scenes=new Map([
  ["living-room",[87,9]],["kitchen",[149,11]],["bathroom",[139,10]],
  ["office",[104,12]],["backyard",[181,18]],["garage",[112,8]],
  ["factory",[209,16]]
]);
function vec(s,fallback){
  return s==null||s==="-" ? fallback :
    Array.isArray(s)?s.map(Number):s.split(",").map(Number);
}
function transform(translate,rotate,scale){
  return {translate:vec(translate,[0,0,0]),rotate_deg:vec(rotate,[0,0,0]),
    scale:vec(scale,[1,1,1])};
}
for(const [name,[nParts,nGroups]] of scenes){
  const preview=JSON.parse(readFileSync(resolve(root,
    "scenes/block-chibi-"+name+"-v1/preview-geometry.json"),"utf8"));
  const irInput={
    format:"scenarium-constructive-3d",version:"0.1",units:"meters",
    coordinates:{handedness:"right",up:"y",forward:"-z"},
    asset:{id:preview.scene,name:name,kind:"environment",root:"root"},
    requires:["core.primitives","core.rigid-hierarchy"],
    parts:{root:{parent:null}},materials:{},geometry_library:{}
  };
  assert.equal(preview.groups.length,nGroups);
  for(const group of preview.groups){
    irInput.parts[group.id+"__root"]={
      parent:"root",role:"component-root",
      transform:transform(group.translate,group.rotate_deg,group.scale)
    };
  }
  const rows=preview.parts.split("\n");
  assert.equal(rows.length,nParts);
  for(const [idx,row] of rows.entries()){
    const cells=row.split("|");
    assert(cells.length===8||cells.length===9,
      name+": malformed primitive "+idx);
    const [groupNo,localId,parent,kind,dims,color,tr,rot,scale]=cells;
    const group=preview.groups[Number(groupNo)];
    assert(group,name+": invalid part group "+groupNo);
    const id=group.id+"__"+localId;
    assert(!(id in irInput.parts),name+": duplicate part id "+id);
    const numeric=dims.split(",").map(Number);
    assert(numeric.every(Number.isFinite),id+": nonfinite dimension");
    const geometry=kind==="b"
      ?{kind:"cuboid",size:numeric}
      :{kind:"tapered_box",bottom:numeric.slice(0,2),
        top:numeric.slice(2,4),height:numeric[4]};
    assert(kind==="b"||kind==="t",id+": unsupported primitive");
    const mat="material__"+id;
    irInput.materials[mat]={base_color:"#"+color};
    irInput.parts[id]={
      role:"preview-composition-part",
      parent:parent==="-"?group.id+"__root":group.id+"__"+parent,
      geometry,material:mat,
      transform:transform(tr,rot,scale)
    };
  }
  // Exercise the real SC3D v0.1 parameter resolution, primitive validation,
  // cycle detection and hierarchy lowering, not a hand-coded substitute.
  const ir=validateAndLowerSc3d(irInput);
  assert.equal(ir.ir_kind,"Constructive3DIR");
  assert.equal(ir.asset.id,preview.scene);
  assert.equal(Object.values(ir.parts).filter(x=>x.geometry).length,nParts);
  for(const row of rows){
    const group=preview.groups[Number(row.split("|",1)[0])];
    verifyCanonicalPrimitiveRow(row,group,ir);
  }
  console.log("PASS "+preview.scene+": "+
    nParts+" semantic-lowered geometries and "+nGroups+
    " scene instances match chat parity rules");
}
console.log("LIMITATION: preview-derived semantic compatibility, "+
  "not canonical Ajv/YAML source validation or Three.js rendering.");
