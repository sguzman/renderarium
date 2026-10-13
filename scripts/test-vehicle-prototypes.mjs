#!/usr/bin/env node
/** Validate separate candidate vehicle sources without changing frozen rooms. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {loadSc3dFile} from "../runtime/sc3d/load.mjs";
const root=resolve(import.meta.dirname,"..");
const prototypes=JSON.parse(readFileSync(resolve(root,"runtime/sc3d/garage-vehicle-prototypes-v2.json"),"utf8"));
assert.equal(prototypes.schema,"renderarium-garage-vehicle-prototypes-v2");
assert.deepEqual(Object.keys(prototypes.entries).sort(),["bicycle","car","car_v2","car_v3"]);
for(const [name,entry] of Object.entries(prototypes.entries)){
 const ir=await loadSc3dFile(resolve(root,entry.source));
 const parts=Object.values(ir.parts).filter(p=>p.geometry);
 assert.equal(ir.asset.id,entry.id);
 assert.equal(parts.length,entry.parts.length);
 assert(parts.length>=30);
 const previewKinds=new Set(entry.parts.map(p=>p.kind));
 assert(previewKinds.has("cylinder"),"Wheel geometry is not cylindrical");
 if(name==="bicycle"){
   assert.equal(parts.length,91);
   assert(entry.parts.filter(p=>p.id.includes("tire_")).length===40);
   assert(entry.parts.filter(p=>p.id.includes("spoke_")).length===16);
   // Wheel ring is in the X=0 plane, with 0.045m radius tubing.
   // Fork and rear supports must stay outside both tire and tube radii.
   for (const part of entry.parts.filter(p => /^(fork_leg|rear_seat_stay|rear_chain_stay|rack_stay)_/.test(p.id))) {
     const margin = Math.abs(part.position[0]) - part.geometry.radius - 0.045;
     assert(margin >= 0.05, "Wheel/frame side clearance violated: "+part.id);
   }
   assert(!entry.parts.some(p => ["front_fork","seat_stay","chain_stay","rear_rack_support"].includes(p.id)),
     "Old centerline wheel-intersecting strut returned");
 } else if (["car","car_v2","car_v3"].includes(name)) {
   assert.equal(parts.length,name==="car"?89:name==="car_v3"?86:31);
   assert(entry.parts.filter(p=>p.id.startsWith("tire_") || p.id.endsWith("_wheel")).length===4);
   if (name==="car") {
     const byName=new Map(entry.parts.map(p=>[p.id,p]));
     const body=byName.get("belt_body"),cabin=byName.get("cabin");
     assert(body&&cabin);
     const bodyTop=body.position[1]+body.geometry.height/2;
     const cabinBottom=cabin.position[1]-cabin.geometry.height/2;
     assert(cabinBottom < bodyTop - 0.025,"Cabin must overlap main body instead of floating");
     assert(!byName.has("front_door_left")&&!byName.has("rear_panel_left"),
       "Raised rectangular side-panel slabs returned");
     assert(byName.has("continuous_belt")&&byName.has("hood_continuity"),
       "Body/hood transitions missing");
     assert(byName.has("left_front_pillar")&&byName.has("right_rear_pillar"));
     // In the tapered cabin, each window must sit outside the body panel,
     // not disappear within it when viewed side-on.
     const roofSideWidthAtY = (y) => {
       const g=cabin.geometry;
       const fraction=(y-(cabin.position[1]-g.height/2))/g.height;
       return (g.bottom[0] + fraction*(g.top[0]-g.bottom[0]))/2;
     };
     for (const side of ["left","right"]) {
       for (const kind of ["front_window","rear_window_side"]) {
         const w=byName.get(kind+"_"+side);
         assert(w&&Math.abs(w.position[0]) > roofSideWidthAtY(w.position[1])+0.01,
           "Side glass embedded under cabin panel: "+kind+"_"+side);
       }
     }
     const belt=byName.get("continuous_belt");
     assert(belt.geometry.size[1] <= .04,
       "Oversized trim bar returned along body beltline");
   }
 }
 for(const part of entry.parts){
   const actual=ir.parts[part.id];
   assert(actual&&actual.geometry,"Part missing from SC3D realization: "+part.id);
   assert.equal(actual.geometry.kind,part.kind);
   assert.equal(actual.material?.name??actual.material,part.material);
 }
 console.log("PASS SC3D "+name+" candidate source / JSON parity: "+parts.length+" geometries");
}
console.log("Vehicle prototypes are separate candidates; no accepted garage assembly edits.");
