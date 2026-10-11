#!/usr/bin/env node
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
const scripts=new Set(["verify-chat-preview-pipeline.mjs","check-block-chibi-visual-acceptance.mjs","check-block-chibi-canonical.mjs","assemble-sc3d-scene.mjs","assemble-sc3d-components.mjs","validate-sc3d.mjs","serve-sc3d-preview.mjs","test-block-chibi-canonical-browser.py","emit-chat-review-packet.mjs","emit-chat-review-embed.mjs","check-frozen-worktree.mjs","test-chat-preview-pipeline-driver.mjs","test-frozen-worktree.mjs","test-accepted-ledger-pin.mjs","test-chat-authored-source-parity.mjs","test-sc3d-assembly-check-only.mjs","test-canonical-chat-ancestry.mjs","test-canonical-chat-primitive.mjs","test-chat-semantic-roundtrip.mjs","test-chat-world-matrix-parity.mjs","test-chat-three-adapter-parity.mjs","test-chat-scene-preview-core.mjs","test-chat-raster-signatures.mjs","test-chat-camera-depth-stress.mjs","test-chat-review-packet.mjs","test-chat-review-embed.mjs","test-block-chibi-canonical-preview-server.mjs"]);
const exact=new Set(["scenes/sc3d-preview/index.html","scenes/sc3d-software-preview/index.html","scenes/cozy-reader-room-v1/room-interactions-browser.mjs","README.md","package.json",".gitignore",".github/workflows/canonical-chat-public-ci.yml","contracts/accepted-block-chibi-v1.json","contracts/chat-review-packet-v1.schema.json","contracts/taria-boundary.yml","tools/publication-gate.mjs","tools/verify-chibi-campaign.mjs","tools/verify-factory-preview.mjs"]);
const scopes=[/^assets\/constructive-3d\//,/^runtime\//,/^scenes\/block-chibi-(?:living-room|kitchen|bathroom|office|backyard|garage|factory)-v1\//];
const files=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
assert(files.length>100,"Incomplete public production snapshot");
const flagged=[];
for(const file of files){
  const allowed=exact.has(file)||file.startsWith("scripts/")&&scripts.has(file.slice(8))||scopes.some(re=>re.test(file));
  if(!allowed){flagged.push({file,reason:"not on public production allowlist"});continue}
  if(!/\.(?:md|txt|yml|yaml|json|js|mjs|py|html|glsl)$/.test(file))continue;
  const bytes=readFileSync(file);
  if(bytes.includes(0))continue;
  const content=bytes.toString("utf8");
  if(/\b(?:private|personal)\s+(?:vent|rant|chat|conversation|message|diary)\b/i.test(content) ||
     /\b(?:verbatim|transcript)\s+(?:user|owner|chat|conversation)\b/i.test(content) ||
     /^\s*(?:user|human|owner)\s*:\s*.+$/mi.test(content)){
    flagged.push({file,reason:"nonproduction conversation marker"});
  }
}
if(flagged.length){
  for(const finding of flagged)console.error("PUBLICATION GATE: "+finding.file+" - "+finding.reason);
  process.exit(1);
}
console.log("PASS public production boundary: "+files.length+" tracked files");
