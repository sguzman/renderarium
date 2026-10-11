#!/usr/bin/env node
/** Dependency-free regression for the driver, without testing frozen scenes. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here=dirname(fileURLToPath(import.meta.url));
const driver=resolve(here,"verify-chat-preview-pipeline.mjs");
const tmp=mkdtempSync(join(tmpdir(),"scenarium-preview-driver-"));
const copied=join(tmp,"scripts/verify-chat-preview-pipeline.mjs");
function run(script,args=[]){return spawnSync(process.execPath,[script,...args],{
  encoding:"utf8",timeout:20000,maxBuffer:1024*1024
});}
try{
  mkdirSync(dirname(copied),{recursive:true});
  copyFileSync(driver,copied);
  const inventory=run(copied,["--inventory"]);
  assert.equal(inventory.status,0,inventory.stderr);
  const plan=JSON.parse(inventory.stdout);
  assert.equal(plan.format,"scenarium-chat-preview-inventory-v1");
  assert.equal(plan.total,18);
  assert.equal(plan.steps.length,18);
  assert.equal(plan.steps[0].script,"scripts/test-chat-preview-pipeline-driver.mjs");
  assert.equal(plan.steps[1].script,"scripts/check-block-chibi-visual-acceptance.mjs");
  assert.equal(plan.steps[2].script,"scripts/test-frozen-worktree.mjs");
  assert.equal(plan.steps[3].script,"scripts/test-accepted-ledger-pin.mjs");
  assert.equal(plan.steps.at(-1).script,"scripts/test-chat-review-embed.mjs");
  assert(plan.steps.some(step=>step.script==="scripts/test-chat-three-adapter-parity.mjs"),
    "actual Three.js adapter parity missing from pipeline");
  const subset=run(copied,["--scene","factory","--inventory"]);
  assert.notEqual(subset.status,0,"unexpected extra args accepted");
  const unknown=run(copied,["--scene","unknown"]);
  assert.notEqual(unknown.status,0,"unknown scene accepted");
  const incomplete=run(copied);
  assert.equal(incomplete.status,1,"missing first gate should fail closed");
  const line=incomplete.stdout.split("\n").find(s=>
    s.startsWith("SCENARIUM_VERIFY_RECEIPT="));
  assert(line,"missing machine-readable failure receipt");
  const receipt=JSON.parse(line.slice("SCENARIUM_VERIFY_RECEIPT=".length));
  assert.equal(receipt.format,"scenarium-chat-preview-run-receipt-v1");
  assert.equal(receipt.status,"failed");
  assert.equal(receipt.total,18);
  assert.equal(receipt.completed,0);
  assert.equal(receipt.steps.length,1,"driver did not fail fast");
  assert.equal(receipt.failure.step,1);
  assert.equal(receipt.steps[0].status,"failed");
  assert.equal(receipt.steps[0].exit_code,1);
  assert.equal(receipt.postflight.status,"failed",
    "missing postflight checker should be reported on early failure");
  // Supply harmless ephemeral zero-exit stand-ins for all sixteen gates.
  // This verifies orchestration success without touching approved scenes or
  // pretending that the real source/renderer tests ran.
  for(const gate of plan.steps){
    const path=join(tmp,gate.script);
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path, 'process.stdout.write("fixture pass\\n");\n');
  }
  const successful=run(copied,["--scene","factory"]);
  assert.equal(successful.status,0,successful.stderr);
  const successLine=successful.stdout.split("\n").find(s=>
    s.startsWith("SCENARIUM_VERIFY_RECEIPT="));
  assert(successLine,"missing success receipt");
  const passed=JSON.parse(successLine.slice("SCENARIUM_VERIFY_RECEIPT=".length));
  assert.equal(passed.status,"passed");
  assert.equal(passed.scene,"factory");
  assert.equal(passed.completed,18);
  assert.equal(passed.steps.length,18);
  assert(passed.steps.every(step=>step.status==="passed"&&step.exit_code===0));
  assert.equal(passed.postflight.status,"passed",
    "successful gates must still run the accepted-source postflight");

  // A late stage that mutates the frozen sources must not produce a PASS
  // merely because the acceptance test ran earlier in the suite.
  const marker=join(tmp,"pretend-accepted-source-mutated");
  const guard=join(tmp,"scripts/check-block-chibi-visual-acceptance.mjs");
  writeFileSync(guard,
    'import { existsSync } from "node:fs";\n'+
    'process.exit(existsSync('+JSON.stringify(marker)+')?7:0);\n');
  const late=join(tmp,plan.steps[8].script);
  writeFileSync(late,
    'import {writeFileSync} from "node:fs";\n'+
    'writeFileSync('+JSON.stringify(marker)+',"drift");\n');
  const rejected=run(copied);
  assert.equal(rejected.status,1,"late frozen-source drift was accepted");
  const rejectedLine=rejected.stdout.split("\n").find(s=>
    s.startsWith("SCENARIUM_VERIFY_RECEIPT="));
  assert(rejectedLine,"missing postflight failure receipt");
  const bad=JSON.parse(rejectedLine.slice("SCENARIUM_VERIFY_RECEIPT=".length));
  assert.equal(bad.completed,18,"late drift did not pass prior gate stubs");
  assert.equal(bad.postflight.status,"failed");
  assert.equal(bad.failure.stage,"postflight");
  assert.equal(bad.status,"failed");
  rmSync(marker);
  writeFileSync(late,
    'import {writeFileSync} from "node:fs";\n'+
    'writeFileSync('+JSON.stringify(marker)+',"failed-stage-drift");\n'+
    'process.exit(9);\n');
  const interrupted=run(copied);
  assert.equal(interrupted.status,1,"interrupted run must fail");
  const interruptedLine=interrupted.stdout.split("\n").find(s=>
    s.startsWith("SCENARIUM_VERIFY_RECEIPT="));
  assert(interruptedLine,"missing receipt on failed gate with source drift");
  const interruptedReceipt=JSON.parse(interruptedLine.slice(
    "SCENARIUM_VERIFY_RECEIPT=".length));
  assert.equal(interruptedReceipt.completed,8);
  assert.equal(interruptedReceipt.failure.stage,"verification");
  assert.equal(interruptedReceipt.steps.at(-1).exit_code,9);
  assert.equal(interruptedReceipt.postflight.status,"failed",
    "postflight must also detect damage from a failed stage");

  console.log("PASS chat pipeline driver: 18-gate inventory, strict CLI, "+
    "fail-closed execution, postflight source guard and machine-readable receipts");
}finally{rmSync(tmp,{recursive:true,force:true});}
