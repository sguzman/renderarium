#!/usr/bin/env node
/**
 * Agent-owned canonical SC3D -> in-chat embed verification.
 * Does not start GitHub Actions, alter accepted scene assets, generate
 * approval evidence, or ask the user to inspect a local preview.
 *
 * node scripts/verify-chat-preview-pipeline.mjs [--scene factory]
 * node scripts/verify-chat-preview-pipeline.mjs --inventory
 *
 * Distinct evidence layers remain distinct. This checks actual source,
 * canonical semantics, prepared packets, inline bundle and simulated host;
 * it does NOT certify actual ChatGPT display, Three.js or physical GPU.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const allowed=new Set([
  "living-room","kitchen","bathroom","office","backyard","garage","factory"
]);
const args=process.argv.slice(2);
const inventory=args.length===1&&args[0]==="--inventory";
assert(inventory||args.length===0||
  (args.length===2&&args[0]==="--scene"&&allowed.has(args[1])),
  "usage: node scripts/verify-chat-preview-pipeline.mjs [--scene accepted-name|--inventory]");
const sceneArg=inventory||args.length===0?[]:args;

const steps=[
  ["verification driver receipts and strict arguments","scripts/test-chat-preview-pipeline-driver.mjs",[]],
  ["accepted visual verdicts and frozen source revisions","scripts/check-block-chibi-visual-acceptance.mjs",["--self-test"]],
  ["independent Git frozen-worktree guard regressions","scripts/test-frozen-worktree.mjs",[]],
  ["immutable accepted-ledger revision and tamper checks","scripts/test-accepted-ledger-pin.mjs",[]],
  ["source-blob/geometry structural pins", "tools/verify-chibi-campaign.mjs",[]],
  ["source YAML-to-chat geometric part parity","scripts/test-chat-authored-source-parity.mjs",sceneArg],
  ["no-write semantic assembly regression","scripts/test-sc3d-assembly-check-only.mjs",[]],
  ["canonical hierarchy fail-closed contract","scripts/test-canonical-chat-ancestry.mjs",[]],
  ["canonical primitive/material parity contract","scripts/test-canonical-chat-primitive.mjs",[]],
  ["actual semantic lowerer on all seven frozen chat grammars","scripts/test-chat-semantic-roundtrip.mjs",[]],
  ["canonical SC3D source vs accepted scenes","scripts/check-block-chibi-canonical.mjs",sceneArg],
  ["independent world-matrix transform parity","scripts/test-chat-world-matrix-parity.mjs",[]],
  ["real production Three.js geometry/hierarchy parity","scripts/test-chat-three-adapter-parity.mjs",sceneArg],
  ["in-chat depth/transform/control regression","scripts/test-chat-scene-preview-core.mjs",[]],
  ["frozen alternate-raster appearance fingerprints","scripts/test-chat-raster-signatures.mjs",[]],
  ["camera/depth stress across seven accepted scenes","scripts/test-chat-camera-depth-stress.mjs",[]],
  ["Ajv/canonical-IR-checked chat transport packet","scripts/test-chat-review-packet.mjs",sceneArg],
  ["actual packet -> self-contained embed -> fake chat host","scripts/test-chat-review-embed.mjs",sceneArg],
];

const planned=steps.map(([label,path,extraArgs],index)=>({
  step:index+1,label,script:path,args:extraArgs
}));
if(inventory){
  console.log(JSON.stringify({format:"scenarium-chat-preview-inventory-v1",
    total:planned.length,steps:planned},null,2));
  process.exit(0);
}

const receipt={
  format:"scenarium-chat-preview-run-receipt-v1",
  scene:sceneArg.length?sceneArg[1]:"all",
  total:planned.length,completed:0,status:"failed",steps:[]
};
function emitReceipt(){
  // Distinguish completed verification from incomplete or failed attempts.
  console.log("SCENARIUM_VERIFY_RECEIPT="+JSON.stringify(receipt));
}
let failed=false;
for(const step of planned){
  process.stdout.write("\nVERIFY "+step.step+"/"+planned.length+
    " "+step.label+"\n");
  const started=process.hrtime.bigint();
  const proc=spawnSync(process.execPath,[resolve(root,step.script),...step.args],{
    cwd:root,encoding:"utf8",timeout:180000,maxBuffer:12*1024*1024
  });
  if(proc.stdout) process.stdout.write(proc.stdout);
  if(proc.stderr) process.stderr.write(proc.stderr);
  const elapsedMs=Number((process.hrtime.bigint()-started)/1000000n);
  const ok=!proc.error&&proc.status===0;
  const result={...step,status:ok?"passed":"failed",exit_code:proc.status,
    signal:proc.signal??null,elapsed_ms:elapsedMs};
  if(proc.error)result.error=proc.error.code??proc.error.message;
  receipt.steps.push(result);
  if(!ok){
    receipt.failure={stage:"verification",step:step.step,script:step.script,
      reason:proc.error?.message??(proc.signal?
        "signal "+proc.signal:"exit "+proc.status)};
    console.error("FAIL "+step.label+"; "+receipt.failure.reason);
    failed=true;
    break;
  }
  receipt.completed++;
}

// Never let an earlier successful source check hide edits made by later
// verification steps, including when one of those steps fails midway.
const freezeScript="scripts/check-block-chibi-visual-acceptance.mjs";
process.stdout.write("\nPOSTFLIGHT: verify all accepted source revisions again\n");
const postStarted=process.hrtime.bigint();
const post=spawnSync(process.execPath,[resolve(root,freezeScript)],{
  cwd:root,encoding:"utf8",timeout:180000,maxBuffer:12*1024*1024
});
if(post.stdout) process.stdout.write(post.stdout);
if(post.stderr) process.stderr.write(post.stderr);
const postOk=!post.error&&post.status===0;
receipt.postflight={script:freezeScript,status:postOk?"passed":"failed",
  exit_code:post.status,signal:post.signal??null,
  elapsed_ms:Number((process.hrtime.bigint()-postStarted)/1000000n)};
if(post.error) receipt.postflight.error=post.error.code??post.error.message;
if(!postOk){
  const reason=post.error?.message??(post.signal?
    "signal "+post.signal:"exit "+post.status);
  console.error("FAIL final accepted-scene source integrity; "+reason);
  if(!receipt.failure) receipt.failure={stage:"postflight",script:freezeScript,reason};
  failed=true;
}
receipt.status=failed?"failed":"passed";
emitReceipt();
if(failed){
  console.error("Chat preview delivery is NOT verified; no human review needed.");
  process.exit(1);
}
console.log("\nPASS "+receipt.completed+"/"+planned.length+
  " local agent-owned source/semantic/transport/simulated-host verification gates.");
console.log("PASS accepted-scene integrity independently rechecked after suite.");
console.log("NOT TESTED HERE: actual in-chat widget delivery, "+
  "canonical Three.js display or physical GPU. Prior visual approvals unchanged.");
