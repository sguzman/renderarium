const textCache = new Map();
const dataUrlCache = new Map();

function normalizeBase64(text) {
  return text.replace(/\s+/g, "");
}

export async function loadEncodedDataUrl(url, options = {}) {
  const {
    mime = "image/webp",
    cache = true,
    signal,
  } = options;

  const cacheKey = `${mime}::${url}`;
  if (cache && dataUrlCache.has(cacheKey)) {
    return dataUrlCache.get(cacheKey);
  }

  let encoded;
  if (cache && textCache.has(url)) {
    encoded = textCache.get(url);
  } else {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Asset load failed (${response.status}): ${url}`);
    }
    encoded = normalizeBase64(await response.text());
    if (!encoded) {
      throw new Error(`Encoded asset is empty: ${url}`);
    }
    if (cache) textCache.set(url, encoded);
  }

  const dataUrl = `data:${mime};base64,${encoded}`;
  if (cache) dataUrlCache.set(cacheKey, dataUrl);
  return dataUrl;
}

export async function bindEncodedImage(target, url, options = {}) {
  const element =
    typeof target === "string" ? document.querySelector(target) : target;

  if (!(element instanceof HTMLImageElement)) {
    throw new TypeError("bindEncodedImage target must resolve to an <img> element");
  }

  const dataUrl = await loadEncodedDataUrl(url, options);
  element.src = dataUrl;

  if (options.decode !== false && typeof element.decode === "function") {
    await element.decode();
  }

  return element;
}

export async function preloadEncodedImages(specs, options = {}) {
  return Promise.all(
    specs.map((spec) =>
      loadEncodedDataUrl(spec.url, {
        ...options,
        mime: spec.mime ?? options.mime ?? "image/webp",
      })
    )
  );
}

export function clearAssetLoaderCache() {
  textCache.clear();
  dataUrlCache.clear();
}

export function assetLoaderCacheState() {
  return {
    textEntries: textCache.size,
    dataUrlEntries: dataUrlCache.size,
  };
}
