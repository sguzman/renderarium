#!/usr/bin/env node
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
const scripts=new Set(["check-backyard-effects-benchmark-v2.mjs","test-backyard-effects-benchmark-browser.py","verify-chat-preview-pipeline.mjs","check-block-chibi-visual-acceptance.mjs","check-block-chibi-canonical.mjs","assemble-sc3d-scene.mjs","assemble-sc3d-components.mjs","validate-sc3d.mjs","serve-sc3d-preview.mjs","test-vehicle-prototypes.mjs","capture-vehicle-prototypes.py","test-vehicle-review-browser.py","test-offline-vehicle-review.py","export-vehicle-review-html.mjs","launch-environments.mjs","test-block-chibi-canonical-browser.py","test-block-chibi-environment-orbit.py","benchmark-renderer-quality.py","capture-lighting-shadow-gallery.py","emit-chat-review-packet.mjs","emit-chat-review-embed.mjs","check-frozen-worktree.mjs","test-chat-preview-pipeline-driver.mjs","test-frozen-worktree.mjs","test-accepted-ledger-pin.mjs","test-chat-authored-source-parity.mjs","test-sc3d-assembly-check-only.mjs","test-canonical-chat-ancestry.mjs","test-canonical-chat-primitive.mjs","test-chat-semantic-roundtrip.mjs","test-chat-world-matrix-parity.mjs","test-chat-three-adapter-parity.mjs","test-chat-scene-preview-core.mjs","test-chat-raster-signatures.mjs","test-chat-camera-depth-stress.mjs","test-chat-review-packet.mjs","test-chat-review-embed.mjs","test-block-chibi-canonical-preview-server.mjs"]);
const exact=new Set(["scenes/sc3d-preview/index.html","scenes/sc3d-software-preview/index.html","scenes/cozy-reader-room-v1/room-interactions-browser.mjs","README.md","package.json","pnpm-lock.yaml",".gitignore",".github/workflows/canonical-chat-public-ci.yml","contracts/accepted-block-chibi-v1.json","contracts/chat-review-packet-v1.schema.json","contracts/taria-boundary.yml","tools/publication-gate.mjs","tools/verify-chibi-campaign.mjs","tools/verify-factory-preview.mjs"]);
const experimentArchives=new Set([
  "experiments/diagnostics/backyard-depth-rasterization-isolation-2026-10-14.html",
  "experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html",
  "experiments/diagnostics/backyard-horizontal-stripe-pipeline-isolation-2026-10-14.html",
  "experiments/diagnostics/backyard-renderer-webgl2-vs-threejs-baseline-benchmark-2026-10-15.html",
  "experiments/diagnostics/backyard-stripe-pipeline-isolation-compact-2026-10-14.html",
  "experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/fence-aa-comparison.html",
  "experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/preview-geometry.json",
  "experiments/integration/backyard-unified-effects-v1-1-precision-fix-2026-10-15.html",
  "experiments/integration/backyard-unified-effects-v1-2026-10-15.html",
  "experiments/interactive-shaders/backyard-ambient-occlusion-2026-10-14.html",
  "experiments/interactive-shaders/backyard-ambient-occlusion-v2-chunked-inchat-2026-10-14.html",
  "experiments/interactive-shaders/backyard-ambient-occlusion-v2-contact-filter-2026-10-14.html",
  "experiments/interactive-shaders/backyard-antialiasing-comparison-2026-10-14.html",
  "experiments/interactive-shaders/backyard-color-grading-bloom-2026-10-14.html",
  "experiments/interactive-shaders/backyard-color-grading-bloom-depth-fixed-2026-10-14.html",
  "experiments/interactive-shaders/backyard-glsl-v1-rejected-inverted-hull-outline-2026-10-14.html",
  "experiments/interactive-shaders/backyard-glsl-v2-screen-space-outlines-2026-10-14.html",
  "experiments/interactive-weather/backyard-daynight-2026-10-14.html",
  "experiments/interactive-weather/backyard-distinct-shafts-isolation-2026-10-14.html",
  "experiments/interactive-weather/backyard-rain-wind-2026-10-13.html",
  "experiments/interactive-weather/backyard-snow-2026-10-14.html",
  "experiments/interactive-weather/backyard-volumetric-distinct-sunshafts-v3-2026-10-14.html",
  "experiments/interactive-weather/backyard-volumetric-sunshafts-dust-2026-10-14.html",
  "experiments/interactive-weather/backyard-volumetric-sunshafts-dust-golden-v2-2026-10-14.html"
]);
const scopes=[
  /^assets\/constructive-3d\/(?:[\w.-]+\/)*[\w.-]+\.sc3d\.yml$/,
  /^runtime\/(?:README\.md|sc3d\/README\.md|(?:[\w.-]+\/)*[\w.-]+\.(?:js|mjs|json))$/,
  /^scenes\/block-chibi-(?:living-room|kitchen|bathroom|office|backyard|garage|factory)-v1\/(?:README\.md|room\.assembly\.yml|preview-geometry\.json|components\/[\w.-]+\.sc3d\.yml|review-depth-(?:buffered|cpu-only)\.html)$/
];
const files=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
assert(files.length>100,"Incomplete public production snapshot");
const flagged=[];
for(const file of files){
  const allowed=exact.has(file)||experimentArchives.has(file)||file.startsWith("scripts/")&&scripts.has(file.slice(8))||scopes.some(re=>re.test(file));
  if(!allowed){flagged.push({file,reason:"not on public production allowlist"});continue}
  if(!/\.(?:md|txt|yml|yaml|json|js|mjs|py|html|glsl)$/.test(file))continue;
  const bytes=readFileSync(file);
  if(bytes.includes(0))continue;
  const content=bytes.toString("utf8");
  const unsafeLanguage = /\b(?:f\W*u\W*c\W*k\w*|c\W*u\W*n\W*t\w*|b\W*i\W*t\W*c\W*h\w*|r\W*a\W*p\W*e\w*|m\W*o\W*t\W*h\W*e\W*r\W*f\W*u\W*c\W*k\w*)\b/i;
  if(unsafeLanguage.test(content) ||
     /\bprivate[\s-]+conversational(?:ly)?\b/i.test(content) ||
     /\b(?:private|personal)\s+(?:vent|rant|chat|conversation|message|diary)\b/i.test(content) ||
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
