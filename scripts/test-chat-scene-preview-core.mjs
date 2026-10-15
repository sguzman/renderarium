#!/usr/bin/env node
/**
 * Agent-run, no-dependency structural and raster regression for the
 * *alternate* in-chat scene renderer. This is NOT Three.js proof or a
 * human review delivery receipt.
 *
 * node scripts/test-chat-scene-preview-core.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  realizeChatScene, renderChatSceneFrame, createChatSceneViewer
} from "../runtime/chat/scene-preview-core.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const cases=[
  ["living-room",87,9],
  ["kitchen",149,11],
  ["bathroom",139,10],
  ["office",104,12],
  ["backyard",179,18],
  ["garage",112,8],
  ["factory",209,16],
];
function pixelDrift(a,b) {
  assert.equal(a.length,b.length);
  let changed=0;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
  return changed;
}
function nonbackground(frame) {
  let pixels=0;
  for(let i=0;i<frame.pixels.length;i+=4) {
    if(frame.pixels[i]!==233 || frame.pixels[i+1]!==240 ||
       frame.pixels[i+2]!==235) pixels++;
  }
  return pixels;
}
for(const [name,count,groups] of cases) {
  const preview=JSON.parse(readFileSync(resolve(root,
    "scenes/block-chibi-"+name+"-v1/preview-geometry.json"),"utf8"));
  const scene=realizeChatScene(preview);
  assert.equal(scene.partCount,count,name+" geometry count drift");
  assert.equal(scene.groups.length,groups,name+" group count drift");
  assert(scene.bounds.min.every(Number.isFinite));
  assert(scene.bounds.max.every(Number.isFinite));
  assert(scene.bounds.min.every((v,i)=>v<scene.bounds.max[i]));
  const frames=[
    {width:192,height:128},
    {width:192,height:128,azimuth:1.85,elevation:0.72},
  ];
  for(const options of frames){
    const first=renderChatSceneFrame(scene,options);
    const reverse=renderChatSceneFrame({
      ...scene,objects:[...scene.objects].reverse()
    },options);
    assert.equal(first.visibleParts,count);
    assert(first.visibleFaces>0);
    assert(nonbackground(first)>1000,name+" blank frame");
    assert.equal(pixelDrift(first.pixels,reverse.pixels),0,
      name+" depth rendering depends on primitive traversal order");
  }
  const hidden=renderChatSceneFrame(scene,{
    width:192,height:128,hiddenGroups:[scene.groups[0].id],
  });
  const suppressed=scene.objects.filter(p=>p.groupId===scene.groups[0].id).length;
  assert.equal(hidden.visibleParts,count-suppressed,
    name+" named group visibility did not work");
  console.log("PASS "+name+": "+count+" primitives, "+groups+
    " groups, two depth-stable views, visibility and nonblank raster");
}

// Parent-local transform followed by parent frame and then instance-root
// rotation/translation must match canonical SC3D's hierarchy.
const fixture={
  groups:[{
    index:0,id:"assembly",translate:[2,0,1],rotate_deg:[0,90,0],scale:[1,1,1]
  }],
  parts:[
    "0|support|-|b|1,1,1|abcdef|1,0,0|0,0,90|-",
    "0|child|support|t|.5,.5,.3,.3,.8|abc123|1,0,0|-|-",
  ].join("\n"),
};
const model=realizeChatScene(fixture);
const child=model.objects.find(x=>x.id==="child");
assert(child);
for(let i=0;i<3;i++) {
  assert(Math.abs(child.center[i]-[2,1,0][i])<1e-9,
    "parent-local SC3D transform order mismatched at axis "+i);
}
for(const corrupt of [
  {...fixture,parts:fixture.parts.replace("|support|t|","|nonexistent|t|")},
  {...fixture,parts:fixture.parts.replace("1,0,0|0,0,90","NaN,0,0|0,0,90")},
  {...fixture,parts:fixture.parts.replace("support|-|","support|child|")},
  {...fixture,parts:fixture.parts.replace("|.5,.5,.3,.3,.8|","|.5,-.5,.3,.3,.8|")},
]) assert.throws(()=>realizeChatScene(corrupt),"malformed hierarchy/dimension passed");

// A genuinely nearer red surface must win over a later authored blue
// surface. Equal-depth tie breaking may not override actual occlusion.
const overlapping=realizeChatScene({
  groups:[{index:0,id:"test",translate:[0,0,0],
    rotate_deg:[0,0,0],scale:[1,1,1]}],
  parts:[
    "0|near|-|b|1.9,1.9,.6|ff0000|0,0,-.6|-|-",
    "0|far|-|b|1.9,1.9,.6|0000ff|0,0,.6|-|-",
  ].join("\n")
});
const view={width:128,height:128,target:[0,0,0],distance:5,
  azimuth:0,elevation:0.08};
const visibleNear=renderChatSceneFrame(overlapping,view);
const i=(64*128+64)*4;
assert(visibleNear.pixels[i]>visibleNear.pixels[i+2],
  "a farther source-priority mesh leaked over a nearer red surface");
const reversed=renderChatSceneFrame({
  ...overlapping,objects:[...overlapping.objects].reverse()
},view);
assert.equal(pixelDrift(visibleNear.pixels,reversed.pixels),0,
  "overlap depends on draw order");
console.log("PASS true foreground occlusion and draw-order independent depth ties");

// The host controls stay wired to a single renderer instance. This fake
// canvas confirms the semantics without pretending to test a ChatGPT host.
const listeners=new Map();
let frames=0;
const canvas={
  width:0,height:0,
  getBoundingClientRect:()=>({width:220,height:145}),
  getContext:(type)=>{
    assert.equal(type,"2d");
    return {
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:()=>{frames++;},
    };
  },
  addEventListener:(name,handler)=>listeners.set(name,handler),
  removeEventListener:(name)=>listeners.delete(name),
  setPointerCapture:()=>{},
};
const controller=createChatSceneViewer({
  canvas,packet:fixture,maxWidth:192
});
assert(frames>=1,"initial chat frame not rendered");
controller.preset("overhead");
assert(frames>=2);
assert.equal(controller.getState().renderedParts,2);
controller.toggleGroup("assembly",false);
assert.equal(controller.getState().renderedParts,0);
controller.toggleGroup("assembly",true);
listeners.get("pointerdown")({pointerId:1,clientX:30,clientY:30});
listeners.get("pointermove")({pointerId:1,clientX:100,clientY:40});
listeners.get("pointerup")({pointerId:1});
assert(controller.getState().azimuth>0.22);
listeners.get("wheel")({deltaY:90,preventDefault:()=>{}});
controller.reset();
assert.equal(controller.getState().azimuth,0.6);
controller.dispose();
assert.equal(listeners.size,0,"event listeners leaked on disposal");
// The host must not rasterize a full-resolution frame on every pointer move.
// Use a *separate* wide fake canvas to exercise the resolution transitions.
const wideListeners=new Map(),resolutionStates=[];
let backingStoreResets=0;
const wideCanvas={
  _width:0,_height:0,
  get width(){return this._width;},
  set width(value){this._width=value;backingStoreResets++;},
  get height(){return this._height;},
  set height(value){this._height=value;backingStoreResets++;},
  getBoundingClientRect:()=>({width:700,height:420}),
  getContext:()=>({
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    putImageData:()=>{},
  }),
  addEventListener:(name,handler)=>wideListeners.set(name,handler),
  removeEventListener:(name)=>wideListeners.delete(name),
  setPointerCapture:()=>{},
};
const adaptive=createChatSceneViewer({
  canvas:wideCanvas,packet:fixture,maxWidth:700,interactionWidth:360,
  onStatus:receipt=>resolutionStates.push(receipt),
});
assert.deepEqual(adaptive.getState().rasterResolution,[700,420]);
assert.equal(backingStoreResets,2);
adaptive.requestDraw();
assert.equal(backingStoreResets,2,"same-size render reset backing store");
wideListeners.get("pointerdown")({pointerId:3,clientX:10,clientY:20});
wideListeners.get("pointermove")({pointerId:3,clientX:45,clientY:40});
assert.deepEqual(adaptive.getState().rasterResolution,[360,216]);
assert.equal(resolutionStates.at(-1).resolutionMode,"interaction");
wideListeners.get("pointerup")({pointerId:3});
assert.deepEqual(adaptive.getState().rasterResolution,[700,420]);
assert.equal(resolutionStates.at(-1).resolutionMode,"full");
assert.equal(backingStoreResets,6,
  "backing store should reset only on full/interactive size transitions");
adaptive.requestDraw();
assert.equal(backingStoreResets,6,
  "repeated full-size draw reset the canvas backing store");
adaptive.dispose();
assert.equal(wideListeners.size,0);
console.log("PASS adaptive in-chat raster: full 700x420 -> interaction 360x216 -> full 700x420");

console.log("PASS nested SC3D transforms, fail-closed input, pointer/zoom/reset/group visibility, disposal");
console.log("LIMITATION: source-bound CPU depth engine tested, not canonical Three.js or live chat-host delivery.");
