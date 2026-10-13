#!/usr/bin/env node
/** Validate separate candidate vehicle sources without changing frozen rooms. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {loadSc3dFile} from "../runtime/sc3d/load.mjs";
const root=resolve(import.meta.dirname,"..");
const prototypes=JSON.parse(readFileSync(resolve(root,"runtime/sc3d/garage-vehicle-prototypes-v2.json"),"utf8"));
assert.equal(prototypes.schema,"renderarium-garage-vehicle-prototypes-v2");
assert.deepEqual(Object.keys(prototypes.entries).sort(),["bicycle","car","car_v2","car_v3","car_v4","car_v5","car_v7","car_v8","car_v9"]);
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
 } else if (["car","car_v2","car_v3","car_v4","car_v5","car_v7","car_v8","car_v9"].includes(name)) {
   assert.equal(parts.length,name==="car"?96:name==="car_v7"?99:name==="car_v8"?149:name==="car_v9"?156:name==="car_v5"?80:name==="car_v4"?89:name==="car_v3"?86:31);
   assert(entry.parts.filter(p=>p.id.startsWith("tire_") || p.id.endsWith("_wheel")).length===4);


   if(name==="car"){
     const byName=new Map(entry.parts.map(p=>[p.id,p]));
     assert(!byName.has("cabin"),"v6 opaque cabin shell would hide side glass");
     const roof=byName.get("roof_cap"),body=byName.get("belt_body");
     assert(roof&&body);
     const required=["front_upper_belt","rear_upper_belt","dashboard",
       "front_roof_crossmember","rear_roof_crossmember"];
     for(const id of required)assert(byName.has(id),"v6 missing frame component "+id);
     assert(byName.get("windshield").kind==="loft");
     assert(byName.get("rear_window").kind==="loft");
     for(const side of ["left","right"]){
       assert(byName.get("roof_edge_"+side)?.kind==="rounded_box");
       assert(byName.get("upper_door_shoulder_"+side)?.kind==="rounded_box");
       assert(byName.get("window_sill_"+side)?.kind==="rounded_box");
       assert(byName.get("front_side_glass_"+side)?.kind==="loft");
       assert(byName.get("rear_side_glass_"+side)?.kind==="loft");
       assert(byName.has("a_pillar_"+side)&&byName.has("b_pillar_"+side)
         &&byName.has("c_pillar_"+side),"v6 structural pillars missing");
       const shoulder=byName.get("upper_door_shoulder_"+side);
       const glass=byName.get("front_side_glass_"+side);
       const glassBottom=glass.geometry.sections[0].profile[0][1];
       assert(Math.abs((shoulder.position[1]+shoulder.geometry.size[1]/2)-glassBottom)<.04,
         "v6 side windows do not rest on door shoulders");
     }
     const front=byName.get("windshield").geometry.sections;
     assert(front[0].z<front[1].z&&front[0].profile[0][1]<front[1].profile[0][1],
       "v6 windshield does not slope upward and rearward");
     const tires=["tire_front_left","tire_front_right","tire_rear_left","tire_rear_right"]
       .map(id=>{assert(byName.has(id));return byName.get(id)});
     assert(tires.every(p=>p.position[1]-p.geometry.radius>=0),"v6 tire sinks into ground");
     assert(Math.abs(tires[0].position[0]+tires[1].position[0])<.00001,
       "v6 front wheel track asymmetric");
     assert(Math.abs(tires[2].position[0]+tires[3].position[0])<.00001,
       "v6 rear wheel track asymmetric");
     assert(Math.abs((tires[2].position[2]-tires[0].position[2])-2.03)<.00001,
       "v6 wheelbase mismatch");
     for(const side of ["left","right"]){
       const p=byName.get("sculpted_side_"+side);
       assert(p?.kind==="polygon_prism");
       const archTop=Math.max(...p.geometry.profile.map(x=>x[1]).filter(y=>y<.9));
       assert(archTop>tires[0].position[1]+tires[0].geometry.radius+.07,
         "v6 wheel arch clearance insufficient");
     }
   }



   if(name==="car_v9"){
     const byName=new Map(entry.parts.map(p=>[p.id,p]));
     assert(!byName.has("sculpted_side_left"),"v9 may not reinstate a continuous toy-side slab");
     const hood=byName.get("hood");
     assert(hood.kind==="loft"&&hood.geometry.sections.length>=5,
       "v9 hood must be a genuinely tapered stamped loft");
     const hoodS=hood.geometry.sections;
     for(const [label,item] of [["hood",hood],["rear hatch",byName.get("rear_deck")]]){
       for(const section of item.geometry.sections){
         assert(section.profile[3][0]>section.profile[4][0],
           "v9 "+label+" top polygons face inward and disappear under culling");
       }
     }
     assert(hoodS.at(-1).profile[2][1]-hoodS[0].profile[2][1]>.18,
       "v9 hood has not acquired a downward nose slope");
     assert(hoodS[0].z<hoodS.at(-1).z,"v9 hood stations reversed");
     const hatch=byName.get("rear_deck");
     assert(hatch.kind==="loft"&&hatch.geometry.sections.length>=4,
       "v9 hatch still a toylike rectangular block");
     const hatchS=hatch.geometry.sections;
     assert(hatchS[0].profile[2][1]-hatchS.at(-1).profile[2][1]>.16,
       "v9 rear hatch is not sloped toward tail");
     const rearGlass=byName.get("rear_window");
     assert(rearGlass.geometry.sections.at(-1).z>1.24,
       "v9 rear window isn't structurally integrated with sloped hatch");
     const belly=byName.get("belt_body"),lower=byName.get("mid_lower_shell");
     assert(belly.position[1]-belly.geometry.height/2<
       lower.position[1]+lower.geometry.height/2,
       "v9 stamped body lost load-bearing underfloor overlap");
     for(const side of ["left","right"]){
       const f=byName.get("front_fender_skin_"+side);
       const q=byName.get("rear_quarter_skin_"+side);
       assert(f.geometry.profile.length>=20&&q.geometry.profile.length>=20,
         "v9 must preserve semicircular wheel-arch cuts");
       assert(f.geometry.profile[0][1]<f.geometry.profile[4][1]-.15,
         "v9 front fender top is still a horizontal toy slab");
       assert(q.geometry.profile[4][1]<q.geometry.profile[0][1]-.15,
         "v9 rear quarter still has squared-off top");
       for(const role of ["hood_shutline","front_fender_crown","rear_quarter_crown"]){
         assert(byName.get(role+"_"+side)?.kind==="ribbon_path",
           "v9 lacks connected stamping line "+role+"_"+side);
       }
       for(const door of ["front","rear"]){
         assert.equal(ir.parts[door+"_side_glass_"+side]?.parent,
           door+"_door_"+side,"v9 lost v8 door-window ownership");
       }
     }
   }
   if(name==="car_v8"){
     const byName=new Map(entry.parts.map(p=>[p.id,p]));
     // The candidate has a real door skin volume and separate front/rear
     // assemblies; glass is no longer one long window running over the rear wheel.
     assert(!byName.has("sculpted_side_left")&&!byName.has("sculpted_side_right"),
       "v8 doors still sit on decorative continuous outer panels");
     for(const side of ["left","right"]){
       const front=byName.get("front_fender_skin_"+side),rear=byName.get("rear_quarter_skin_"+side);
       assert(front?.kind==="polygon_prism"&&rear?.kind==="polygon_prism",
         "v8 needs independent steel fender and quarter panels");
       const frontEdge=Math.min(...front.geometry.profile.map(x=>x[0]));
       const rearEdge=Math.max(...rear.geometry.profile.map(x=>x[0]));
       assert(frontEdge>=.70 && rearEdge<=-.70,
         "v8 fenders have not left a real door opening");
       const fs=byName.get("front_door_skin_"+side).geometry.sections,
         rs=byName.get("rear_door_skin_"+side).geometry.sections;
       assert(fs[0].z>=-frontEdge && rs.at(-1).z<=-rearEdge,
         "v8 door skins collide with fixed outer quarter/fender cutout");
     }
     const src=ir.parts;
     for(const side of ["left","right"]){
       const f="front_door_"+side, r="rear_door_"+side;
       for(const id of [f,r]){
         assert(src[id] && !src[id].geometry,
           "v8 needs a separate load-bearing door assembly: "+id);
       }
       for(const [id,parent] of [
         ["front_door_skin_"+side,f],["rear_door_skin_"+side,r],
         ["front_side_glass_"+side,f],["rear_side_glass_"+side,r],
         ["upper_door_shoulder_"+side,f],["rear_door_shoulder_"+side,r],
         ["window_sill_"+side,f],["rear_window_sill_"+side,r],
         ["front_door_a_frame_"+side,f],["front_door_b_frame_"+side,f],
         ["rear_door_b_frame_"+side,r],["rear_door_c_frame_"+side,r],
         ["front_handle_"+side,f],["rear_handle_"+side,r],
       ]){
         assert.equal(src[id]?.parent,parent,"v8 door part is detached: "+id);
       }
       const fg=byName.get("front_side_glass_"+side).geometry.sections;
       const rg=byName.get("rear_side_glass_"+side).geometry.sections;
       const q=byName.get("quarter_glass_"+side).geometry.sections;
       assert(fg[0].z<fg.at(-1).z&&rg[0].z<rg.at(-1).z,
         "v8 front/rear door glass must be spatially ordered");
       assert(rg.at(-1).z<q[0].z,
         "v8 door glass must terminate before fixed rear quarter glazing");
       assert.equal(src["quarter_glass_"+side].parent,"root",
         "Fixed rear quarter pane incorrectly moves with door");
       for(const door of ["front","rear"]){
         const skin=byName.get(door+"_door_skin_"+side);
         assert(skin?.kind==="loft"&&skin.geometry.sections.length>=4,
           "v8 missing closed stamped shell: "+door+"_"+side);
         const section=skin.geometry.sections[1];
         assert(section.profile.some(p=>p[1]>=1.325),
           "Door skin does not meet the window sill");
         assert(section.profile.some(p=>p[1]<.69),
           "Door skin does not reach the sill/rocker");
         assert(src[door+"_handle_"+side].parent===door+"_door_"+side,
           "v8 handle detached from door");
         for(const level of ["lower","upper"]){
           assert(byName.has(door+"_hinge_"+level+"_"+side),
             "v8 door hinge mechanically unsupported");
         }
       }
       const rocker=byName.get("outer_rocker_plate_"+side);
       assert(rocker.position[1]+rocker.geometry.size[1]/2>.70,
         "v8 structural rocker does not connect with door foot");
       for(const end of ["leading","trailing"]){
         assert(byName.get("front_door_"+end+"_gap_"+side)?.kind==="ribbon_path");
         assert(byName.get("rear_door_"+end+"_gap_"+side)?.kind==="ribbon_path");
       }
     }
   }
   if(name==="car_v7"){
     const byName=new Map(entry.parts.map(p=>[p.id,p]));
     for(const id of ["mid_lower_shell","front_lower_apron","rear_lower_apron"])
       assert(byName.has(id),"v7 lower shell not sealed: "+id);
     const shell=byName.get("mid_lower_shell"),underbody=byName.get("underbody"),belt=byName.get("belt_body");
     assert(shell.position[1]-shell.geometry.height/2 < underbody.position[1]+underbody.geometry.size[1]/2+.02,
       "v7 mid shell must meet underbody");
     assert(shell.position[1]+shell.geometry.height/2 > belt.position[1]-belt.geometry.height/2+.01,
       "v7 mid shell must overlap belt");
     for(const side of ["left","right"]){
       const front=byName.get("front_side_glass_"+side).geometry.sections;
       const rear=byName.get("rear_side_glass_"+side).geometry.sections;
       assert.equal(front.length,4,"v7 front glass no A-pillar contour");
       assert.equal(rear.length,4,"v7 rear glass no C-pillar contour");
       assert(front[0].profile[1][1]<front[1].profile[1][1]-.25,
         "v7 front glass not tapered to A pillar");
       assert(rear.at(-1).profile[1][1]<rear.at(-2).profile[1][1]-.25,
         "v7 rear glass not tapered to C pillar");
       assert(Math.abs(front[1].profile[1][1]-rear[0].profile[1][1])<.005,
         "v7 side window headers aren't aligned");
       assert(front[0].profile[0][1]===rear[0].profile[0][1],
         "v7 side glazing not on a continuous sill");
       const b=byName.get("b_pillar_"+side);
       assert(b.geometry.size[2]>=.105,"v7 B pillar leaves open window split");
     }
   }
   if(name==="car_v5"){
     const byName=new Map(entry.parts.map(p=>[p.id,p]));
     const body=byName.get("belt_body"), cabin=byName.get("cabin");
     assert(body&&cabin&&cabin.position[1]-cabin.geometry.height/2
       < body.position[1]+body.geometry.height/2-0.025,
       "v5 cabin does not structurally overlap the body");
     const roof=byName.get("roof_cap");
     assert(roof&&roof.position[1]-roof.geometry.size[1]/2
       < cabin.position[1]+cabin.geometry.height/2,
       "v5 roof cap disconnected from cabin");
     const tires=["tire_front_left","tire_front_right","tire_rear_left","tire_rear_right"]
       .map(k=>{assert(byName.has(k));return byName.get(k)});
     assert(tires.every(p=>p.position[1]-p.geometry.radius>=0),
       "v5 tire penetrates ground");
     assert(Math.abs(tires[0].position[0]+tires[1].position[0])<0.00001,
       "v5 front wheels are not laterally symmetrical");
     assert(Math.abs(tires[2].position[0]+tires[3].position[0])<0.00001,
       "v5 rear wheels are not laterally symmetrical");
     assert(Math.abs((tires[2].position[2]-tires[0].position[2])-2.03)<0.00001,
       "v5 wheelbase changed unexpectedly");
     assert(byName.get("underbody").geometry.size[0]/2
       < Math.abs(tires[0].position[0])-tires[0].geometry.height/2,
       "v5 underbody intersects tire swept volume");
     const panels=["sculpted_side_left","sculpted_side_right"].map(k=>byName.get(k));
     assert(panels.every(p=>p?.kind==="polygon_prism"&&p.geometry.profile.length>=30),
       "v5 integrated wheel-well side panels missing");
     const archTop=Math.max(...panels[0].geometry.profile.map(point=>point[1])
       .filter(y=>y<.9));
     assert(archTop>tires[0].position[1]+tires[0].geometry.radius+.07,
       "v5 wheel arch apex leaves insufficient tire clearance");
     for(const side of ["left","right"]){
       assert(byName.get("front_side_glass_"+side)?.kind==="loft");
       assert(byName.get("rear_side_glass_"+side)?.kind==="loft");
       for(const axle of ["front","rear"])
         assert(byName.get("wheel_opening_lip_"+axle+"_"+side)?.kind==="ribbon_path");
     }
   }
   if (name==="car_v4") {
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
