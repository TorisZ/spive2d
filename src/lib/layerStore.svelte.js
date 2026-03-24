// Group IDs layers can be assigned to. null = no group.
export const GROUP_CYCLE = [null, 'g1', 'g2', 'g3', 'g4'];
export const GROUP_COLORS = {
  g1: '#3cf',
  g2: '#fc3',
  g3: '#f73',
  g4: '#c3f',
};

let layers = $state([]);
let activeLayerId = $state(null);

export function getLayers() {
  return layers;
}

export function getActiveLayerId() {
  return activeLayerId;
}

export function getActiveLayer() {
  if (!activeLayerId) return null;
  return layers.find(l => l.id === activeLayerId) ?? null;
}

export function getActiveLayerRenderer() {
  return getActiveLayer()?.renderer ?? null;
}

export function addLayer(layer) {
  layers.push(layer);
  activeLayerId = layer.id;
  syncZIndices();
}

/**
 * Removes a layer from the store. Returns the removed layer object so
 * the caller can dispose the renderer and remove the canvas.
 */
export function removeLayer(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const [layer] = layers.splice(idx, 1);
  if (activeLayerId === id) {
    activeLayerId = layers[layers.length - 1]?.id ?? null;
  }
  syncZIndices();
  return layer;
}

export function setActiveLayerId(id) {
  activeLayerId = id;
}

/**
 * Moves a layer by `delta` positions in the array.
 * +1 = higher z-index (toward end, rendered on top)
 * -1 = lower z-index (toward start, rendered behind)
 */
export function moveLayer(id, delta) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= layers.length) return;
  const tmp = layers[idx];
  layers[idx] = layers[newIdx];
  layers[newIdx] = tmp;
  syncZIndices();
}

export function setLayerVisible(id, visible) {
  const layer = layers.find(l => l.id === id);
  if (!layer) return;
  layer.visible = visible;
  const canvas = layer.renderer?.getCanvas();
  if (canvas) canvas.style.opacity = visible ? String(layer.opacity) : '0';
}

export function setLayerOpacity(id, opacity) {
  const layer = layers.find(l => l.id === id);
  if (!layer) return;
  layer.opacity = opacity;
  const canvas = layer.renderer?.getCanvas();
  if (canvas && layer.visible) canvas.style.opacity = String(opacity);
}

function syncZIndices() {
  layers.forEach((layer, i) => {
    const canvas = layer.renderer?.getCanvas();
    if (canvas) canvas.style.zIndex = String(i + 1);
  });
}
