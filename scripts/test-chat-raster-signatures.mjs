#!/usr/bin/env node
/**
 * Stable raster fingerprints for the seven frozen block-chibi source scenes.
 * Baseline: source-bound CPU presentation at 192x128, before/after the
 * 2026-10-09 incremental barycentric optimization (byte-identical in 21
 * controlled comparisons). These are ENGINE REGRESSION fixtures, not
 * evidence that a human re-approved art or that Three.js rendered.
 *
 * Run: node scripts/test-chat-raster-signatures.mjs
 * No external packages, network, Actions, browser or human QA.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realizeChatScene, renderChatSceneFrame } from "../runtime/chat/scene-preview-core.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const signatures=new Map([
  ["living-room",["cdb9190f","493516ec"]],
  ["kitchen",["f2d8ec76","cd649324"]],
  ["bathroom",["18f37d46","7841e364"]],
  ["office",["fef4e3d2","ca1f4035"]],
  ["backyard",["d43a9089","dd16c24a"]],
  ["garage",["1e727020","9a5c1d45"]],
  ["factory",["814f4557","fe596acb"]],
]);
function fnv1a(bytes) {
  let hash=2166136261>>>0;
  for(const value of bytes)hash=Math.imul(hash^value,16777619)>>>0;
  return hash.toString(16).padStart(8,"0");
}
const views=[
  {width:192,height:128},
  {width:192,height:128,azimuth:1.85,elevation:0.72}
];
let count=0;
for(const [name,expected] of signatures){
  const path=resolve(root,name==="backyard"?"experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/frozen-before-correction-preview.json":"scenes/block-chibi-"+name+"-v1/preview-geometry.json");
  const spec=JSON.parse(readFileSync(path,"utf8"));
  const scene=realizeChatScene(spec);
  for(let i=0;i<views.length;i++){
    const frame=renderChatSceneFrame(scene,views[i]);
    const actual=fnv1a(frame.pixels);
    assert.equal(actual,expected[i],
      name+" reference raster changed for view "+i+
      "; inspect source pins and draw logic, do not silently rewrite signatures");
    count++;
  }
  console.log("PASS "+name+" alternative CPU-depth raster signatures");
}
console.log("PASS "+count+" source-bound reference frame fingerprints; "+
  "not canonical Three.js and not a fresh human visual verdict.");
