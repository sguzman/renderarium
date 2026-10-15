#!/usr/bin/env node
/**
 * Integration test for the inline chat component, not for Three.js or the
 * actual ChatGPT client. Generates REAL canonical-checked packets and then
 * executes each embeddable script with a fake host/canvas.
 *
 * Run by agent: node scripts/test-chat-review-embed.mjs
 * No GitHub Actions, browser, preview server or human QA required.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const emitter=resolve(root,"scripts/emit-chat-review-embed.mjs");
const scenes=["living-room","kitchen","bathroom","office","backyard","garage","factory"];
const args=process.argv.slice(2);
assert(args.length===0 || (args.length===2 && args[0]==="--scene" && scenes.includes(args[1])),
  "usage: node scripts/test-chat-review-embed.mjs [--scene accepted-name]");
const selected=args.length?[args[1]]:scenes;

function nonBackground(frame){
  let count=0;
  for(let i=0;i<frame.data.length;i+=4) {
    if(frame.data[i]!==233||frame.data[i+1]!==240||frame.data[i+2]!==235)count++;
  }
  return count;
}
for(const name of selected){
  const preview=JSON.parse(readFileSync(resolve(root,
    "scenes/block-chibi-"+name+"-v1/preview-geometry.json"),"utf8"));
  const html=execFileSync(process.execPath,[emitter,"--scene",name],{
    cwd:root,encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024
  });
  assert(html.startsWith('<div data-scenarium-chat-viewer="block-chibi-'+name+'-v1"'),
    name+": in-chat fragment identity drift");
  assert(!html.includes("<html")&&!html.includes("<body")&&
    !/<script[^>]+src=/i.test(html),
    name+": chat embedding silently became a standalone or network-loaded page");
  const match=html.match(/<script>([\s\S]+)<\/script>/);
  assert(match,name+": inline script missing");
  const script=match[1];
  const instanceId=html.match(/data-scenarium-chat-instance="([^"]+)"/)?.[1];
  assert.match(instanceId??"",/^scenarium-[a-f0-9-]{36}$/,
    name+": embed must have a unique UUID instance identity");
  assert(script.includes(JSON.stringify(
    '[data-scenarium-chat-instance="'+instanceId+'"]')),
    name+": script cannot find its own instance without currentScript");
  assert(!/^\s*(?:import|export)\s/m.test(script),
    name+": chat embedding contains an unresolved JS module dependency");
  const handlers=new Map();
  const state={
    presetRevision:0,preset:"reset",visibility:{},
    zoomRevision:0,zoomFactor:1
  };
  let hostEffect=null,draws=0,rendered=null;
  const canvas={
    width:0,height:0,
    getBoundingClientRect:()=>({width:240,height:155}),
    getContext:(type)=>{
      assert.equal(type,"2d");
      return {
        createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
        putImageData:(frame)=>{draws++;rendered=frame;},
      };
    },
    addEventListener:(name,handler)=>handlers.set(name,handler),
    removeEventListener:(name)=>handlers.delete(name),
    setPointerCapture:()=>{},
  };
  const status={textContent:"waiting"};
  const error={style:{display:"none"},textContent:""};
  const rootNode={querySelector:selector=>
    selector==="canvas"?canvas:
    selector==="[data-status]"?status:
    selector==="[data-error]"?error:null
  };
  const document={
    // Test fallback specifically for Factory: script injection can leave
    // document.currentScript null in some chat-host execution contexts.
    currentScript:name==="factory"?null:{previousElementSibling:rootNode},
    querySelector:selector=>{
      assert.equal(selector,
        '[data-scenarium-chat-instance="'+instanceId+'"]',
        name+": global selector would bind the wrong repeated scene");
      return rootNode;
    }
  };
  const host={
    __bindings:{value:state},
    __effect:(fn)=>{hostEffect=fn;fn();}
  };
  runInNewContext(script,{document,globalThis:host},{
    timeout:20000,filename:"in-chat-embed-"+name+".js"
  });
  assert.equal(error.style.display,"none",
    name+": chat embed error: "+error.textContent);
  assert(hostEffect,name+": host controls not wired");
  const original=rendered?.data?.slice();
  assert(original && nonBackground({data:original})>1000,name+": empty in-chat frame");
  assert(status.textContent.startsWith(
    String(preview.mesh_count??preview.geometry_count)+" / "+
    String(preview.mesh_count??preview.geometry_count)+" pieces"
  ),name+": live count status missing: "+status.textContent);
  const hiddenId=preview.groups[0].id;
  const hiddenCount=preview.parts.split("\n").filter(Boolean).filter(row=>
    Number(row.split("|")[0])===0).length;
  state.visibility={[hiddenId]:false};
  state.presetRevision=1;
  state.preset="overhead";
  hostEffect();
  assert(status.textContent.startsWith(
    String((preview.mesh_count??preview.geometry_count)-hiddenCount)+" / "
  ),name+": group hiding failed: "+status.textContent);
  assert(draws>=3,name+": host state failed to trigger redraw");
  const beforePan=rendered?.data.slice();
  handlers.get("pointerdown")({pointerId:1,clientX:12,clientY:30});
  handlers.get("pointermove")({pointerId:1,clientX:88,clientY:54});
  handlers.get("pointerup")({pointerId:1});
  assert.notDeepEqual(rendered?.data,beforePan,name+": orbit failed to redraw");
  handlers.get("wheel")({deltaY:-260,preventDefault:()=>{}});
  state.zoomRevision=1;
  state.zoomFactor=1.1;
  hostEffect();
  assert.equal(error.style.display,"none",
    name+": chat interaction error: "+error.textContent);
  if (name==="factory") {
    const second=execFileSync(process.execPath,[emitter,"--scene",name],{
      cwd:root,encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024
    });
    const secondId=second.match(/data-scenarium-chat-instance="([^"]+)"/)?.[1];
    assert(secondId&&secondId!==instanceId,
      "two in-chat embeds of the same scene must have separate selectors");
  }
  console.log("PASS "+name+" chat fragment: no external imports, "+
    "nonblank depth frame, DIL-like group visibility/preset, orbit and zoom");
}
console.log("Only simulated chat-host delivery tested; not a live ChatGPT embed or canonical Three.js.");
