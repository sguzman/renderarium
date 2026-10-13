#!/usr/bin/env node
/**
 * Export the actual canonical Three.js car review to one offline HTML file.
 * The reviewed SC3D models are lowered with the production loader. The offline
 * packaging changes module delivery, not mesh geometry or rendering.
 */
import assert from "node:assert/strict";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {loadSc3dFile} from "../runtime/sc3d/load.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const at=path=>readFileSync(resolve(root,path),"utf8");
const uri=s=>"data:text/javascript;base64,"+Buffer.from(s,"utf8").toString("base64");
const core=at("node_modules/three/build/three.core.js");
let three=at("node_modules/three/build/three.module.js");
assert(three.includes("./three.core.js"),"Three.js changed its export structure");
three=three.replaceAll("'./three.core.js'",JSON.stringify(uri(core)))
           .replaceAll('"./three.core.js"',JSON.stringify(uri(core)));
assert(!three.includes("./three.core.js"),"Unresolved Three.js core import");
const threeUrl=uri(three);
let adapter=at("runtime/sc3d/three-adapter-browser.mjs");
assert(adapter.includes('"/vendor/three.module.js"'));
adapter=adapter.replaceAll('"/vendor/three.module.js"',JSON.stringify(threeUrl));
const data={
 "/vendor/three.module.js":threeUrl,
 "/runtime/sc3d/three-adapter-browser.mjs":uri(adapter),
 "/runtime/sc3d/preview-render-budget.mjs":uri(at("runtime/sc3d/preview-render-budget.mjs")),
 "/runtime/sc3d/preview-frame-proof.mjs":uri(at("runtime/sc3d/preview-frame-proof.mjs")),
 "/runtime/sc3d/quality-experiments.mjs":uri(at("runtime/sc3d/quality-experiments.mjs"))
};
let html=at("scenes/sc3d-preview/index.html");
for(const [specifier,url] of Object.entries(data)){
  assert(html.includes(JSON.stringify(specifier)),"Missing canonical module "+specifier);
  html=html.replaceAll(JSON.stringify(specifier),JSON.stringify(url));
}
const versions=["v2","v3","v4","v5","v6"];
const assets={};
for(const version of versions){
 const ir=await loadSc3dFile(resolve(root,
   "assets/constructive-3d/garages/block-chibi-compact-car-"+version+".sc3d.yml"));
 assert.equal(ir.asset.id,"block-chibi-compact-car-"+version);
 assets[version]=ir;
}
// Embedded responses remove the need for localhost or any online fetch.
const stub=`<script>
(()=>{
const versions=${JSON.stringify(versions)};
const assets=${JSON.stringify(assets).replaceAll("<","\\u003c")};
const previousFetch=window.fetch?.bind(window);
window.fetch=function(input,options){
 const requested=new URL(typeof input==="string"?input:input.url,location.href);
 if(requested.pathname==="/vehicle-list.json")
   return Promise.resolve(new Response(JSON.stringify({versions,initial:"v5"}),
     {status:200,headers:{"content-type":"application/json"}}));
 if(requested.pathname==="/asset-ir.json"){
   const id=requested.searchParams.get("vehicle")||"v5";
   const asset=assets[id];
   return Promise.resolve(new Response(JSON.stringify(asset||{error:"unknown model"}),
     {status:asset?200:400,headers:{"content-type":"application/json"}}));
 }
 return previousFetch?previousFetch(input,options):Promise.reject(Error("Unexpected offline fetch"));
};
})();
<\/script>`;
assert(html.includes('<script type="module">'),"Canonical module boot missing");
html=html.replace('<script type="module">',stub+'\n<script type="module">');
const urlSeed='<script>if(!location.search)history.replaceState(null,"",location.href+"?vehicle=v5");<\/script>';
html=html.replace('<script type="module">',urlSeed+'\n<script type="module">');
const out=resolve(root,process.argv[2]??"artifacts/vehicle-review-qa/renderarium-canonical-car-review.html");
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,html);
console.log("Exported canonical offline Three.js review "+out+" ("+Buffer.byteLength(html)+" bytes)");
