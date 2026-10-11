// Interaction overlay for the Cozy Reader Room specimen.
// No persistent asset edits, no driver/system changes, no animation loop,
// no physics, and only one small local PointLight (without shadows).
export const ROOM_INSPECTABLE = Object.freeze({
  bed: "Bed",
  bookshelf: "Bookshelf",
  desk: "Reading desk",
  chair: "Chair",
  lamp: "Table lamp",
  book: "Desk book",
  rug: "Rug",
  "floor-cushion": "Floor cushion",
  plant: "Snake plant",
  "shelf-book": "Shelf book",
  window: "Window",
});

export function roomInstanceFromPartId(partId) {
  if (typeof partId !== "string" || !partId.includes("__")) return null;
  const id = partId.slice(0, partId.indexOf("__"));
  return Object.hasOwn(ROOM_INSPECTABLE, id) ? id : null;
}

export function createRoomInteractionController({
  THREE, model, scene, camera, canvas, onUpdate = () => {},
}) {
  if (!THREE || !model || !scene || typeof camera !== "function" || !canvas) {
    throw new Error("Room interaction controller requires Three.js model, scene, camera and canvas");
  }
  const nodes = model.userData.sc3dNodes;
  if (!nodes?.lamp__root || !nodes.lamp__emitter) {
    throw new Error("Expected complete lamp scene nodes; room asset is incompatible");
  }
  const lampEmitter = nodes.lamp__emitter.localSpace.children.find(object => object.isMesh);
  if (!lampEmitter?.material) throw new Error("Room lamp emitter material not found");
  const emitterMaterial = lampEmitter.material;
  const initialColor = emitterMaterial.color.clone();
  const initialEmissive = emitterMaterial.emissive.clone();
  const initialEmissiveIntensity = emitterMaterial.emissiveIntensity;
  const light = new THREE.PointLight("#ffd68c", 1.1, 2.6, 2);
  light.name = "cozy-reader-room-lamp-local-light";
  light.position.set(0, 0.59, 0);
  light.castShadow = false; // Keep GPU cost modest.
  nodes.lamp__root.localSpace.add(light);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  let selectedId = null;
  let helper = null;
  let lampOn = true;
  const bookCovers = new Map();
  const openedBooks = new Set();
  for (const instanceId of ["book", "shelf-book"]) {
    const coverNode = nodes[`${instanceId}__cover_top`];
    const mesh = coverNode?.localSpace.children.find(object => object.isMesh);
    const width = mesh?.geometry?.parameters?.width;
    if (!coverNode || !(width > 0) || !Number.isFinite(width)) {
      throw new Error(`Room book ${instanceId} has no cuboid top cover to articulate`);
    }
    bookCovers.set(instanceId, {
      node: coverNode,
      width,
      originalPivot: coverNode.pivotNode.position.clone(),
      originalLocal: coverNode.localSpace.position.clone(),
      originalRotationZ: coverNode.pivotNode.rotation.z,
    });
  }
  let disposed = false;

  function state() {
    return {
      selectedId,
      selectedLabel: selectedId ? ROOM_INSPECTABLE[selectedId] : null,
      lampOn,
      openBooks: [...openedBooks].sort(),
    };
  }

  function notify() { onUpdate(state()); }

  function setLampOn(nextValue) {
    if (disposed) return;
    lampOn = Boolean(nextValue);
    emitterMaterial.color.copy(lampOn ? initialColor : new THREE.Color("#d8c79d"));
    emitterMaterial.emissive.copy(lampOn ? initialEmissive : new THREE.Color("#000000"));
    emitterMaterial.emissiveIntensity = lampOn ? initialEmissiveIntensity : 0;
    light.visible = lampOn;
    notify();
  }

  function setBookOpen(id, nextValue) {
    if (disposed) return;
    const cover = bookCovers.get(id);
    if (!cover) throw new Error(`Not an interactive room book: ${id}`);
    const opened = Boolean(nextValue);
    // Hinge the entire top cover around its left (spine-side) edge.
    // A zero-degree angle has *exactly* the original closed mesh transform.
    const edge = -cover.width / 2;
    cover.node.pivotNode.position.copy(cover.originalPivot);
    cover.node.localSpace.position.copy(cover.originalLocal);
    if (opened) {
      cover.node.pivotNode.position.x += edge;
      cover.node.localSpace.position.x -= edge;
      cover.node.pivotNode.rotation.z = cover.originalRotationZ + 145 * Math.PI / 180;
      openedBooks.add(id);
    } else {
      cover.node.pivotNode.rotation.z = cover.originalRotationZ;
      openedBooks.delete(id);
    }
    helper?.update();
    notify();
  }

  function toggleBook(id) {
    setBookOpen(id, !openedBooks.has(id));
  }

  function select(id) {
    if (disposed) return;
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      helper = null;
    }
    selectedId = id && Object.hasOwn(ROOM_INSPECTABLE, id) ? id : null;
    if (selectedId) {
      const node = nodes[`${selectedId}__root`];
      if (!node) throw new Error(`Missing expected scene instance: ${selectedId}`);
      model.updateWorldMatrix(true, true);
      helper = new THREE.BoxHelper(node.frame, "#fff0b0");
      helper.name = "room-selection-outline";
      scene.add(helper);
    }
    notify();
  }

  function pick(clientX, clientY) {
    if (disposed) return;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    pointer.set(
      ((clientX - box.left) / box.width) * 2 - 1,
      -((clientY - box.top) / box.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera());
    const hits = raycaster.intersectObject(model, true);
    const choice = hits.map(hit => roomInstanceFromPartId(hit.object.userData.sc3dPartId))
      .find(Boolean);
    select(choice ?? null);
    if (choice === "lamp") setLampOn(!lampOn);
    if (choice && bookCovers.has(choice)) toggleBook(choice);
  }

  const onPointerDown = event => {
    if (event.button !== 0 || disposed) return;
    down = {x:event.clientX,y:event.clientY,id:event.pointerId};
  };
  const onPointerUp = event => {
    if (!down || disposed || event.pointerId !== down.id) return;
    const dx = event.clientX-down.x, dy = event.clientY-down.y;
    down = null;
    // Drag orbits the camera presentation. Only short taps select/toggle.
    if (Math.hypot(dx,dy) <= 7) pick(event.clientX,event.clientY);
  };
  const onCancel = () => { down = null; };
  canvas.addEventListener("pointerdown",onPointerDown);
  canvas.addEventListener("pointerup",onPointerUp);
  canvas.addEventListener("pointercancel",onCancel);
  setLampOn(true);
  return {
    getState: state,
    setLampOn,
    toggleLamp: () => setLampOn(!lampOn),
    setBookOpen,
    toggleBook,
    select,
    pick,
    refresh() {
      if (disposed || !helper) return;
      model.updateWorldMatrix(true, true);
      helper.update();
    },
    dispose() {
      if (disposed) return;
      select(null);
      for (const id of openedBooks) setBookOpen(id, false);
      disposed = true;
      canvas.removeEventListener("pointerdown",onPointerDown);
      canvas.removeEventListener("pointerup",onPointerUp);
      canvas.removeEventListener("pointercancel",onCancel);
      nodes.lamp__root.localSpace.remove(light);
      light.dispose?.();
      emitterMaterial.color.copy(initialColor);
      emitterMaterial.emissive.copy(initialEmissive);
      emitterMaterial.emissiveIntensity = initialEmissiveIntensity;
    },
  };
}
