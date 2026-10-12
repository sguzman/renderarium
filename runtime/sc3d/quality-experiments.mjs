// Rendering-quality trials are deliberately separate from frozen SC3D assets.
// They run only when explicitly requested in diagnostic previews.
const MODES = Object.freeze(["fog", "soft-light", "warm-light", "cool-light", "no-shadow", "hard-shadow", "soft-shadow-vsm", "shadow-vsm-tight", "shadow-vsm-wide", "shadow-bias-moderate", "shadow-bias-strong", "shadow-detail", "tone-map", "ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "ambient-occlusion-camera-occluders", "ambient-occlusion-camera-occluders-75", "ambient-occlusion-camera-occluders-75-cached", "fxaa"]);
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
    case "warm-light":
      // Golden key / cool subdued fill; no SC3D material edits.
      key.color.set("#ffc48d");
      key.intensity = 2.8;
      fill.color.set("#aecbff");
      fill.intensity = 0.75;
      rim.intensity = 0.6;
      break;
    case "cool-light":
      // Cooler directional illumination, warmer secondary fill.
      key.color.set("#b7daff");
      key.intensity = 2.8;
      fill.color.set("#ffe0bb");
      fill.intensity = 1.05;
      rim.intensity = 0.5;
      break;
    case "no-shadow":
      renderer.shadowMap.enabled = false;
      key.castShadow = false;
      break;
    case "hard-shadow":
      renderer.shadowMap.type = THREE.BasicShadowMap;
      break;
    case "soft-shadow-vsm":
      renderer.shadowMap.type = THREE.VSMShadowMap;
      key.shadow.radius = 3;
      key.shadow.blurSamples = 8;
      break;
    case "shadow-vsm-tight":
      renderer.shadowMap.type = THREE.VSMShadowMap;
      key.shadow.radius = 1;
      key.shadow.blurSamples = 8;
      break;
    case "shadow-vsm-wide":
      renderer.shadowMap.type = THREE.VSMShadowMap;
      key.shadow.radius = 6;
      key.shadow.blurSamples = 16;
      break;
    case "shadow-bias-moderate":
      // Independent bias trial at the original default shadow resolution.
      key.shadow.normalBias = 0.012;
      key.shadow.bias = -0.0002;
      break;
    case "shadow-bias-strong":
      // Intentionally large offset to expose peter-panning/contact loss.
      key.shadow.normalBias = 0.045;
      key.shadow.bias = -0.0005;
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
export async function createQualityPostPass({ scene, camera, presentation }, experiment) {
  if (experiment !== "ambient-occlusion" &&
      experiment !== "ambient-occlusion-half" &&
      experiment !== "ambient-occlusion-occluders" &&
      experiment !== "ambient-occlusion-camera-occluders" &&
      experiment !== "ambient-occlusion-camera-occluders-75" &&
      experiment !== "ambient-occlusion-camera-occluders-75-cached") return null;
  if (!camera.isPerspectiveCamera && !camera.isOrthographicCamera) {
    throw new Error("SSAO requires an orthographic or perspective camera");
  }
  const { SSAOPass } = await import("/vendor/three/addons/postprocessing/SSAOPass.js");
  // A separate lower-cost quality trial; full-resolution SSAO is untouched.
  const reduced = experiment === "ambient-occlusion-half";
  const worldSelection = experiment === "ambient-occlusion-occluders";
  const cacheSelection = experiment === "ambient-occlusion-camera-occluders-75-cached";
  const cameraSelection = experiment === "ambient-occlusion-camera-occluders" ||
    experiment === "ambient-occlusion-camera-occluders-75" || cacheSelection;
  const retainedFraction =
    experiment === "ambient-occlusion-camera-occluders-75" || cacheSelection
      ? 0.75 : 0.5;
  if (cacheSelection && !presentation?.matrixWorld?.elements) {
    throw new Error("Cached AO selection requires presentation matrix");
  }
  let PassClass = SSAOPass;
  let selection = null;
  if (worldSelection || cameraSelection) {
    selection = {
      strategy: cacheSelection
        ? "top-three-quarters-by-projected-viewport-coverage-cached"
        : cameraSelection
          ? (retainedFraction === 0.75
            ? "top-three-quarters-by-projected-viewport-coverage"
            : "top-half-by-projected-viewport-coverage")
          : "largest-half-by-world-radius",
      retainedFraction,
      total: 0, retained: 0, omitted: 0,
      evaluations: 0, cacheHits: 0, selectedIndices: [],
      visibilityRestored: () => true,
    };
    const selectOccluders = () => {
      scene.updateMatrixWorld(true);
      if (cameraSelection) camera.updateMatrixWorld(true);
      const candidates = [];
      scene.traverse(object => {
        if (!object.isMesh || !object.visible) return;
        const geometry = object.geometry;
        if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere();
        const radius = geometry?.boundingSphere
          ? geometry.boundingSphere.radius * object.matrixWorld.getMaxScaleOnAxis()
          : Number.POSITIVE_INFINITY;
        let importance = radius;
        if (cameraSelection && Number.isFinite(radius)) {
          const worldCenter = geometry.boundingSphere.center.clone().applyMatrix4(object.matrixWorld);
          const viewCenter = worldCenter.clone().applyMatrix4(camera.matrixWorldInverse);
          if (camera.isPerspectiveCamera && -viewCenter.z + radius < camera.near) {
            importance = 0;
          } else {
            const depth = camera.isPerspectiveCamera
              ? Math.max(camera.near, -viewCenter.z)
              : 1;
            const proj = camera.projectionMatrix.elements;
            const ndc = viewCenter.applyMatrix4(camera.projectionMatrix);
            const rx = Math.abs(proj[0]) * radius / depth;
            const ry = Math.abs(proj[5]) * radius / depth;
            const w = Math.max(0, Math.min(1, ndc.x + rx) - Math.max(-1, ndc.x - rx));
            const h = Math.max(0, Math.min(1, ndc.y + ry) - Math.max(-1, ndc.y - ry));
            importance = w * h;
          }
        }
        candidates.push({ object, importance, index: candidates.length });
      });
      if (candidates.length < 2) throw new Error("Occluder selection requires at least two visible meshes");
      candidates.sort((a, b) => b.importance - a.importance || a.index - b.index);
      const keep = Math.ceil(candidates.length * retainedFraction);
      const retained = new Set(candidates.slice(0, keep).map(item => item.object));
      selection.total = candidates.length;
      selection.retained = keep;
      selection.omitted = candidates.length - keep;
      selection.evaluations++;
      selection.selectedIndices = candidates.slice(0, keep)
        .map(item => item.index).sort((a, b) => a - b);
      return retained;
    };
    // The cached trial avoids O(mesh-count) traverse/sort on static redraws,
    // using three 4x4 matrices (48 scalar comparisons) as its invalidation
    // signature. Its scope covers camera pose, projection and the entire
    // approved scene's presentation transform. Scene assets remain immutable.
    const staticRetained = worldSelection ? selectOccluders() : null;
    let cacheRetained = null;
    let cacheSignature = null;
    const cacheMatrices = cacheSelection
      ? [camera.matrixWorld, camera.projectionMatrix, presentation.matrixWorld]
      : [];
    function selectedForFrame() {
      if (staticRetained) return staticRetained;
      if (!cacheSelection) return selectOccluders();
      const currentSignature = cacheMatrices.flatMap(matrix => Array.from(matrix.elements));
      if (cacheRetained && cacheSignature &&
          currentSignature.every((value, i) => value === cacheSignature[i])) {
        selection.cacheHits++;
        return cacheRetained;
      }
      cacheRetained = selectOccluders();
      cacheSignature = cacheMatrices.flatMap(matrix => Array.from(matrix.elements));
      return cacheRetained;
    }
    PassClass = class extends SSAOPass {
      constructor(...args) {
        super(...args);
        this._hiddenOccluders = [];
      }
      _overrideVisibility() {
        super._overrideVisibility();
        const retained = selectedForFrame();
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
  if (selection) selection.visibilityRestored = () => pass._hiddenOccluders.length === 0;
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
