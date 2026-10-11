#!/usr/bin/env node
/**
 * Independently test SC3D primitive parity and fail-closed material rules.
 * No scene snapshots, private Actions, Three.js or user QA required.
 */
import assert from "node:assert/strict";
import { verifyCanonicalPrimitiveRow } from "../runtime/chat/verify-canonical-primitive.mjs";

const group={index:0,id:"test"};
const ir={
  parts:{
    root:{parent:null},
    test__root:{parent:"root",role:"component-root"},
    test__plank:{parent:"test__root",geometry:{ref:"boxA"},
      material:"oak",transform:{translate:[1,0,0]}}
  },
  geometry_library:{boxA:{kind:"cuboid",size:[2,.2,1]}},
  materials:{oak:{base_color:"#bbaa99",roughness:.9}}
};
const row="0|plank|-|b|2,.2,1|bbaa99|1,0,0|-|-";
const valid=verifyCanonicalPrimitiveRow(row,group,ir);
assert.equal(valid.fullId,"test__plank");
assert.deepEqual(valid.materialEffectsNotRendered,[]);
function bad(label,alter){
  const item=structuredClone(ir);
  let record=row;
  const setRecord=r=>{record=r;};
  alter(item,setRecord);
  assert.throws(()=>verifyCanonicalPrimitiveRow(record,group,item),
    label+" did not fail closed");
}
bad("missing ancestor",x=>{delete x.parts.test__root;});
bad("spoofed component root",x=>{
  x.parts.disguised__root={parent:"test__root",transform:{translate:[.2,0,0]}};
  x.parts.test__plank.parent="disguised__root";
});
bad("component root no longer directly below scene",x=>{
  x.parts.test__root.parent="injected";
  x.parts.injected={parent:"root"};
});
bad("hidden ancestor",x=>{x.parts.test__root.visible=false;});
bad("ancestor pivot",x=>{x.parts.test__root.pivot=[0,0,0];});
bad("ancestor attachment",x=>{x.parts.test__root.attachment={parent_anchor:"a",child_anchor:"b"};});
bad("cycle",x=>{x.parts.test__root.parent="test__plank";});
bad("unknown ref",x=>{x.parts.test__plank.geometry.ref="nonexistent";});
bad("ref cycle",x=>{x.geometry_library.boxA={ref:"boxA"};});
bad("ref transform",x=>{x.parts.test__plank.geometry.transform={translate:[1,0,0]};});
bad("CSG operator",x=>{x.parts.test__plank.geometry={op:"union",children:[]};});
bad("unsupported sphere",x=>{x.parts.test__plank.geometry={kind:"sphere",radius:1};});
bad("missing material",x=>{delete x.materials.oak;});
bad("opacity",x=>{x.materials.oak.opacity=.5;});
bad("double sided",x=>{x.materials.oak.double_sided=true;});
bad("eight-digit base color",x=>{x.materials.oak.base_color="#bbaa99ff";});
bad("dimension drift",(x,set)=>set(row.replace("2,.2,1","3,.2,1")));
bad("color drift",(x,set)=>set(row.replace("bbaa99","aa8899")));
bad("translation drift",(x,set)=>set(row.replace("1,0,0","2,0,0")));
bad("parent drift",(x,set)=>set(row.replace("|-|b|","|wrong|b|")));
bad("group drift",(x,set)=>set("1"+row.slice(1)));
bad("invalid primitive row",(x,set)=>set("bad-data"));
const emissive=structuredClone(ir);
emissive.materials.oak.emissive="#ff8855";
emissive.materials.oak.emissive_intensity=2;
emissive.materials.oak.metalness=.4;
assert.deepEqual(
  verifyCanonicalPrimitiveRow(row,group,emissive).materialEffectsNotRendered,
  ["emissive","metalness"],
  "supported source effects must be disclosed, not treated as rendered");
console.log("PASS canonical primitive parity, 22 rejection cases, "+
  "emissive/metalness disclosure; no rendering approval implied");
