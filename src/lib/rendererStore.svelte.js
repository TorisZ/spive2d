import { getActiveLayerRenderer } from './layerStore.svelte.js';

/**
 * Returns the active layer's renderer.
 * All existing callers (exporter, AnimationController, Sidebar, inputAction)
 * automatically target the active layer without any changes.
 */
export function getRenderer() {
  return getActiveLayerRenderer();
}

export function setRenderer(_renderer) {
  // no-op: renderers are now managed through layerStore
}
