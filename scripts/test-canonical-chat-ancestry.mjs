#!/usr/bin/env node
/**
 * Negative contract tests for canonical ancestry supported by the portable
 * chat renderer; no Actions, browser or accepted scene edits.
 */
import assert from "node:assert/strict";
import { assertCanonicalChatAncestry } from "../runtime/chat/verify-canonical-ancestry.mjs";

const normal={
  root:{parent:null,role:"scene-root"},
  shell__root:{parent:"root",role:"component-root"},
  shell__arm:{parent:"shell__root",role:"rigid-support"},
  shell__block:{parent:"shell__arm",geometry:{kind:"cuboid",size:[1,1,1]}}
};
assert.equal(assertCanonicalChatAncestry(normal,"shell__block","shell__root"),4);
function reject(modification, label) {
  const parts=structuredClone(normal);
  modification(parts);
  assert.throws(()=>assertCanonicalChatAncestry(parts,"shell__block","shell__root"),
    label+" ancestor violation passed");
}
reject(parts=>{parts.shell__arm.visible=false;},"hidden parent");
reject(parts=>{parts.shell__root.pivot=[0,0,0];},"pivoted component");
reject(parts=>{parts.shell__arm.attachment={parent_anchor:"a",child_anchor:"b"};},
  "attached parent");
reject(parts=>{parts.shell__arm.parent="shell__block";},"cycle");
reject(parts=>{delete parts.shell__arm;},"missing ancestor");
reject(parts=>{parts.root.visible=false;},"hidden scene root");
reject(parts=>{parts.root.transform={translate:[1,0,0]};},
  "transformed scene root");
reject(parts=>{parts.root.transform={rotate_deg:[0,15,0]};},
  "rotated scene root");
reject(parts=>{parts.shell__arm.transform={translate:[.4,0,0]};},
  "non-geometric parent translation");
reject(parts=>{parts.shell__arm.transform={rotate_deg:[0,10,0]};},
  "non-geometric parent rotation");
reject(parts=>{
  parts.ghost__root={parent:"shell__root",transform:{translate:[.25,0,0]}};
  parts.shell__arm.parent="ghost__root";
},"impostor __root cannot conceal a non-geometric ancestor transform");
assert.throws(()=>assertCanonicalChatAncestry(normal,"shell__block","fake__root"),
  "explicit root must lie on the geometric part ancestry");
assert.throws(()=>assertCanonicalChatAncestry(normal,"shell__block"),
  "implicit root was not rejected");
// Explicit identity transform on a non-geometric support has no effect,
// while component-root movement is represented by a checked group transform.
const identity=structuredClone(normal);
identity.shell__arm.transform={translate:[0,0,0],scale:[1,1,1]};
identity.shell__root.transform={translate:[.2,0,0]};
assert.equal(assertCanonicalChatAncestry(identity,"shell__block","shell__root"),4);
assert.deepEqual(normal.shell__block.geometry.size,[1,1,1],
  "test unexpectedly changed canonical source fixture");
console.log("PASS visible canonical ancestry and thirteen fail-closed cases");
console.log("NOT tested: canonical Three.js drawing or actual in-chat delivery");
