#!/usr/bin/env node
// Static regression guard for the diagnostic-only Backyard full-effects benchmark.
// This deliberately does not claim real browser rendering, GPU timings, or visual approval.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inflateSync} from "node:zlib";
import {Script} from "node:vm";

const original = readFileSync("experiments/integration/backyard-unified-effects-v1-1-precision-fix-2026-10-15.html", "utf8");
const benchmark = readFileSync("experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html", "utf8");
const sourceChunks = text => {
  const match = text.match(/const chunks=\[([\s\S]*?)\];/);
  assert.ok(match, "Missing packed canonical Backyard data");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).join("");
};
const a = sourceChunks(original), b = sourceChunks(benchmark);
assert.equal(a, b, "Benchmark must not change the accepted 179-part source");

const raw = inflateSync(Buffer.from(b, "base64"));
assert.equal(raw.subarray(0, 4).toString("ascii"), "RB01", "Canonical source signature");
assert.equal(raw.length, 3235, "Canonical source byte length");
let fingerprint = 2166136261;
for (const byte of raw) fingerprint = Math.imul(fingerprint ^ byte, 16777619) >>> 0;
assert.equal(fingerprint, 3583097875, "Canonical source FNV-1a checksum");
let p = 4;
const paletteSize = raw[p++]; p += paletteSize * 3;
const groupCount = raw[p++]; p += groupCount * 18;
assert.equal(groupCount, 18, "Canonical hierarchy groups");
assert.equal(raw.readUInt16LE(p), 179, "Accepted geometry part count");

const shaderNames = [
  "cam", "quadVS", "meshVS", "meshFS", "skyFS", "outlineFS",
  "shaftFS", "extractFS", "blurFS", "gradeFS", "fxaaFS",
  "particleVS", "particleFS",
];
const shader = (text, name) => {
  const match = text.match(new RegExp("const " + name + "=\`([\\s\\S]*?)\`;"));
  assert.ok(match, "Missing GLSL shader " + name);
  return match[1];
};
for (const name of shaderNames) {
  assert.equal(shader(benchmark, name), shader(original, name), name + " GLSL or camera projection changed");
}
assert.ok(benchmark.includes("const programs=[program(meshVS,meshFS)"), "Canonical program compilation chain missing");
for (const label of ["Minimal", "Outlines", "Shafts", "Bloom", "Dust", "FXAA", "Combined"]) {
  assert.ok(benchmark.includes("['" + label + "',"), "Missing benchmark scenario " + label);
}
for (const required of [
  "mark('setup')", "mark('sky')", "mark('mesh')", "mark('outline')",
  "mark('shafts')", "mark('bloom')", "mark('grading')", "mark('weather')",
  "mark('fxaa')", "beginGpu(rec)", "endGpu(activeQuery)",
  "GPU_DISJOINT_EXT", "benchAdvance(now)", "drawCalls++", "document.visibilityState",
]) assert.ok(benchmark.includes(required), "Missing benchmark guard: " + required);
const body = benchmark.match(/<script>\s*([\s\S]*?)<\/script><\/body><\/html>/);
assert.ok(body, "No standalone browser script found");
new Script(body[1], {filename: "backyard-full-effects-benchmark-v2.js"});
assert.ok(benchmark.includes("id=\"benchRun\""), "Benchmark run UI missing");
assert.ok(benchmark.includes("id=\"benchCopy\""), "Results export UI missing");
const sweep = readFileSync("experiments/diagnostics/backyard-sunshaft-raymarch-sample-sweep-v2-1-2026-10-15.html", "utf8");
assert.equal(sourceChunks(sweep),b,"Sunshaft trial must retain 179-part source");
for (const name of shaderNames)assert.equal(shader(sweep,name),shader(original,name),"Sunshaft trial changed accepted shader "+name);
for (const label of ["Minimal","Shafts 40","Shafts 20","Shafts 10","Combined 40","Combined 20","Combined 10"])
  assert.ok(sweep.includes("['"+label+"',"),"Missing sunshaft sweep scenario "+label);
for (const item of ["shaft20FS=shaftFS.replace","shaft10FS=shaftFS.replace","for(int i=0;i<40;i++)","for(int i=0;i<20;i++)","for(int i=0;i<10;i++)",'id="shaftSamples"',"endGpu(activeQuery)"])
  assert.ok(sweep.includes(item),"Missing diagnostic shader invariant "+item);
