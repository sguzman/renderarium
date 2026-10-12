// Rendering-quality trials are deliberately separate from frozen SC3D assets.
// They run only when explicitly requested in diagnostic previews.
const MODES = Object.freeze(["fog", "soft-light", "shadow-detail"]);
export const QUALITY_EXPERIMENTS = MODES;

export function selectQualityExperiment(params, diagnosticMode) {
  if (!params || typeof params.getAll !== "function") {
    throw new TypeError("Quality experiment selection requires URLSearchParams");
  }
  const requested = params.getAll("quality_experiment");
  if (requested.length === 0) return null;
  if (!diagnosticMode) {
    throw new Error("quality_experiment requires diagnostic=1");
  }
  if (requested.length !== 1 || !MODES.includes(requested[0])) {
    throw new Error("Unsupported or repeated quality_experiment");
  }
  return requested[0];
}

export function applyQualityExperiment({ THREE, scene, key, fill, rim }, experiment) {
  if (experiment === null) return;
  if (!MODES.includes(experiment)) {
    throw new Error("Unsupported rendering-quality experiment");
  }
  switch (experiment) {
    case "fog":
      // Match the preview background; no new geometry or materials.
      scene.fog = new THREE.Fog(scene.background, 6, 15);
      break;
    case "soft-light":
      key.intensity = 2.2;
      fill.intensity = 0.75;
      rim.intensity = 0.55;
      break;
    case "shadow-detail":
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.normalBias = 0.015;
      break;
  }
}
