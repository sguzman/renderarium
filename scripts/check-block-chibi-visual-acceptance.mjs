#!/usr/bin/env node
/**
 * Verify the already accepted block-chibi visuals have not been changed.
 * Checks 7 pinned room assemblies, 7 accepted preview records, and
 * all 84 component blob pins. Does not modify frozen scene files.
 *
 * node scripts/check-block-chibi-visual-acceptance.mjs [--self-test]
 *
 * Acceptance is USER VISUAL REVIEW ONLY. It is not evidence that
 * canonical Three.js rendered, or that an Ajv/Node integration passed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFrozenWorktreeClean } from "./check-frozen-worktree.mjs";
import {assertAcceptedLedgerRevision} from "../runtime/chat/accepted-ledger-pin.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const ledgerPath=resolve(root,"contracts/accepted-block-chibi-v1.json");
const amendmentPath="contracts/accepted-backyard-geometry-amendment-2026-10-14.json";
const AMENDMENT_BLOB="5c4c69a05743b84c793b80289ca7be441dce5b7a";
const acceptedCurrentBackyard={parts:179,preview:"ba84322ab1a5c1e7db4515b35bd0ce760d3cbc03",shell:"6a310a23e80863f18d8abb88b8cad18a9aaf2029"};
function verifyAmendment(ledger){
  assert.equal(gitBlob(amendmentPath),AMENDMENT_BLOB,
    "accepted Backyard geometry amendment changed");
  const amendment=JSON.parse(sourceBytes(amendmentPath).toString("utf8"));
  assert.equal(amendment.format,"scenarium-accepted-backyard-geometry-amendment-v1");
  assert.equal(amendment.baseline_ledger_blob,"d49365235fd3c60c0693a7c04ead0464640955da");
  const original=ledger.recorded_scenes[4];
  assert.equal(original.scene,amendment.scene);
  assert.equal(original.primitives,amendment.baseline.parts);
  assert.equal(original.preview_git_blob,amendment.baseline.preview_blob);
  assert.equal(gitBlob(amendment.baseline.historical_preview_path),original.preview_git_blob,
    "historical accepted Backyard preview not preserved");
  assert.equal(gitBlob(amendment.baseline.historical_shell_path),amendment.baseline.shell_blob,
    "historical accepted Backyard shell not preserved");
  const before=JSON.parse(sourceBytes(amendment.baseline.historical_preview_path).toString("utf8"));
  assert.equal(before.groups[0].source_blob,amendment.baseline.shell_blob);
  assert.equal(before.mesh_count,181);
  assert.equal(before.parts.split("\n").length,181);
  assert.equal(amendment.corrected.parts,acceptedCurrentBackyard.parts);
  assert.equal(amendment.corrected.preview_blob,acceptedCurrentBackyard.preview);
  assert.equal(amendment.corrected.shell_blob,acceptedCurrentBackyard.shell);
  assert.equal(amendment.corrected.preview_path,original.preview_path);
  assert.equal(gitBlob(amendment.corrected.preview_path),amendment.corrected.preview_blob,
    "accepted corrected Backyard preview changed");
  assert.equal(gitBlob(amendment.corrected.shell_path),amendment.corrected.shell_blob,
    "accepted corrected Backyard source changed");
  return amendment;
}
const sceneNames=[
  "living-room","kitchen","bathroom","office","backyard","garage","factory"
];
const sizes=[[87,9],[149,11],[139,10],[104,12],[181,18],[112,8],[209,16]];
const bufferCache=new Map(),blobCache=new Map();
function sourceBytes(path) {
  assert(typeof path==="string"&&path.length>0,"missing source path");
  const abs=resolve(root,path);
  assert(abs.startsWith(root+sep),"source path escapes repository: "+path);
  if(!bufferCache.has(path))bufferCache.set(path,readFileSync(abs));
  return bufferCache.get(path);
}
function gitBlob(path) {
  if(!blobCache.has(path)){
    const content=sourceBytes(path);
    const hash=createHash("sha1").update("blob "+content.length+"\0")
      .update(content).digest("hex");
    blobCache.set(path,hash);
  }
  return blobCache.get(path);
}
function checkLedger(ledger) {
  assert.equal(ledger.format,"scenarium-visual-acceptance-ledger-v1");
  assert.equal(ledger.source_geometry,"frozen");
  assert.equal(ledger.repeat_visual_review,
    "forbidden_without_explicit_owner_request");
  assert.equal(ledger.canonical_threejs,"unverified");
  assert.equal(ledger.recorded_scenes?.length,7,"exactly seven accepted scenes");
  const amendment=verifyAmendment(ledger);
  const ids=new Set();
  let parts=0,groups=0,sourcePins=0;
  for(const [i,item] of ledger.recorded_scenes.entries()){
    const name=sceneNames[i],scene="block-chibi-"+name+"-v1";
    assert(!ids.has(item.scene),"duplicate acceptance "+item.scene);
    ids.add(item.scene);
    assert.equal(item.scene,scene,"scene identity/order drift");
    assert.equal(item.visual_review,"accepted","approval state changed");
    assert.equal(item.visual_scope,"appearance_and_composition");
    assert.equal(item.assembly_path,"scenes/"+scene+"/room.assembly.yml");
    assert.equal(item.preview_path,"scenes/"+scene+"/preview-geometry.json");
    assert.match(item.assembly_git_blob,/^[0-9a-f]{40}$/);
    assert.match(item.preview_git_blob,/^[0-9a-f]{40}$/);
    assert.equal(gitBlob(item.assembly_path),item.assembly_git_blob,
      scene+": accepted assembly changed");
    const amended=name==="backyard";
    if(!amended)assert.equal(gitBlob(item.preview_path),item.preview_git_blob,
      scene+": accepted preview changed");
    else assert.equal(gitBlob(item.preview_path),amendment.corrected.preview_blob,
      scene+": subsequently accepted 179-part preview changed");
    const preview=JSON.parse(sourceBytes(item.preview_path).toString("utf8"));
    assert.equal(preview.scene,scene);
    assert.equal(preview.source_assembly,item.assembly_path);
    assert.equal(preview.source_assembly_blob,item.assembly_git_blob);
    const acceptedPartCount=amended?amendment.corrected.parts:sizes[i][0];
    assert.equal(preview.parts.split("\n").filter(Boolean).length,acceptedPartCount,
      scene+": accepted primitive rows altered");
    assert.equal(preview.mesh_count??preview.geometry_count,acceptedPartCount);
    assert.equal(item.primitives,sizes[i][0]);
    assert.equal(preview.groups.length,sizes[i][1],
      scene+": accepted instance count altered");
    assert.equal(item.component_instances,sizes[i][1]);
    const seenGroups=new Set();
    for(const [index,group] of preview.groups.entries()){
      assert.equal(group.index,index,scene+": group order changed");
      assert(!seenGroups.has(group.id),scene+": duplicate group");
      seenGroups.add(group.id);
      const sha=group.source_blob??group.source_sha;
      assert.match(sha??"",/^[0-9a-f]{40}$/,scene+": unpinned source asset");
      assert.equal(gitBlob(group.source),sha,
        scene+": accepted component source revision changed: "+group.id);
      sourcePins++;
    }
    parts+=acceptedPartCount;
    groups+=item.component_instances;
  }
  assert.equal(parts,979,"current amended campaign geometry total drift");
  assert.equal(groups,84,"accepted total component count drift");
  assert.equal(sourcePins,84,"accepted source provenance incomplete");
  return {scenes:ids.size,parts,groups,sourcePins,
    uniqueAssetBlobs:blobCache.size-14,amendedBackyard:true};
}
const args=process.argv.slice(2);
assert(args.length===0||(args.length===1&&args[0]==="--self-test"),
  "usage: node scripts/check-block-chibi-visual-acceptance.mjs [--self-test]");
// A mutable acceptance ledger cannot authorize changes to itself and the
// frozen sources in the same checkout. Independently anchor to Git HEAD.
assertFrozenWorktreeClean(root);
const approvedLedgerBytes=readFileSync(ledgerPath);
// Git status catches checkout drift; this fixed digest also catches a
// committed replacement of both the accepted sources and their ledger.
assertAcceptedLedgerRevision(approvedLedgerBytes);
const ledger=JSON.parse(approvedLedgerBytes.toString("utf8"));
const receipt=checkLedger(ledger);
console.log("PASS visual acceptance ledger: "+receipt.scenes+" scenes, "+
  receipt.parts+" parts, "+receipt.groups+" components, "+
  receipt.sourcePins+" verified component source pins.");
if(args.length){
  const changed=structuredClone(ledger);
  changed.recorded_scenes[0].visual_review="pending";
  assert.throws(()=>checkLedger(changed),"review rollback not rejected");
  const changedPreview=structuredClone(ledger);
  changedPreview.recorded_scenes[0].preview_git_blob="0".repeat(40);
  assert.throws(()=>checkLedger(changedPreview),"preview revision drift not rejected");
  const changedAssembly=structuredClone(ledger);
  changedAssembly.recorded_scenes[0].assembly_git_blob="0".repeat(40);
  assert.throws(()=>checkLedger(changedAssembly),"assembly revision drift not rejected");
  const changedScope=structuredClone(ledger);
  changedScope.canonical_threejs="verified";
  assert.throws(()=>checkLedger(changedScope),"unsupported renderer claim not rejected");
  console.log("PASS 4 ledger regression mutations rejected.");
}
console.log("This ledger records EXISTING human approval, not a new "+
  "approval request or an automated Three.js runtime pass.");