const sweepBody=sweep.match(/<script>\s*([\s\S]*?)<\/script><\/body><\/html>/);
assert.ok(sweepBody,"No sunshaft sweep script");
new Script(sweepBody[1],{filename:"backyard-sunshaft-sweep-v2-1.js"});
console.log("PASS Backyard effects benchmark v2 static regression: canonical payload, 13 shaders, seven profiles, script syntax, and instrumentation");
const three = readFileSync("experiments/diagnostics/backyard-threejs-full-effects-pipeline-benchmark-v3-2026-10-15.html","utf8");
assert.equal(sourceChunks(three),b,"Three.js effects benchmark diverged from the accepted 179-part source");
for(const name of shaderNames)assert.equal(shader(three,name),shader(original,name),"Three.js effects benchmark GLSL drift: "+name);
assert.ok(three.includes("g.setAttribute('position',countAttribute)"),"Three.js scene source p/seed must provide draw counts");
for(const required of ["new T.WebGLRenderer","new T.RawShaderMaterial","new T.DepthTexture","new T.Points","new T.WebGLRenderTarget","source:'backyard-unified-effects-v1-1-precision-fix-2026-10-15.html'","measurementMs:2400","warmupMs:700","sunDir","frameIntervalMs","gpuTimer:"])
  assert.ok(three.includes(required),"Three.js effects benchmark missing explicit requirement: "+required);
const threeBody=three.match(/<script type="module">([\s\S]*?)<\/script><\/body><\/html>/);
assert.ok(threeBody,"Missing real Three.js module code");
new Script(threeBody[1],{filename:"backyard-threejs-effects-benchmark-v3.js"});
for(const token of ["EXT_disjoint_timer_query_webgl2","gl.beginQuery(timerExt.TIME_ELAPSED_EXT,q)","gl.endQuery(timerExt.TIME_ELAPSED_EXT)","GPU_DISJOINT_EXT","gpuPipelineMs","gpuTimer:!timerExt?","b.phase==='drain'"])
  assert.ok(three.includes(token),"Three.js asynchronous hardware query feature missing: "+token);
// Exercise the Three.js timer code with a WebGL2 protocol mock. GitHub-hosted
// SwiftShader does not expose the hardware timer extension on all runners.
const timerCode=three.match(/const timerExt=gl\.getExtension\('EXT_disjoint_timer_query_webgl2'\)[\s\S]*?(?=const diagnosticView=)/);
assert.ok(timerCode,"Missing extractable Three.js timer-query implementation");
function mockGpu(disjoint=false, supported=true){
  const ext={TIME_ELAPSED_EXT:150,GPU_DISJOINT_EXT:160};
  const gl={
    getExtension:()=>supported?ext:null,getParameter:()=>disjoint,
    createQuery:()=>({}),beginQuery:()=>{},endQuery:()=>{},deleteQuery:()=>{},
    QUERY_RESULT_AVAILABLE:170,QUERY_RESULT:180,
    getQueryParameter:(_,p)=>p===170?true:3200000,
  };
  const run=new Script(timerCode[0]+`
    const sample={gpu:[]};let selected=null;
    for(let i=0;i<3;i++)selected=beginGpu(sample);
    endGpu(selected);pollGpu();
    ({samples:sample.gpu,pending:gpuPending.length,disjoint:gpuDisjoint});
  `);
  return run.runInNewContext({gl,bench:{records:[{gpu:[]}]},console});
}
const validGpu=mockGpu(false,true);
assert.equal(validGpu.samples.length,1,"Three.js asynchronous GPU query did not yield a sample");
assert.equal(validGpu.samples[0],3.2,"Three.js GPU nanosecond conversion incorrect");
assert.equal(validGpu.pending,0,"Three.js completed GPU query was not released");
const absentGpu=mockGpu(false,false);
assert.equal(absentGpu.samples.length,0,"Unsupported GPU timer must not invent measurements");
const disjointGpu=mockGpu(true,true);
assert.equal(disjointGpu.samples.length,0,"Disjoint timer must invalidate GPU durations");
assert.equal(disjointGpu.disjoint,true,"GPU disjoint flag was not preserved");
console.log("PASS Three.js asynchronous WebGL2 GPU timer contract: valid, unsupported, and disjoint");
assert.ok(three.includes("window.__THREE_EFFECTS_DIAGNOSTIC__"),"Missing deterministic Three.js camera/time hook");
assert.ok(benchmark.includes("window.__CUSTOM_EFFECTS_DIAGNOSTIC__"),"Missing deterministic Custom camera/time hook");
assert.ok(three.includes("if(cfg.shafts&&daylight>.06)"),"Three.js cannot draw nonphysical sunshafts at night");
console.log("PASS Three.js v3 effects-matched static contract: original 13 shader definitions, identical source bytes, WebGL renderer, seven passes and scripted benchmark");
console.log("PASS Sunshaft v2.1 static diagnostic: unchanged original 13 shaders, verified scene and seven sample-count trials");
