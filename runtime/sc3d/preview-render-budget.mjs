// Bounds the SC3D preview framebuffer without modifying GPU drivers,
// system display settings or the source 3D asset. One-time allocation budget
// only: static scenes are still rendered on demand, not every frame.
export const DEFAULT_PREVIEW_MAX_PIXELS = 4000000;
export const DEFAULT_PREVIEW_MAX_DPR = 1.5;

export function previewPixelRatio({
  width,
  height,
  deviceRatio = 1,
  maxPixels = DEFAULT_PREVIEW_MAX_PIXELS,
  maxDpr = DEFAULT_PREVIEW_MAX_DPR,
}) {
  if (![width,height,deviceRatio,maxPixels,maxDpr].every(
    x => typeof x === "number" && Number.isFinite(x) && x > 0,
  )) {
    throw new Error("SC3D preview dimensions and pixel budgets must be positive finite numbers");
  }
  const boundedDpr = Math.min(deviceRatio, maxDpr);
  // Permit sub-1 DPR for very large viewports: the maximum *pixel* budget
  // should remain a real cap even on 4K/8K monitors.
  return Math.min(boundedDpr, Math.sqrt(maxPixels / (width * height)));
}
