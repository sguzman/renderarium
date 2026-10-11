#!/usr/bin/env node
/**
 * Generate an INLINE ChatGPT visualization fragment from canonical-checked
 * scene data and the shared alternate CPU-depth renderer. NOT a local page.
 *
 * node scripts/emit-chat-review-embed.mjs --scene factory
 *
 * This output is for the raw visual content of an in-chat embed, with user
 * controls implemented separately by chat UI state bindings.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const args=process.argv.slice(2);
const sceneNames=new Set([
  "living-room","kitchen","bathroom","office","backyard","garage","factory"
]);
if(args.length!==2 || args[0]!=="--scene" || !sceneNames.has(args[1])){
  console.error("usage: node scripts/emit-chat-review-embed.mjs --scene <accepted-scene>");
  process.exit(2);
}
const packetText=execFileSync(process.execPath,[
  resolve(root,"scripts/emit-chat-review-packet.mjs"),...args
],{cwd:root,encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024});
const packet=JSON.parse(packetText);
// A scene may appear more than once in chat. Never route host events to
// the first widget sharing a scene ID.
const instanceId="scenarium-"+randomUUID();
assert.equal(packet.format,"scenarium-chat-review-packet-v1");
assert.equal(packet.state,"prepared_not_presented");
assert.equal(packet.renderer_claim,"canonical_ir_alternate_renderer");

const core=readFileSync(resolve(root,"runtime/chat/scene-preview-core.mjs"),"utf8");
assert(!/^\s*import\s/m.test(core),"portable renderer must have zero runtime imports");
assert(!/^\s*export\s+(?!function\b)/m.test(core),"unexpected portable exports");
const bundledCore=core.replace(/^export (?=function )/gm,"");
assert(!/^\s*export\s/m.test(bundledCore),"unresolved export in portable core");
// Data cannot terminate inline script or generate HTML through source strings.
const json=JSON.stringify(packet).replace(/</g,"\\u003c").replace(/>/g,"\\u003e")
  .replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
const script=[
  "(() => {",
  '"use strict";',
  "const packet="+json+";",
  bundledCore,
  'const rootNode=document.currentScript?.previousElementSibling ?? document.querySelector('+JSON.stringify('[data-scenarium-chat-instance="'+instanceId+'"]')+');',
  'if(!rootNode) throw new Error("Scenarium in-chat container unavailable");',
  'const canvas=rootNode.querySelector("canvas");',
  'const status=rootNode.querySelector("[data-status]");',
  'const error=rootNode.querySelector("[data-error]");',
  'if(!canvas||!status||!error) throw new Error("Incomplete Scenarium chat widget");',
  'let viewer;',
  'try {',
  '  viewer=createChatSceneViewer({canvas,packet,maxWidth:700,',
  '    onStatus: value => {',
  '      const effects=packet.canonical_semantics.material_effects_not_rendered;',
  '      status.textContent=value.parts+" / "+value.total+" pieces · CPU depth"+',
  '        (effects.length?" · "+effects.join(", ")+" not rendered":"");',
  '    },',
  '    onError: err => {',
  '      error.style.display="block";',
  '      error.textContent="Viewer failure: "+String(err?.message??err);',
  '      status.textContent="Preview unavailable";',
  '    }',
  '  });',
  '} catch (err) {',
  '  error.style.display="block";',
  '  error.textContent="Viewer initialization failed: "+String(err?.message??err);',
  '  status.textContent="Preview unavailable";',
  '  return;',
  '}',
  'let lastPresetRev,lastZoomRev,lastVisibility;',
  'globalThis.__effect?.(()=>{',
  '  const state=globalThis.__bindings?.value;',
  '  if(!state||typeof state!=="object")return;',
  '  if(Number.isInteger(state.presetRevision) && state.presetRevision!==lastPresetRev){',
  '    lastPresetRev=state.presetRevision;',
  '    viewer.preset(state.preset||"reset");',
  '  }',
  '  const vis=state.visibility;',
  '  if(vis&&typeof vis==="object"){',
  '    const serial=JSON.stringify(vis);',
  '    if(serial!==lastVisibility){lastVisibility=serial;viewer.setVisibilityMap(vis);}',
  '  }',
  '  if(Number.isInteger(state.zoomRevision) && state.zoomRevision!==lastZoomRev){',
  '    lastZoomRev=state.zoomRevision;',
  '    if(typeof state.zoomFactor==="number")viewer.zoomBy(state.zoomFactor);',
  '  }',
  '});',
  '})();',
].join("\n");
const html=[
  '<div data-scenarium-chat-viewer="'+packet.scene+'" data-scenarium-chat-instance="'+instanceId+'" style="position:relative;width:100%;background:#e9f0eb;border-radius:12px;overflow:hidden">',
  '<canvas style="display:block;width:100%;height:420px;max-height:65vh;min-height:280px;touch-action:none;cursor:grab" aria-label="Interactive '+packet.scene+' 3D scene; drag to orbit and scroll to zoom"></canvas>',
  '<div data-status role="status" style="position:absolute;left:12px;bottom:12px;padding:7px 10px;border-radius:7px;background:#fffdf8e6;color:#36554c;font:12px system-ui">Preparing source-bound geometry…</div>',
  '<div data-error role="alert" style="display:none;position:absolute;inset:12px;background:#fff0e9;color:#952e2e;border-radius:8px;padding:16px;font:14px system-ui"></div>',
  '</div>',
  '<script>'+script.replace(/<\/script/gi,"<\\/script")+'</script>'
].join("");
process.stdout.write(html+"\n");
