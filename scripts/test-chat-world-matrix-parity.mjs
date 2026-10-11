#!/usr/bin/env node
/**
 * Independent world-matrix parity for the source-bound chat renderer.
 * Mirrors canonical adapter's supported hierarchy convention:
 * world = component * ancestors * part, local = T * Rx * Ry * Rz * S.
 * This is a mathematical comparison, NOT a Three.js/GPU execution.
 *
 * node scripts/test-chat-world-matrix-parity.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realizeChatScene } from "../runtime/chat/scene-preview-core.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const names=["living-room","kitchen","bathroom","office","backyard","garage","factory"];
function id(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
function mul(a,b){
  const o=Array(16).fill(0);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)
    for(let k=0;k<4;k++)o[4*r+c]+=a[4*r+k]*b[4*k+c];
  return o;
}
function vec(x,f){return x==null||x==="-"?f:Array.isArray(x)?x.map(Number):x.split(",").map(Number);}
function matrix(t,rotation,s){
  const [x,y,z]=t,[rx,ry,rz]=rotation.map(v=>v*Math.PI/180),[sx,sy,sz]=s;
  const T=id(),X=id(),Y=id(),Z=id(),S=id();
  T[3]=x;T[7]=y;T[11]=z;
  X[5]=Math.cos(rx);X[6]=-Math.sin(rx);X[9]=Math.sin(rx);X[10]=Math.cos(rx);
  Y[0]=Math.cos(ry);Y[2]=Math.sin(ry);Y[8]=-Math.sin(ry);Y[10]=Math.cos(ry);
  Z[0]=Math.cos(rz);Z[1]=-Math.sin(rz);Z[4]=Math.sin(rz);Z[5]=Math.cos(rz);
  S[0]=sx;S[5]=sy;S[10]=sz;
  return mul(mul(mul(mul(T,X),Y),Z),S);
}
function transform(g){return matrix(vec(g.translate,[0,0,0]),
  vec(g.rotate_deg,[0,0,0]),vec(g.scale,[1,1,1]));}
function moved(M,p){return [M[0]*p[0]+M[1]*p[1]+M[2]*p[2]+M[3],
  M[4]*p[0]+M[5]*p[1]+M[6]*p[2]+M[7],
  M[8]*p[0]+M[9]*p[1]+M[10]*p[2]+M[11]];}
function corners(part){
  const [bx,bz,tx,tz,h]=part.kind==="b"
    ?[part.dims[0],part.dims[2],part.dims[0],part.dims[2],part.dims[1]]
    :part.dims;
  return [[-bx/2,-h/2,-bz/2],[bx/2,-h/2,-bz/2],
    [bx/2,-h/2,bz/2],[-bx/2,-h/2,bz/2],
    [-tx/2,h/2,-tz/2],[tx/2,h/2,-tz/2],
    [tx/2,h/2,tz/2],[-tx/2,h/2,tz/2]];
}
const faces=[[0,3,2,1],[4,5,6,7]];
function check(spec,label){
  const realized=realizeChatScene(spec);
  const groups=spec.groups.map(transform);
  const rows=spec.parts.split("\n").map(line=>{
    const f=line.split("|");assert(f.length===8||f.length===9);
    return {g:Number(f[0]),partId:f[1],parent:f[2],kind:f[3],
      dims:f[4].split(",").map(Number),
      local:transform({translate:f[6],rotate_deg:f[7],scale:f[8]})};
  });
  assert.equal(rows.length,realized.objects.length);
  const lookup=new Map(rows.map(p=>[p.g+"/"+p.partId,p]));
  const visited=new Set(),cache=new Map();
  function world(part){
    assert(part,"unresolved matrix ancestor");
    const key=part.g+"/"+part.partId;
    if(cache.has(key))return cache.get(key);
    assert(!visited.has(key),"cycle "+key);
    visited.add(key);
    const parent=part.parent==="-"?groups[part.g]:
      world(lookup.get(part.g+"/"+part.parent));
    const result=mul(parent,part.local);
    cache.set(key,result);visited.delete(key);return result;
  }
  let compared=0,maxDelta=0;
  for(let i=0;i<rows.length;i++){
    const part=rows[i],mesh=realized.objects[i],M=world(part);
    assert.equal(mesh.id,part.partId);
    assert.equal(mesh.group,part.g);
    const local=corners(part);
    for(let face=0;face<2;face++)
      for(let j=0;j<4;j++){
        const expected=moved(M,local[faces[face][j]]);
        const observed=mesh.faces[face].vertices[j];
        for(let axis=0;axis<3;axis++){
          const delta=Math.abs(expected[axis]-observed[axis]);
          assert(Number.isFinite(delta)&&delta<1e-9,
            label+"/"+part.partId+" incorrect coordinate "+axis);
          maxDelta=Math.max(maxDelta,delta);compared++;
        }
      }
  }
  return {count:rows.length,compared,maxDelta};
}
let coordinates=0;
for(const name of names){
  const json=JSON.parse(readFileSync(resolve(root,
    "scenes/block-chibi-"+name+"-v1/preview-geometry.json"),"utf8"));
  const result=check(json,name);coordinates+=result.compared;
  console.log("PASS "+name+": "+result.count+" parts, "+result.compared+
    " XYZ world coordinates (max delta "+result.maxDelta.toExponential(2)+")");
}
const fixture={groups:[{index:0,id:"frame",
  translate:[2.6,.9,-1.2],rotate_deg:[15,25,-10],scale:[1.1,.85,.95]}],
  parts:[
    "0|parent|-|b|1.3,1.4,.8|abcdef|.4,.5,-.8|21,-14,37|1.2,.7,1.4",
    "0|child|parent|t|.5,.4,.3,.8,1.1|ca9173|-.2,.8,.3|-12,6,14|.8,1.3,1.1"
  ].join("\n")};
const extra=check(fixture,"compound-XYZ");
assert.equal(extra.count,2);
console.log("PASS compound-XYZ/nonuniform-scale/tapered-child regression");
console.log("PASS "+coordinates+" source-bound world coordinates across 7 scenes");
console.log("LIMITATION: matrix-parity proof, not an actual Three.js renderer run.");
