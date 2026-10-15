#!/usr/bin/env node
/**
 * Independent Git working-tree guard for accepted Scenarium assets.
 * Unlike ledger/blob checks, detects simultaneous edits to a frozen source
 * and its approval ledger, including staged and untracked additions.
 * No dependencies, no writes, and no GitHub Actions.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const frozenPaths=[
  ":(glob)scenes/block-chibi-*/**",
  ":(glob)assets/constructive-3d/**",
  ":(literal)contracts/accepted-block-chibi-v1.json",
  ":(literal)contracts/accepted-backyard-geometry-amendment-2026-10-14.json",
  ":(glob)experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/frozen-before-correction-*"
];
export function assertFrozenWorktreeClean(root=defaultRoot){
  const result=spawnSync("git",[
    "status","--porcelain=v1","--untracked-files=all","--",...frozenPaths
  ],{cwd:root,encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
  assert(!result.error&&result.status===0,
    "Cannot verify frozen sources against Git HEAD: "+
    (result.error?.message??result.stderr??("exit "+result.status)));
  assert.equal(result.stdout.trim(),"",
    "Frozen scenes, constructive assets or acceptance ledger differ from Git HEAD:\n"+
      result.stdout.trim());
  return frozenPaths.length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv.length,2,"usage: node scripts/check-frozen-worktree.mjs");
  const paths=assertFrozenWorktreeClean();
  console.log("PASS frozen worktree clean against Git HEAD ("+paths+" scopes)");
}
