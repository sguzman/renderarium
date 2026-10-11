import assert from "node:assert/strict";
import { assertCanonicalChatAncestry } from "./verify-canonical-ancestry.mjs";

/**
 * Pure fail-closed source-bound geometry / material parity check.
 * IR is the output of canonical SC3D semantic lowering; no filesystem,
 * YAML parser, GitHub Actions, renderer or generated snapshot involved.
 */
function finiteVector(value, defaults, label) {
  const a=value==null||value==="-" ? defaults :
    Array.isArray(value)?value:String(value).split(",").map(Number);
  assert(Array.isArray(a)&&a.length===defaults.length&&a.every(Number.isFinite),
    label+": invalid finite vector");
  return a;
}
function same(a,b,label){
  assert.equal(a.length,b.length,label+": dimension count drift");
  for(let i=0;i<a.length;i++)assert(Math.abs(a[i]-b[i])<1e-5,
    label+"["+i+"]: numerical drift");
}
function shape(geometry,library,trail=[]) {
  assert(geometry&&typeof geometry==="object","missing canonical geometry");
  if (geometry.ref) {
    assert(!geometry.transform,"unsupported geometry reference transform");
    assert(!trail.includes(geometry.ref),"geometry library cycle");
    assert(library?.[geometry.ref],"missing geometry library ref");
    return shape(library[geometry.ref],library,[...trail,geometry.ref]);
  }
  assert(!geometry.op&&!geometry.transform,"compound/transformed geometry unsupported");
  if(geometry.kind==="cuboid")return {type:"b",dims:geometry.size};
  if(geometry.kind==="tapered_box")return {
    type:"t",dims:[...geometry.bottom,...geometry.top,geometry.height]
  };
  throw new Error("unsupported canonical primitive: "+geometry.kind);
}
export function verifyCanonicalPrimitiveRow(row,group,ir) {
  const cells=row.split("|");
  assert(cells.length===8||cells.length===9,"invalid chat primitive arity");
  const [number,id,parent,type,dims,hex,translate,rotate,scale]=cells;
  assert(group&&Number(number)===group.index&&/^\d+$/.test(number),
    "invalid source component index");
  assert(/^[A-Za-z_][\w.-]*$/.test(id),"invalid primitive identity");
  const fullId=group.id+"__"+id;
  const part=ir.parts?.[fullId];
  assert(part?.geometry,"missing canonical geometric part: "+fullId);
  assertCanonicalChatAncestry(ir.parts,fullId,group.id+"__root");
  assert.equal(part.parent,
    parent==="-"?group.id+"__root":group.id+"__"+parent,
    fullId+": parent drift");
  const primitive=shape(part.geometry,ir.geometry_library);
  assert.equal(type,primitive.type,fullId+": primitive kind drift");
  same(finiteVector(dims,Array(primitive.dims.length).fill(0),fullId+" dimensions"),
    primitive.dims,fullId+" dimensions");
  const material=ir.materials?.[part.material];
  assert(material?.base_color,fullId+": unresolved canonical material");
  assert.equal(material.base_color.toLowerCase().replace("#",""),
    hex.toLowerCase(),fullId+": base color drift");
  assert(material.opacity==null||material.opacity===1,
    fullId+": translucent canonical material cannot use opaque chat depth");
  assert(material.double_sided!==true,
    fullId+": double-sided material cannot be represented by one-sided chat backface culling");
  assert(/^#[0-9a-f]{6}$/i.test(material.base_color),
    fullId+": 8-digit base-color alpha is not represented in this chat packet");
  for(const [name,value,defaults] of [
    ["translate",translate,[0,0,0]],
    ["rotate_deg",rotate,[0,0,0]],
    ["scale",scale,[1,1,1]]
  ]){
    same(finiteVector(value,defaults,fullId+" preview "+name),
      finiteVector(part.transform?.[name],defaults,fullId+" canonical "+name),
      fullId+" "+name);
  }
  const effects=[];
  if(material.emissive&&material.emissive.toLowerCase()!=="#000000"&&
    (material.emissive_intensity??1)>0)effects.push("emissive");
  if((material.metalness??0)>0)effects.push("metalness");
  return {fullId,materialEffectsNotRendered:effects};
}
