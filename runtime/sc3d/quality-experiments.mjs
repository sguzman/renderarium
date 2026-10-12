// Rendering-quality trials are deliberately separate from frozen SC3D assets.
// They run only when explicitly requested in diagnostic previews.
const MODES = Object.freeze(["fog", "soft-light", "shadow-detail", "tone-map", "ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "fxaa"]);
export const QUALITY_EXPERIMENTS = MODES;
export const QUALITY_SSAO_SEED = 0x5ca3d70f;

/**
 * Three.js SSAOPass constructs a randomized sample kernel and noise texture.
 * A fixed, local seed permits like-for-like image comparisons between browser
 * pages. The global RNG is replaced ONLY within a synchronous constructor,
 * restored even if construction throws, and never used for default previews.
 */
export function withDeterministicQualityRandom(callback) {
  if (typeof callback !== "function") throw new TypeError("Expected constructor callback");
  const original = Math.random;
  let state = QUALITY_SSAO_SEED;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}

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

export function applyQualityExperiment({ THREE, scene, renderer, key, fill, rim }, experiment) {
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
    case "tone-map":
      // Tone mapping is a renderer-stage color transform, not new SC3D art.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      break;
  }
}

/**
 * A real depth- and normal-buffer SSAO pass. The addon is dynamically loaded
 * only for an explicit diagnostic request; production previews never allocate
 * its WebGL targets, compile its shaders, or alter their approved appearance.
 */
export async function createQualityPostPass({ scene, camera }, experiment) {
  if (experiment !== "ambient-occlusion" &&
      experiment !== "ambient-occlusion-half" &&
      experiment !== "ambient-occlusion-occluders") return null;
  if (!camera.isPerspectiveCamera && !camera.isOrthographicCamera) {
    throw new Error("SSAO requires an orthographic or perspective camera");
  }
  const { SSAOPass } = await import("/vendor/three/addons/postprocessing/SSAOPass.js");
  // A separate lower-cost quality trial; full-resolution SSAO is untouched.
  const reduced = experiment === "ambient-occlusion-half";
  // Diagnostic-only occluder pruning: exclude the smallest half of
  // visible meshes from SSAO depth/normal rendering, NEVER beauty rendering.
  const selective = experiment === "ambient-occlusion-occluders";
  let PassClass = SSAOPass;
  let selection = null;
  if (selective) {
    scene.updateMatrixWorld(true);
    const candidates = [];
    scene.traverse(object => {
      if (!object.isMesh || !object.visible) return;
      const geometry = object.geometry;
      if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere();
      const radius = geometry?.boundingSphere
        ? geometry.boundingSphere.radius * object.matrixWorld.getMaxScaleOnAxis()
        : Number.POSITIVE_INFINITY;
      candidates.push({ object, radius, index: candidates.length });
    });
    if (candidates.length < 2) {
      throw new Error("Occluder selection requires at least two meshes");
    }
    candidates.sort((a, b) => b.radius - a.radius || a.index - b.index);
    const keepCount = Math.ceil(candidates.length / 2);
    const retained = new Set(candidates.slice(0, keepCount).map(item => item.object));
    const omitted = candidates.slice(keepCount).map(item => item.object);
    selection = {
      strategy: "largest-half-by-world-radius",
      total: candidates.length,
      retained: retained.size,
      omitted: omitted.length,
      visibilityRestored: () => omitted.every(object => object.visible),
    };
    PassClass = class extends SSAOPass {
      constructor(...args) {
        super(...args);
        this._hiddenOccluders = [];
      }
      _overrideVisibility() {
        super._overrideVisibility();
        this.scene.traverse(object => {
          if (object.isMesh && object.visible && !retained.has(object)) {
            object.visible = false;
            this._hiddenOccluders.push(object);
          }
        });
      }
      _restoreVisibility() {
        for (const object of this._hiddenOccluders) object.visible = true;
        this._hiddenOccluders.length = 0;
        super._restoreVisibility();
      }
    };
  }
  const originalRandom = Math.random;
  const pass = withDeterministicQualityRandom(
    () => new PassClass(scene, camera, 1, 1, reduced ? 8 : 16)
  );
  pass.qualitySamplingSeed = QUALITY_SSAO_SEED;
  pass.qualityRandomRestored = Math.random === originalRandom;
  pass.qualityOccluderSelection = selection;
  pass.qualityResolutionScale = reduced ? 0.5 : 1;
  // SSAOPass defaults both depth shaders to perspective, even when the SC3D
  // preview camera is orthographic. Select the correct depth reconstruction.
  const perspective = camera.isPerspectiveCamera ? 1 : 0;
  pass.ssaoMaterial.defines.PERSPECTIVE_CAMERA = perspective;
  pass.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = perspective;
  pass.output = SSAOPass.OUTPUT.Default;
  pass.renderToScreen = true;
  pass.kernelRadius = 0.65;
  pass.minDistance = 0.001;
  pass.maxDistance = 0.12;
  return pass;
}

/**
 * Opt-in compositing pipeline. FXAA operates after color-space conversion,
 * as required by Three.js OutputPass, and never changes default previews.
 */
export async function createQualityComposer({ scene, camera, renderer }, experiment) {
  if (experiment !== "fxaa") return null;
  const [
    { EffectComposer }, { RenderPass }, { ShaderPass },
    { OutputPass }, { FXAAShader },
  ] = await Promise.all([
    import("/vendor/three/addons/postprocessing/EffectComposer.js"),
    import("/vendor/three/addons/postprocessing/RenderPass.js"),
    import("/vendor/three/addons/postprocessing/ShaderPass.js"),
    import("/vendor/three/addons/postprocessing/OutputPass.js"),
    import("/vendor/three/addons/shaders/FXAAShader.js"),
  ]);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);
  return { composer, fxaaPass };
}
