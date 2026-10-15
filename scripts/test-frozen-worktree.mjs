#!/usr/bin/env node
/** Real isolated Git fixture, no accepted Scenarium files required. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync,mkdirSync,writeFileSync,unlinkSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { assertFrozenWorktreeClean } from "./check-frozen-worktree.mjs";
const root=mkdtempSync(join(tmpdir(),"scenarium-frozen-git-"));
function git(...args){
  const r=spawnSync("git",args,{cwd:root,encoding:"utf8",timeout:15000});
  assert.equal(r.status,0,r.stderr??"git command failed");
}
const paths=[
  "scenes/block-chibi-kitchen-v1/room.assembly.yml",
  "assets/constructive-3d/kitchens/stove.sc3d.yml",
  "contracts/accepted-block-chibi-v1.json",
  "contracts/accepted-backyard-geometry-amendment-2026-10-14.json",
  "experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/frozen-before-correction-preview.json",
  "experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/frozen-before-correction-shell.sc3d.yml"
];
try{
  git("init","-q");
  for(const p of paths){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),"original\n");}
  git("add","--",...paths);
  git("-c","user.name=Scenarium Test","-c","user.email=none@example.invalid","commit","-qm","fixture");
  assert.equal(assertFrozenWorktreeClean(root),5);
  for(const p of paths){
    writeFileSync(join(root,p),"modified\n");
    assert.throws(()=>assertFrozenWorktreeClean(root),"unstaged drift accepted: "+p);
    git("add","--",p);
    assert.throws(()=>assertFrozenWorktreeClean(root),"staged drift accepted: "+p);
    git("reset","-q","HEAD","--",p);
    git("checkout","--",p);
  }
  writeFileSync(join(root,paths[0]),"tampered-scene\n");
  writeFileSync(join(root,paths[2]),"matching-tampered-ledger\n");
  assert.throws(()=>assertFrozenWorktreeClean(root),
    "simultaneous scene/ledger tampering was accepted");
  git("checkout","--",paths[0],paths[2]);
  const newAsset="assets/constructive-3d/new-prop.sc3d.yml";
  writeFileSync(join(root,newAsset),"untracked\n");
  assert.throws(()=>assertFrozenWorktreeClean(root),"untracked asset accepted");
  unlinkSync(join(root,newAsset));
  const outside="docs/ordinary-not-frozen.md";
  mkdirSync(dirname(join(root,outside)),{recursive:true});
  writeFileSync(join(root,outside),"allowed\n");
  assert.equal(assertFrozenWorktreeClean(root),5,
    "unrelated documentation change incorrectly blocked");
  console.log("PASS isolated Git frozen-source guard: clean, staged, unstaged, untracked, and nonfrozen edits");
}finally{rmSync(root,{recursive:true,force:true});}
