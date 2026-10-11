#!/usr/bin/env node
/**
 * Conservative CPU viewer camera/depth stress test against seven accepted
 * source snapshots. No Three.js, browser, GitHub Actions, source mutation,
 * or renewed visual review required.
 *
 * node scripts/test-chat-camera-depth-stress.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realizeChatScene,renderChatSceneFrame } from
  "../runtime/chat/scene-preview-core.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const scenes=["living-room","kitchen","bathroom","office",
  "backyard","garage","factory"];
const cameras=[
  {azimuth:0,elevation:.12},
  {azimuth:1.2,elevation:.45},
  {azimuth:2.9,elevation:1.48},
  {azimuth:4.5,elevation:.95},
  {azimuth:-1.1,elevation:.06},
  {azimuth:6.2,elevation:1.42,distance:2},
  {azimuth:.6,elevation:Math.PI/2},
  {azimuth:.6,elevation:-Math.PI/2}
];
let views=0;
for(const name of scenes){
  const input=JSON.parse(readFileSync(resolve(root,
    "scenes/block-chibi-"+name+"-v1/preview-geometry.json"),"utf8"));
  const scene=realizeChatScene(input);
  for(const camera of cameras){
    const options={width:128,height:80,...camera};
    const forward=renderChatSceneFrame(scene,options);
    const reverse=renderChatSceneFrame({
      ...scene,objects:[...scene.objects].reverse()
    },options);
    assert.equal(forward.visibleParts,scene.partCount);
    assert(forward.visibleFaces>0,name+": no visible faces");
    assert(forward.depth.every(Number.isFinite),
      name+": nonfinite z-buffer");
    assert.deepEqual(forward.pixels,reverse.pixels,
      name+": camera view depends on mesh traversal");
    assert.deepEqual(forward.depth,reverse.depth,
      name+": camera depth depends on mesh traversal");
    let colored=0;
    for(let i=0;i<forward.pixels.length;i+=4){
      assert.equal(forward.pixels[i+3],255,name+": unexpected alpha");
      if(forward.pixels[i]!==233||forward.pixels[i+1]!==240||
         forward.pixels[i+2]!==235)colored++;
    }
    assert(colored>0,name+": camera view has no projected geometry");
    views++;
  }
  console.log("PASS "+name+": "+cameras.length+
    " reverse-order-invariant camera/depth views");
}
console.log("PASS "+views+" camera/depth stress views across 7 frozen scenes.");
console.log("LIMITATION: CPU raster robustness, not a canonical Three.js/GPU run.");
