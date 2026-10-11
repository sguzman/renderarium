#!/usr/bin/env node
/**
 * Emit canonical-semantics-verified data for a ChatGPT INLINE interactive 3D
 * presentation. A packet is NOT a rendered or delivered viewer.
 *
 * Run: node scripts/emit-chat-review-packet.mjs --scene factory
 *
 * Requires the normal Scenarium yaml/ajv dependencies for canonical lowering.
 * Writes only to stdout, never the scene or a generated snapshot.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { assertCanonicalChatAncestry } from "../runtime/chat/verify-canonical-ancestry.mjs";
import { verifyCanonicalPrimitiveRow } from "../runtime/chat/verify-canonical-primitive.mjs";
import {assertAcceptedLedgerRevision} from "../runtime/chat/accepted-ledger-pin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const accepted = new Map([
  ["living-room", [87, 9]],
  ["kitchen", [149, 11]],
  ["bathroom", [139, 10]],
  ["office", [104, 12]],
  ["backyard", [181, 18]],
  ["garage", [112, 8]],
  ["factory", [209, 16]],
]);
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--scene" || !accepted.has(args[1])) {
  console.error("usage: node scripts/emit-chat-review-packet.mjs --scene <living-room|kitchen|bathroom|office|backyard|garage|factory>");
  process.exit(2);
}
const sceneName = args[1];
const sceneId = "block-chibi-" + sceneName + "-v1";
const [expectedParts, expectedGroups] = accepted.get(sceneName);
const sceneRoot = "scenes/" + sceneId;
const assemblyPath = sceneRoot + "/room.assembly.yml";
const previewPath = sceneRoot + "/preview-geometry.json";

function bytesAt(path) {
  const abs = resolve(root, path);
  assert(abs.startsWith(root + sep), "source path escapes Scenarium repo: " + path);
  return readFileSync(abs);
}
function blobSha(bytes) {
  return createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
}
function finiteVector(value, defaults, label) {
  const list = value === "-" || value == null
    ? defaults : Array.isArray(value) ? value : String(value).split(",").map(Number);
  assert(Array.isArray(list) && list.length === defaults.length &&
    list.every(Number.isFinite), label + ": invalid vector");
  return list;
}
function matches(a, b, label, tolerance=1e-5) {
  assert.equal(a.length, b.length, label + ": vector arity mismatch");
  for (let i = 0; i < a.length; i++) {
    assert(Number.isFinite(a[i]) && Number.isFinite(b[i]) &&
      Math.abs(a[i] - b[i]) < tolerance,
      label + "[" + i + "]: canonical SC3D / review data drift");
  }
}

const spec = JSON.parse(bytesAt(previewPath).toString("utf8"));
const acceptanceLedgerPath = "contracts/accepted-block-chibi-v1.json";
const acceptedLedgerBytes=bytesAt(acceptanceLedgerPath);
assertAcceptedLedgerRevision(acceptedLedgerBytes);
const acceptanceLedger = JSON.parse(acceptedLedgerBytes.toString("utf8"));
assert.equal(acceptanceLedger.format,"scenarium-visual-acceptance-ledger-v1",
  "unknown approval ledger format");
assert.equal(acceptanceLedger.repeat_visual_review,
  "forbidden_without_explicit_owner_request");
assert.equal(acceptanceLedger.source_geometry,"frozen",
  "accepted geometry cannot be reopened by the packet producer");
assert.equal(acceptanceLedger.canonical_threejs,"unverified",
  "visual acceptance cannot be upgraded to Three.js runtime proof");
const priorAcceptance = acceptanceLedger.recorded_scenes?.find(entry =>
  entry.scene === sceneId);
assert(priorAcceptance,"accepted scene missing from authoritative approval ledger");
assert.equal(priorAcceptance.visual_review,"accepted",
  "scene does not have established visual acceptance");
assert.equal(priorAcceptance.visual_scope,"appearance_and_composition");
assert.equal(priorAcceptance.primitives,expectedParts,
  "acceptance ledger primitive count drift");
assert.equal(priorAcceptance.component_instances,expectedGroups,
  "acceptance ledger instance count drift");
assert.equal(priorAcceptance.assembly_path,assemblyPath);
assert.equal(priorAcceptance.preview_path,previewPath);
assert.equal(priorAcceptance.preview_git_blob,blobSha(bytesAt(previewPath)),
  "accepted preview revision drift");
assert.equal(priorAcceptance.assembly_git_blob,blobSha(bytesAt(assemblyPath)),
  "accepted assembly revision drift");
const sourceBytes = bytesAt(assemblyPath);
assert.equal(spec.scene, sceneId, "review snapshot belongs to another scene");
assert.equal(spec.source_assembly, assemblyPath, "assembly path drift");
assert.equal(spec.source_assembly_blob, blobSha(sourceBytes),
  "accepted scene assembly revision changed");
assert.equal(spec.mesh_count ?? spec.geometry_count, expectedParts,
  "accepted geometry count changed");
assert.equal(spec.groups.length, expectedGroups,
  "accepted component count changed");

const pinSet = new Map();
function pin(path, sha) {
  assert.match(sha ?? "", /^[0-9a-f]{40}$/, "missing Git source hash");
  if (pinSet.has(path)) assert.equal(pinSet.get(path), sha, "conflicting source hash");
  assert.equal(blobSha(bytesAt(path)), sha, "source revision no longer matches: " + path);
  pinSet.set(path, sha);
}
pin(assemblyPath, spec.source_assembly_blob);
for (const group of spec.groups) pin(group.source, group.source_blob ?? group.source_sha);

// The *real* canonical Ajv/schema + SC3D semantic loader is exercised, not
// reimplemented or bypassed by the portable presentation.
const canonicalIrJson = execFileSync(process.execPath, [
  resolve(root, "scripts/assemble-sc3d-scene.mjs"),
  "--emit-ir-json", assemblyPath
], {
  cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
});
const ir = JSON.parse(canonicalIrJson);
const canonicalIrSha256 = createHash("sha256")
  .update(canonicalIrJson).digest("hex");
assert.equal(ir.ir_kind, "Constructive3DIR");
assert.equal(ir.asset.id, sceneId, "canonical scene identity drift");
assert.equal(Object.values(ir.parts).filter(x => x.geometry).length, expectedParts,
  "canonical geometry count differs from accepted preview");

// The canonical lowered IR does not retain assembly-only extensions.
// Verify instance paths against the original pinned manifest instead.
const manifest = YAML.parse(sourceBytes.toString("utf8"));
const canonicalComponents = manifest.components ?? [];
assert.equal(manifest.id, sceneId, "original manifest scene mismatch");
assert.equal(canonicalComponents.length, expectedGroups, "manifest component count differs");

for (const [index, group] of spec.groups.entries()) {
  assert.equal(group.index, index, "component order drift");
  const provenance = canonicalComponents[index];
  assert.equal(provenance.id, group.id, "component provenance identity drift");
  assert.equal(provenance.asset, group.source, "component provenance source drift");
  const frame = ir.parts[group.id + "__root"];
  assert(frame, "missing canonical component root for " + group.id);
  assert.equal(frame.parent, "root", "invalid component parent");
  assertCanonicalChatAncestry(ir.parts, group.id + "__root", group.id + "__root");
  for (const [name, defaults] of [
    ["translate", [0,0,0]], ["rotate_deg", [0,0,0]], ["scale", [1,1,1]]
  ]) {
    matches(finiteVector(group[name], defaults, group.id + " review " + name),
      finiteVector(frame.transform?.[name], defaults, group.id + " canonical " + name),
      group.id + " " + name);
  }
}

const seen = new Set();
const materialEffectsNotRendered = new Set();
for (const row of spec.parts.split("\n")) {
  const number = row.split("|", 1)[0];
  assert(/^(0|[1-9][0-9]*)$/.test(number),
    "invalid primitive component index");
  const group = spec.groups[Number(number)];
  assert(group,"primitive group index out of bounds");
  const result = verifyCanonicalPrimitiveRow(row,group,ir);
  assert(!seen.has(result.fullId),"duplicate preview primitive "+result.fullId);
  seen.add(result.fullId);
  for(const effect of result.materialEffectsNotRendered)
    materialEffectsNotRendered.add(effect);
}
assert.equal(seen.size, expectedParts, "canonical scene geometry not fully mapped by chat packet");
for (const [id,part] of Object.entries(ir.parts)) {
  if(part.geometry)assert(seen.has(id),
    "canonical geometric part absent from the source-bound chat preview: "+id);
}

const packet = {
  format: "scenarium-chat-review-packet-v1",
  scene: sceneId,
  state: "prepared_not_presented",
  review_scope: "interactive visual composition; not release accreditation",
  renderer_claim: "canonical_ir_alternate_renderer",
  canonical_threejs_rendered_in_chat: false,
  human_accepted_this_packet: false,
  existing_visual_acceptance: {
    status: "accepted_prior_to_packet",
    scope: priorAcceptance.visual_scope,
    authority: acceptanceLedgerPath,
    approved_preview_git_blob: priorAcceptance.preview_git_blob,
    approved_assembly_git_blob: priorAcceptance.assembly_git_blob,
    repeat_review: "not_required",
  },
  source: {
    repository: "sguzman/scenarium",
    assembly_path: assemblyPath,
    assembly_git_blob: spec.source_assembly_blob,
    preview_path: previewPath,
    preview_git_blob: blobSha(bytesAt(previewPath)),
    pinned_files: [...pinSet].map(([path, sha]) => ({path, git_blob: sha}))
  },
  canonical_semantics: {
    ir_kind: ir.ir_kind,
    ir_sha256: canonicalIrSha256,
    schema_and_lowering: "passed_during_packet_creation",
    scene_id: ir.asset.id,
    geometry_part_count: expectedParts,
    component_count: expectedGroups,
    primitive_hierarchy_base_color_transforms: "strictly_matched",
    material_effects_not_rendered: [...materialEffectsNotRendered].sort()
  },
  presentation: {
    geometry_encoding: spec.part_encoding ?? spec.encoding,
    groups: spec.groups,
    parts: spec.parts,
    minimum_controls: ["orbit", "zoom", "reset"],
    depth: "per_fragment_z_buffer_required",
    material_model: "base_color_flat_shading_without_pbr_or_emissive",
    must_render_in_current_chat: true,
    note: "This is DATA for a future in-chat viewer, not itself an interactive viewer."
  }
};
process.stdout.write(JSON.stringify(packet) + "\n");
