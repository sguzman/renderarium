#!/usr/bin/env node
/** Create a fully offline, source-bound copy of the production Three.js car viewer. */
import assert from "node:assert/strict";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {loadSc3dFile} from "../runtime/sc3d/load.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const text=path=>readFileSync(resolve(root,path),"utf8");
const pack=value=>gzipSync(Buffer.from(value)).toString("base64");
const versions=["v2","v3","v4","v5","v6","v7","v8","v9","v10","v11","v11r"];
const assets={};
for(const version of versions){
  const ir=await loadSc3dFile(resolve(root,
    "assets/constructive-3d/garages/block-chibi-compact-car-"+version+".sc3d.yml"));
  assert.equal(ir.asset.id,"block-chibi-compact-car-"+version);
  assets[version]=ir;
}
let html=text("scenes/sc3d-preview/index.html");
const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(match,"Original canonical Three.js viewer module missing");
const packageData={
  core:pack(text("node_modules/three/build/three.core.js")),
  three:pack(text("node_modules/three/build/three.module.js")),
  adapter:pack(text("runtime/sc3d/three-adapter-browser.mjs")),
  renderBudget:pack(text("runtime/sc3d/preview-render-budget.mjs")),
  frame:pack(text("runtime/sc3d/preview-frame-proof.mjs")),
  quality:pack(text("runtime/sc3d/quality-experiments.mjs")),
  viewer:pack(match[1]),
  assets:pack(JSON.stringify(assets))
};
const bootstrap=`<script type="module">
const blobs=${JSON.stringify(packageData)};
async function inflate(encoded){
  const zipped=Uint8Array.from(atob(encoded), c=>c.charCodeAt(0));
  const decoded=new Blob([zipped]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(decoded).text();
}
const [core,three,adapter,renderBudget,frame,quality,viewer,assets]=
  await Promise.all(["core","three","adapter","renderBudget","frame","quality","viewer","assets"]
    .map(key=>inflate(blobs[key])));
const data=JSON.parse(assets);
const versions=${JSON.stringify(versions)};
const oldFetch=window.fetch?.bind(window);
window.fetch=(input,options)=>{
  const request=new URL(typeof input==="string"?input:input.url,location.href);
  if(request.pathname==="/vehicle-list.json"){
    return Promise.resolve(new Response(JSON.stringify({versions,initial:"v5"}),
      {status:200,headers:{"content-type":"application/json"}}));
  }
  if(request.pathname==="/asset-ir.json"){
    const version=request.searchParams.get("vehicle")||"v5";
    return Promise.resolve(new Response(JSON.stringify(data[version]||{}),
      {status:data[version]?200:400,headers:{"content-type":"application/json"}}));
  }
  return oldFetch?oldFetch(input,options):Promise.reject(Error("Unexpected offline fetch"));
};
if(!location.search)history.replaceState(null,"",location.href+"?vehicle=v5");
const moduleUrl=source=>URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
const coreUrl=moduleUrl(core);
const threeRewritten=three.replaceAll("'./three.core.js'",JSON.stringify(coreUrl))
  .replaceAll('"./three.core.js"',JSON.stringify(coreUrl));
if(threeRewritten.includes("./three.core.js"))throw Error("Three core unresolved");
const threeUrl=moduleUrl(threeRewritten);
const adapterUrl=moduleUrl(adapter.replaceAll('"/vendor/three.module.js"',JSON.stringify(threeUrl)));
const modules={
  "/vendor/three.module.js":threeUrl,
  "/runtime/sc3d/three-adapter-browser.mjs":adapterUrl,
  "/runtime/sc3d/preview-render-budget.mjs":moduleUrl(renderBudget),
  "/runtime/sc3d/preview-frame-proof.mjs":moduleUrl(frame),
  "/runtime/sc3d/quality-experiments.mjs":moduleUrl(quality)
};
let canonical=viewer;
for(const [specifier,url] of Object.entries(modules)){
  if(!canonical.includes(JSON.stringify(specifier)))
    throw Error("Canonical viewer import missing "+specifier);
  canonical=canonical.replaceAll(JSON.stringify(specifier),JSON.stringify(url));
}
await import(moduleUrl(canonical));
<\/script>`;
html=html.replace(/<script type="importmap">[\s\S]*?<\/script>/,"");
html=html.replace(match[0],bootstrap);
const out=resolve(root,process.argv[2]??"artifacts/vehicle-review-qa/renderarium-canonical-car-review.html");
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,html);
console.log("Exported canonical offline Three.js review "+out+" ("+Buffer.byteLength(html)+" bytes)");
