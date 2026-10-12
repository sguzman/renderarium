// Rendering-quality trials are deliberately separate from frozen SC3D assets.
// They run only when explicitly requested in diagnostic previews.
const MODES = Object.freeze(["fog", "soft-light", "shadow-detail", "tone-map", "ambient-occlusion", "fxaa"]);
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
  if (experiment !== "ambient-occlusion") return null;
  if (!camera.isPerspectiveCamera && !camera.isOrthographicCamera) {
    throw new Error("SSAO requires an orthographic or perspective camera");
  }
  const { SSAOPass } = await import("/vendor/three/addons/postprocessing/SSAOPass.js");
  const pass = new SSAOPass(scene, camera, 1, 1, 16);
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
