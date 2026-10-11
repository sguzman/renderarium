#!/usr/bin/env node
/**
 * Chat transport proof: data integrity only. Does NOT display a 3D viewer.
 * Run: node scripts/test-chat-review-packet.mjs [--scene factory]
 * Uses the repository's Ajv / YAML dependencies, not GitHub Actions.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const scenes=["living-room","kitchen","bathroom","office","backyard","garage","factory"];
const args=process.argv.slice(2);
assert(args.length===0 || (args.length===2 && args[0]==="--scene" && scenes.includes(args[1])),
  "usage: node scripts/test-chat-review-packet.mjs [--scene scene-name]");
const selected=args.length?[args[1]]:scenes;
const schema=JSON.parse(readFileSync(resolve(root,"contracts/chat-review-packet-v1.schema.json"),"utf8"));
const validate=new Ajv2020({allErrors:true,strict:true}).compile(schema);
const exporter=resolve(root,"scripts/emit-chat-review-packet.mjs");
for(const scene of selected){
  const response=execFileSync(process.execPath,[exporter,"--scene",scene],{
    cwd:root,encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024
  });
  const packet=JSON.parse(response);
  assert(validate(packet),JSON.stringify(validate.errors));
  assert.equal(packet.state,"prepared_not_presented");
  assert.equal(packet.canonical_threejs_rendered_in_chat,false);
  assert.equal(packet.human_accepted_this_packet,false);
  // Visual appearance of the frozen scene was already accepted. The new
  // packet has not itself been presented, which is a separate status.
  const ledger=JSON.parse(readFileSync(resolve(root,
    "contracts/accepted-block-chibi-v1.json"),"utf8"));
  const approval=ledger.recorded_scenes.find(x=>x.scene===packet.scene);
  assert.equal(ledger.source_geometry,"frozen");
  assert.equal(ledger.canonical_threejs,"unverified");
  assert.equal(approval.primitives,packet.canonical_semantics.geometry_part_count);
  assert.equal(approval.component_instances,
    packet.canonical_semantics.component_count);
  assert(approval&&approval.visual_review==="accepted",
    scene+": missing prior owner visual acceptance");
  assert.equal(packet.existing_visual_acceptance.status,"accepted_prior_to_packet");
  assert.equal(packet.existing_visual_acceptance.scope,"appearance_and_composition");
  assert.equal(packet.existing_visual_acceptance.authority,
    "contracts/accepted-block-chibi-v1.json");
  assert.equal(packet.existing_visual_acceptance.repeat_review,"not_required");
  assert.equal(packet.existing_visual_acceptance.approved_preview_git_blob,
    approval.preview_git_blob);
  assert.equal(packet.existing_visual_acceptance.approved_assembly_git_blob,
    approval.assembly_git_blob);

  assert.equal(packet.renderer_claim,"canonical_ir_alternate_renderer");
  assert.match(packet.canonical_semantics.ir_sha256,/^[0-9a-f]{64}$/,
    scene+": missing canonical IR digest");
  // Recompute from the actual canonical assembler stdout instead of from
  // source preview bytes; a changed lowering algorithm must invalidate it.
  const canonicalOutput=execFileSync(process.execPath,[
    resolve(root,"scripts/assemble-sc3d-scene.mjs"),"--emit-ir-json",
    packet.source.assembly_path
  ],{cwd:root,encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024});
  assert.equal(packet.canonical_semantics.ir_sha256,
    createHash("sha256").update(canonicalOutput).digest("hex"),
    scene+": canonical lowering digest drift");
  assert.equal(packet.canonical_semantics.primitive_hierarchy_base_color_transforms,
    "strictly_matched");
  assert(Array.isArray(packet.canonical_semantics.material_effects_not_rendered));
  assert.equal(packet.presentation.material_model,
    "base_color_flat_shading_without_pbr_or_emissive");
  assert.equal(packet.scene,packet.canonical_semantics.scene_id);
  assert.equal(packet.presentation.groups.length,packet.canonical_semantics.component_count);
  assert.equal(packet.presentation.parts.split("\n").length,packet.canonical_semantics.geometry_part_count);
  const pins=new Map(packet.source.pinned_files.map(e=>[e.path,e.git_blob]));
  assert.equal(pins.get(packet.source.assembly_path),packet.source.assembly_git_blob);
  const preview=readFileSync(resolve(root,packet.source.preview_path));
  const previewHash=createHash("sha1").update("blob "+preview.length+"\0").update(preview).digest("hex");
  assert.equal(previewHash,packet.source.preview_git_blob,"preview blob hash drift");
  const spec=JSON.parse(preview.toString("utf8"));
  assert.equal(packet.presentation.parts,spec.parts,"packet geometry different from source preview");
  assert.deepEqual(packet.presentation.groups,spec.groups,"packet placements different from source preview");
  if (scene==="living-room") {
    assert(packet.canonical_semantics.material_effects_not_rendered.includes("emissive"),
      "living-room floor lamp emissive channel must not be silently treated as rendered");
  }
  console.log("PASS prepared chat packet "+packet.scene+": "+
    packet.canonical_semantics.geometry_part_count+" canonical parts, "+
    packet.canonical_semantics.component_count+" instances, "+
    pins.size+" source hashes, schema/provenance/IR source data verified");
}
const bad=spawnSync(process.execPath,[exporter,"--scene","nonexistent"],{
  cwd:root,encoding:"utf8",timeout:10000
});
assert.equal(bad.status,2,"unknown scene should fail closed");
assert(!bad.stdout.trim(),"invalid packet emitted for unknown scene");
console.log("PASS invalid scene rejected. Packet validation is not in-chat delivery.");
