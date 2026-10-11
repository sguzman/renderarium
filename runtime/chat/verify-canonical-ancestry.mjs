import assert from "node:assert/strict";

/**
 * Verify that an alternate chat raster can faithfully traverse an SC3D
 * ancestor chain without ignoring hidden parents, pivots or attachments.
 * Validation is pure and leaves both the accepted source and IR unchanged.
 */
export function assertCanonicalChatAncestry(parts, partId, componentRootId) {
  assert(typeof componentRootId==="string" && componentRootId.length>0,
    "explicit designated component root required");
  assert(parts && typeof parts==="object", "canonical part table required");
  const visited=new Set();
  let reachedComponentRoot=false;
  let current=partId;
  while(current!=null) {
    assert(!visited.has(current), "canonical ancestry cycle: "+partId);
    visited.add(current);
    const part=parts[current];
    assert(part, "missing canonical ancestor: "+current);
    if(current===componentRootId){
      assert.equal(part.parent,"root",
        "designated component root must descend directly from scene root");
      reachedComponentRoot=true;
    }
    assert(part.visible!==false,
      "hidden SC3D part or ancestor: "+current);
    assert(!part.pivot && !part.attachment,
      "unsupported pivot/attachment in ancestor: "+current);
    // The portable part rows include geometry-bearing parents and one
    // assembly component root. Intermediate non-geometric transforms have
    // no explicit row and would otherwise be silently discarded.
    // The SC3D assembler's top-level scene root is also fixed at identity.
    // A future translated root must not bypass this check just because its
    // identifier is literally "root". Only the designated component root
    // has an independently compared transform in the chat packet.
    if(!part.geometry && current!==componentRootId) {
      const transform=part.transform;
      if(transform) {
        const identity=Object.entries(transform).every(([name,value])=>{
          const expected=name==="scale"?[1,1,1]:[0,0,0];
          return Array.isArray(value)&&value.length===3&&
            value.every((n,i)=>Number.isFinite(n)&&n===expected[i]);
        });
        assert(identity,
          "unrepresented transform on non-geometric ancestor: "+current);
      }
    }
    current=part.parent;
  }
  assert(reachedComponentRoot,
    "canonical primitive ancestry misses designated component root: "+componentRootId);
  return visited.size;
}
