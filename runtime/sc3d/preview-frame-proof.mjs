// A small render-on-demand state machine shared by the real WebGL preview and
// a dependency-free Node regression. 'ready' means the MOST RECENT requested
// frame completed; a previous frame never stands in for a failed redraw.
export function createFrameProof({ documentElement, schedule, draw, onError }) {
  if (!documentElement?.dataset || typeof schedule !== 'function' ||
      typeof draw !== 'function' || typeof onError !== 'function') {
    throw new Error('Frame proof requires dataset, scheduler, draw and error handler');
  }
  let queued = false;
  let completed = 0;
  function requestRender() {
    if (queued) return;
    queued = true;
    documentElement.dataset.sc3dReady = 'false';
    schedule(() => {
      queued = false;
      try {
        draw();
        completed += 1;
        documentElement.dataset.sc3dFrame = String(completed);
        documentElement.dataset.sc3dReady = 'true';
      } catch (error) {
        documentElement.dataset.sc3dReady = 'false';
        onError(error);
      }
    });
  }
  return { requestRender, frameCount: () => completed };
}

export function assertFreshFrame(documentElement, previousFrame, description) {
  const current = Number(documentElement?.dataset?.sc3dFrame);
  if (documentElement?.dataset?.sc3dReady !== 'true' ||
      !Number.isSafeInteger(current) || current <= previousFrame) {
    throw new Error(description || 'SC3D redraw not proven');
  }
  return current;
}
