<script>
  import { onMount } from 'svelte';
  import { appState } from '$lib/appState.svelte.js';
  import {
    getLayers,
    getActiveLayer,
    getActiveLayerId,
    addLayer,
    removeLayer,
    setActiveLayerId,
    GROUP_CYCLE,
    GROUP_COLORS,
  } from '$lib/layerStore.svelte.js';
  import { createRenderer } from '$lib/renderer/createRenderer.js';
  import { getSortableKey, findMaxNumber } from '$lib/utils.js';
  import { getAssetUrl } from '$lib/fileManager.js';
  import { exportAllLayersImage, exportAllLayersAnimation, exportAllLayersImageSequence } from '$lib/exporter.js';
  import { createTransformAction } from '$lib/inputAction.js';
  import { loadSetting } from '$lib/settings.js';
  import { showNotification } from '$lib/notificationStore.svelte.js';
  import { t } from '$lib/i18n.svelte.js';
  import { getShortcuts } from '$lib/shortcutKeys.js';
  import SettingsDialog from './SettingsDialog.svelte';
  import Sidebar from './Sidebar.svelte';
  import AnimationController from './AnimationController.svelte';
  import Notification from './Notification.svelte';
  import ExportQueue from './ExportQueue.svelte';
  import LayerPanel from './LayerPanel.svelte';
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { downloadDir, join } from '@tauri-apps/api/path';
  import { mkdir } from '@tauri-apps/plugin-fs';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  if (typeof window !== 'undefined') {
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = window.__TAURI__.core || {};
    window.__TAURI__.core.convertFileSrc = convertFileSrc;
  }

  let dialogOpen = $state(true);
  let showSpinner = $state(false);
  let canvasContainer = $state();
  let sidebar = $state();
  let animController = $state();
  let shortcuts = $state(getShortcuts());
  const transformAction = createTransformAction();

  // Tracks in-flight layer loads so we can cancel stale results.
  // Key: layerId, Value: token object { cancelled: boolean }
  const pendingLoads = new Map();

  function refreshShortcuts() {
    shortcuts = getShortcuts();
  }

  onMount(() => {
    initBackground();
    const unlistenProgress = listen('progress', (event) => {
      appState.processing = event.payload;
      showSpinner = event.payload;
      if (showSpinner) dialogOpen = false;
    });
    const unlistenDragDrop = listen('tauri://drag-drop', async (event) => {
      processPath(event.payload.paths);
    });
    return async () => {
      (await unlistenProgress)();
      (await unlistenDragDrop)();
    };
  });

  // Persist transform to active layer and apply it to the renderer whenever
  // either the transform or the active layer changes.
  // If the active layer belongs to a group, the same transform is mirrored to
  // all other layers in that group so they move/zoom together.
  $effect(() => {
    const activeLayer = getActiveLayer();
    if (!activeLayer || !appState.initialized) return;

    const t = appState.transform;
    activeLayer.transform = { ...t };
    activeLayer.renderer.applyTransform(t.scale, t.moveX, t.moveY, t.rotate);

    if (activeLayer.groupId) {
      for (const layer of getLayers()) {
        if (layer.id !== activeLayer.id && layer.groupId === activeLayer.groupId) {
          layer.transform = { ...t };
          layer.renderer.applyTransform(t.scale, t.moveX, t.moveY, t.rotate);
        }
      }
    }
  });

  function initBackground() {
    const savedImagePath = loadSetting('spive2d_bg_image_path', '');
    const savedColor = loadSetting('spive2d_bg_color', '');
    if (savedImagePath) {
      document.body.style.backgroundColor = '';
      document.body.style.backgroundImage = `url("${getAssetUrl(savedImagePath)}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
    } else if (savedColor) {
      document.body.style.backgroundColor = savedColor;
      document.body.style.backgroundImage = 'none';
    }
  }

  async function processPath(paths) {
    if (appState.processing || paths.length !== 1) return;
    try {
      const inputPath = paths[0];
      let dirFiles = {};
      if (inputPath.startsWith('http://') || inputPath.startsWith('https://')) {
        let url;
        try {
          url = new URL(inputPath);
        } catch {
          showNotification(t('invalidUrl'));
          return;
        }
        const urlString = url.toString();
        const lastSlashIndex = urlString.lastIndexOf('/');
        const dirName = urlString.substring(0, lastSlashIndex + 1);
        const fileNameWithExt = urlString.substring(lastSlashIndex + 1);
        let baseName = fileNameWithExt;
        let ext1 = '';
        let ext2 = '';
        if (fileNameWithExt.endsWith('.model3.json')) {
          baseName = fileNameWithExt.substring(0, fileNameWithExt.length - '.model3.json'.length);
          ext1 = '.model3.json';
          ext2 = '.moc3';
        } else if (fileNameWithExt.endsWith('.skel')) {
          baseName = fileNameWithExt.substring(0, fileNameWithExt.length - '.skel'.length);
          ext1 = '.skel';
          ext2 = '.atlas';
        } else if (fileNameWithExt.endsWith('.json')) {
          baseName = fileNameWithExt.substring(0, fileNameWithExt.length - '.json'.length);
          ext1 = '.json';
          ext2 = '.atlas';
        } else if (fileNameWithExt.endsWith('.asset')) {
          baseName = fileNameWithExt.substring(0, fileNameWithExt.length - '.asset'.length);
          ext1 = '.asset';
          ext2 = '.atlas';
        } else {
          showNotification(t('invalidUrl'));
          return;
        }
        dirFiles = { [dirName]: [[baseName, ext1, ext2]] };
      } else {
        dirFiles = await invoke('handle_dropped_path', { path: inputPath });
      }

      const dirs = Object.keys(dirFiles);
      dirs.sort((a, b) => {
        const keyA = getSortableKey(a);
        const keyB = getSortableKey(b);
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      });
      if (dirs.length === 0) {
        showNotification(t('noFilesFound'));
        return;
      }

      await createNewLayer(dirFiles, dirs);
    } catch (error) {
      console.error('Error handling dropped path:', error);
      if (error?.message?.startsWith('HTTP ')) {
        showNotification(t('resourceNotFound'));
      } else {
        showNotification(t('invalidUrl'));
      }
      showSpinner = false;
    }
  }

  /**
   * Creates a brand-new layer from a set of discovered dir files and appends
   * it to the layer stack. Does NOT dispose any existing layers.
   */
  async function createNewLayer(dirFiles, dirs) {
    const selectedDir = dirs[0];
    const scenes = dirFiles[selectedDir];
    if (!scenes || scenes.length === 0) return;
    const selectedScene = 0;
    const fileNames = scenes[selectedScene];

    const renderer = createRenderer(fileNames);
    if (renderer.setAlphaMode) renderer.setAlphaMode(appState.alphaMode);

    const canvas = renderer.getCanvas();
    if (canvasContainer && !canvasContainer.contains(canvas)) {
      canvasContainer.appendChild(canvas);
    }

    const layerId = crypto.randomUUID();
    const label = selectedDir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Layer';

    // Auto-assign to the default group ('g1'). Adopt its existing transform so
    // the new layer appears at the same position as the already-loaded layers.
    const defaultGroupId = 'g1';
    const existingGroupMember = getLayers().find(l => l.groupId === defaultGroupId);
    const initialTransform = existingGroupMember
      ? { ...existingGroupMember.transform }
      : { scale: 1, moveX: 0, moveY: 0, rotate: 0 };

    const layer = {
      id: layerId,
      renderer,
      label,
      visible: true,
      opacity: 1.0,
      groupId: defaultGroupId,
      transform: initialTransform,
      animSpeed: 1.0,
      animPaused: false,
      directories: { files: dirFiles, entries: dirs, selectedDir, selectedScene },
      propertyCategory: 'attachments',
      selectedAnimation: '',
      selectedExpression: '',
    };

    // Register cancellation token before the async load
    const token = { cancelled: false };
    pendingLoads.set(layerId, token);

    try {
      await renderer.load(selectedDir, fileNames);
    } catch (e) {
      console.error(e);
      pendingLoads.delete(layerId);
      renderer.dispose();
      canvasContainer?.removeChild(canvas);
      if (e?.message?.startsWith('HTTP ')) showNotification(t('resourceNotFound'));
      return;
    }

    if (token.cancelled) {
      // A newer load for this layer superseded this one
      renderer.dispose();
      canvasContainer?.removeChild(canvas);
      return;
    }
    pendingLoads.delete(layerId);

    // Fade in
    requestAnimationFrame(() => { canvas.style.opacity = '1'; });

    // Commit to the layer store (sets activeLayerId = layerId)
    addLayer(layer);

    // Recompute shared MVP bounds so all group members stay visually aligned
    recomputeGroupBounds(layer.groupId);

    // Sync global appState to reflect the new active layer
    syncAppStateFromLayer(layer);

    const animations = renderer.getAnimations();
    if (animations.length > 0) {
      layer.selectedAnimation = animations[0].value;
      sidebar?.setSelectedAnimation(animations[0].value);
      handleAnimationChange(animations[0].value);
    }

    appState.propertyCategory = layer.propertyCategory;
    sidebar?.refreshProperties();
    appState.initialized = true;
    dialogOpen = false;
  }

  /**
   * Reloads the active layer's renderer when the user changes dir or scene
   * in the sidebar selectors.
   */
  async function reloadActiveLayer(newSelectedDir, newSelectedScene, previousSkins = []) {
    const layer = getActiveLayer();
    if (!layer) return;

    // Cancel any pending load for this layer
    const existingToken = pendingLoads.get(layer.id);
    if (existingToken) existingToken.cancelled = true;

    // Dispose current renderer and remove its canvas
    layer.renderer.dispose();
    const oldCanvas = layer.renderer.getCanvas();
    if (canvasContainer?.contains(oldCanvas)) canvasContainer.removeChild(oldCanvas);

    const { files } = layer.directories;
    const scenes = files[newSelectedDir] || [];
    const fileNames = scenes[newSelectedScene];
    if (!fileNames) return;

    const renderer = createRenderer(fileNames);
    if (renderer.setAlphaMode) renderer.setAlphaMode(appState.alphaMode);

    const canvas = renderer.getCanvas();
    if (canvasContainer && !canvasContainer.contains(canvas)) {
      canvasContainer.appendChild(canvas);
    }
    // Maintain z-index position (syncZIndices will correct it once we assign renderer)
    canvas.style.zIndex = oldCanvas.style.zIndex;

    // Update the layer object in-place
    layer.renderer = renderer;
    layer.directories.selectedDir = newSelectedDir;
    layer.directories.selectedScene = newSelectedScene;
    layer.label = newSelectedDir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || layer.label;

    const token = { cancelled: false };
    pendingLoads.set(layer.id, token);

    try {
      await renderer.load(newSelectedDir, fileNames);
    } catch (e) {
      console.error(e);
      pendingLoads.delete(layer.id);
      renderer.dispose();
      canvasContainer?.removeChild(canvas);
      return;
    }

    if (token.cancelled) {
      renderer.dispose();
      canvasContainer?.removeChild(canvas);
      return;
    }
    pendingLoads.delete(layer.id);

    requestAnimationFrame(() => { canvas.style.opacity = '1'; });

    // Recompute shared bounds now that this layer has new skeleton data
    recomputeGroupBounds(layer.groupId);

    // Reset transform for this layer
    layer.transform = { scale: 1, moveX: 0, moveY: 0, rotate: 0 };
    appState.resetTransform();

    // Restore skins if possible
    if (previousSkins.length > 0 && renderer.getPropertyItems && typeof renderer.applySkins === 'function') {
      const available = renderer.getPropertyItems('skins') || [];
      const matching = previousSkins.filter(n => available.some(s => s.name === n));
      if (matching.length > 0) renderer.applySkins(matching);
    }

    layer.propertyCategory = renderer.getPropertyCategories()[0] || 'attachments';
    appState.propertyCategory = layer.propertyCategory;

    const animations = renderer.getAnimations();
    if (animations.length > 0) {
      layer.selectedAnimation = animations[0].value;
      sidebar?.setSelectedAnimation(animations[0].value);
      handleAnimationChange(animations[0].value);
    }
    sidebar?.refreshProperties();
  }

  // ── Layer switching ─────────────────────────────────────────────────────────

  /**
   * Saves current appState fields back to the (currently active) layer object
   * so they can be restored when switching back later.
   */
  function saveActiveLayerState() {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.transform = { ...appState.transform };
    layer.animSpeed = appState.animation.speed;
    layer.animPaused = appState.animation.paused;
    layer.propertyCategory = appState.propertyCategory;
    layer.selectedAnimation = sidebar?.getSelectedAnimation() || '';
    layer.selectedExpression = sidebar?.getSelectedExpression() || '';
  }

  /**
   * Projects a layer's saved state into appState so the sidebar/controls
   * reflect that layer.
   */
  function syncAppStateFromLayer(layer) {
    appState.transform = { ...layer.transform };
    appState.animation = {
      paused: layer.animPaused,
      seeking: false,
      seekProgress: 0,
      currentTime: 0,
      duration: 0,
      speed: layer.animSpeed,
    };
    // Point appState.directories at the layer's own directories object so that
    // Sidebar's dir/scene selectors reactively reflect this layer, and mutations
    // (e.g. handleDirChange) update the layer's object in-place.
    appState.directories = layer.directories;
    appState.propertyCategory = layer.propertyCategory;
  }

  function switchToLayer(id) {
    if (id === getActiveLayerId()) return;
    saveActiveLayerState();
    setActiveLayerId(id);
    const layer = getActiveLayer();
    if (!layer) return;
    syncAppStateFromLayer(layer);
    sidebar?.setSelectedAnimation(layer.selectedAnimation);
    sidebar?.setSelectedExpression(layer.selectedExpression);
    sidebar?.refreshProperties();
    animController?.resetProgress();
  }

  function removeLayerById(id) {
    // If we're removing the active layer, save its state first (harmless either way)
    if (id === getActiveLayerId()) saveActiveLayerState();

    // Cancel any pending load
    const token = pendingLoads.get(id);
    if (token) { token.cancelled = true; pendingLoads.delete(id); }

    const layer = removeLayer(id); // mutates layerStore, updates activeLayerId
    if (layer) {
      // Recompute bounds for the group this layer was in (now one fewer member)
      recomputeGroupBounds(layer.groupId);
      layer.renderer.dispose();
      const canvas = layer.renderer.getCanvas();
      if (canvasContainer?.contains(canvas)) canvasContainer.removeChild(canvas);
    }

    if (getLayers().length === 0) {
      appState.initialized = false;
      appState.directories = { files: null, entries: [], selectedDir: '', selectedScene: 0 };
    } else {
      const newActive = getActiveLayer();
      if (newActive) {
        syncAppStateFromLayer(newActive);
        sidebar?.setSelectedAnimation(newActive.selectedAnimation);
        sidebar?.setSelectedExpression(newActive.selectedExpression);
        sidebar?.refreshProperties();
      }
    }
  }

  // ── Per-layer reset ─────────────────────────────────────────────────────────

  /**
   * Resets a layer's transform (and all its group members) back to
   * scale=1, moveX=0, moveY=0, rotate=0.
   */
  function resetLayerTransform(id) {
    const layers = getLayers();
    const layer = layers.find(l => l.id === id);
    if (!layer) return;

    // Collect all layers that should be reset (the layer itself + group members)
    const toReset = layer.groupId
      ? layers.filter(l => l.groupId === layer.groupId)
      : [layer];

    const activeId = getActiveLayerId();
    const activeIsAffected = toReset.some(l => l.id === activeId);

    // Reset non-active layers directly (active is handled via appState below)
    for (const l of toReset) {
      if (l.id !== activeId) {
        l.transform = { scale: 1, moveX: 0, moveY: 0, rotate: 0 };
        l.renderer.applyTransform(1, 0, 0, 0);
      }
    }

    // Resetting via appState triggers the $effect which will save to the active
    // layer and propagate to group members automatically.
    if (activeIsAffected) {
      appState.resetTransform();
    }
  }

  // ── Layer groups ─────────────────────────────────────────────────────────────

  /**
   * Computes the union of all natural skeleton bounds for every layer in a group,
   * then pushes those shared bounds into each member's renderer so they all use
   * the same MVP coordinate space and stay visually aligned.
   */
  function recomputeGroupBounds(groupId) {
    if (!groupId) return;
    const members = getLayers().filter(l => l.groupId === groupId);
    if (members.length === 0) return;

    if (members.length === 1) {
      // Only one member left — revert to its own natural bounds
      members[0].renderer.setReferenceBounds?.(null);
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const layer of members) {
      const b = layer.renderer.getBounds?.();
      if (!b) continue;
      minX = Math.min(minX, b.offset.x);
      minY = Math.min(minY, b.offset.y);
      maxX = Math.max(maxX, b.offset.x + b.size.x);
      maxY = Math.max(maxY, b.offset.y + b.size.y);
    }
    if (!isFinite(minX)) return;

    const unionBounds = {
      offset: { x: minX, y: minY },
      size: { x: maxX - minX, y: maxY - minY },
    };
    for (const layer of members) {
      layer.renderer.setReferenceBounds?.(unionBounds);
    }
  }

  /**
   * Cycles a layer through: no group → group 1 → group 2 → group 3 → group 4 → no group.
   * When joining an existing group the layer adopts that group's current transform
   * so all members stay aligned. Recomputes shared bounds for both the old and new group.
   */
  function cycleLayerGroup(id) {
    const layers = getLayers();
    const layer = layers.find(l => l.id === id);
    if (!layer) return;

    const oldGroupId = layer.groupId ?? null;
    const currentIdx = GROUP_CYCLE.indexOf(oldGroupId);
    const newGroupId = GROUP_CYCLE[(currentIdx + 1) % GROUP_CYCLE.length];

    // When joining an existing non-empty group, adopt its transform
    if (newGroupId !== null) {
      const existingMember = layers.find(l => l.id !== id && l.groupId === newGroupId);
      if (existingMember) {
        layer.transform = { ...existingMember.transform };
        layer.renderer.applyTransform(
          layer.transform.scale,
          layer.transform.moveX,
          layer.transform.moveY,
          layer.transform.rotate
        );
        if (id === getActiveLayerId()) {
          appState.transform = { ...layer.transform };
        }
      }
    } else {
      // Leaving all groups: revert to natural bounds
      layer.renderer.setReferenceBounds?.(null);
    }

    layer.groupId = newGroupId;

    // Recompute shared bounds for both the group we left and the one we joined
    recomputeGroupBounds(oldGroupId);
    recomputeGroupBounds(newGroupId);
  }

  // ── Sidebar event handlers ──────────────────────────────────────────────────

  function handleDirChange(e) {
    const newDir = e.target.value;
    const layer = getActiveLayer();
    if (!layer) return;
    const oldDir = layer.directories.selectedDir;
    const oldScenes = layer.directories.files[oldDir] || [];
    const currentSceneStr = oldScenes[layer.directories.selectedScene]?.[0] || '';
    const maxNumber = findMaxNumber(currentSceneStr);
    const scenes = layer.directories.files[newDir] || [];
    let idx = -1;
    if (maxNumber !== null) {
      idx = scenes.findIndex(item => String(item[0]).includes(String(maxNumber)));
    }
    const newSceneIdx = idx === -1 ? 0 : idx;
    const previousSkins = layer.renderer?.getPropertyItems?.('skins')?.filter(i => i.checked).map(i => i.name) || [];
    reloadActiveLayer(newDir, newSceneIdx, previousSkins);
  }

  function handleSceneChange(e) {
    const idx = e.target.selectedIndex;
    const layer = getActiveLayer();
    if (!layer) return;
    const previousSkins = layer.renderer?.getPropertyItems?.('skins')?.filter(i => i.checked).map(i => i.name) || [];
    reloadActiveLayer(layer.directories.selectedDir, idx, previousSkins);
  }

  function handleAnimationChange(value) {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.renderer?.setAnimation(value);
    layer.selectedAnimation = value;
    if (appState.animation.paused) {
      animController?.resetProgress();
      requestAnimationFrame(() => { layer.renderer?.seekAnimation(0); });
    }
    sidebar?.refreshProperties();
  }

  function handleExpressionChange(value) {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.renderer?.setExpression(value);
    layer.selectedExpression = value;
  }

  // ── Resize ──────────────────────────────────────────────────────────────────

  function handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    appState.viewport = { width: w, height: h };
    for (const layer of getLayers()) {
      layer.renderer.resize(w, h);
      layer.renderer.applyTransform(
        layer.transform.scale,
        layer.transform.moveX,
        layer.transform.moveY,
        layer.transform.rotate
      );
    }
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  function handleKeyDown(e) {
    if (document.activeElement?.matches('input')) return;
    const key = e.key.toLowerCase();
    if ((key === 'w' || key === 'q') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      getCurrentWindow().close();
      return;
    }
    if (e.key !== shortcuts.toggleDialog && !appState.initialized) return;
    if (e.key === shortcuts.prevDir) { navigateSelector('dirSelector', -1, handleDirChange); }
    else if (e.key === shortcuts.nextDir) { navigateSelector('dirSelector', 1, handleDirChange); }
    else if (e.key === shortcuts.prevScene) { navigateSelector('sceneSelector', -1, handleSceneChange); }
    else if (e.key === shortcuts.nextScene) { navigateSelector('sceneSelector', 1, handleSceneChange); }
    else if (e.key === shortcuts.prevAnim) { sidebar?.navigateAnimation(-1); }
    else if (e.key === shortcuts.nextAnim) { sidebar?.navigateAnimation(1); }
    else if (e.key === shortcuts.exportImage) { doExportImage(); }
    else if (e.key === shortcuts.exportImageSeq) { doExportImageSequence(); }
    else if (e.key === shortcuts.exportAnim) { doExportAnimation(); }
    else if (e.key === shortcuts.toggleDialog) { toggleDialog(); }
    else if (e.key === shortcuts.addToList) {
      invoke('append_to_list', { text: getSceneText() }).then(() => {
        showNotification(t('addedToList'), 'success');
      });
    }
    else { return; }
    focusBody();
  }

  function navigateSelector(selectorId, delta, handler) {
    const layer = getActiveLayer();
    if (!layer) return;
    if (selectorId === 'sceneSelector') {
      const ops = layer.directories.files[layer.directories.selectedDir] || [];
      if (ops.length <= 1) return;
      const newIndex = (layer.directories.selectedScene + delta + ops.length) % ops.length;
      handler({ target: { selectedIndex: newIndex } });
    } else if (selectorId === 'dirSelector') {
      const ops = layer.directories.entries || [];
      if (ops.length <= 1) return;
      const currentIndex = ops.indexOf(layer.directories.selectedDir);
      const newIndex = (currentIndex + delta + ops.length) % ops.length;
      handler({ target: { value: ops[newIndex] } });
    }
  }

  function toggleDialog() {
    if (showSpinner) return;
    dialogOpen = !dialogOpen;
  }

  function focusBody() {
    if (document.activeElement !== document.body) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.body.focus();
    }
  }

  // ── Animation sync ──────────────────────────────────────────────────────────

  /**
   * Seeks every layer's animation back to the start simultaneously so they
   * play in sync. Also resets the seeker UI.
   */
  function syncAllAnimations() {
    for (const layer of getLayers()) {
      layer.renderer?.seekAnimation?.(0);
    }
    animController?.resetProgress();
  }

  // ── Export helpers ──────────────────────────────────────────────────────────

  function doExportImage() {
    exportAllLayersImage(getLayers(), getSceneText(), sidebar?.getSelectedAnimationText() || '');
  }

  function doExportAnimation() {
    exportAllLayersAnimation(
      getLayers(),
      getSceneText(),
      sidebar?.getSelectedAnimationText() || ''
    );
  }

  async function doExportImageSequence() {
    const sceneText = getSceneText();
    const animText = sidebar?.getSelectedAnimationText() || '';
    const safeName = animText ? animText.split('.')[0] : 'sequence';
    const baseDir = await downloadDir();
    const exportBaseDir = await join(baseDir, 'spive2d_export');
    const targetDir = await join(exportBaseDir, `${sceneText}_${safeName}`);
    try {
      await mkdir(targetDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create export directory:', err);
    }
    exportAllLayersImageSequence(getLayers(), targetDir, sceneText, animText);
  }

  function getSceneText() {
    const layer = getActiveLayer();
    if (!layer) return 'scene';
    const { files, selectedDir, selectedScene } = layer.directories;
    const scenes = files?.[selectedDir] || [];
    const sceneStr = scenes[selectedScene]?.[0] || '';
    return sceneStr ? sceneStr.split('/').filter(Boolean).pop() : 'scene';
  }

  function handleContextMenu(e) {
    e.preventDefault();
  }
</script>

<svelte:window
  onresize={handleResize}
  onkeydown={handleKeyDown}
/>

{#if showSpinner}
  <div id="spinner-backdrop">
    <div id="spinner"></div>
  </div>
{/if}

<div use:transformAction={{ appState, sidebar, animController, dialogOpen }}>
  <SettingsDialog bind:open={dialogOpen} onPathSelected={processPath} onShortcutsChanged={refreshShortcuts} />
  <Sidebar
    bind:this={sidebar}
    onDirChange={handleDirChange}
    onSceneChange={handleSceneChange}
    onAnimationChange={handleAnimationChange}
    onExpressionChange={handleExpressionChange}
  />
  <LayerPanel
    onLayerSelect={switchToLayer}
    onLayerRemove={removeLayerById}
    onLayerReset={resetLayerTransform}
    onLayerGroupCycle={cycleLayerGroup}
  />
  <div id="canvasContainer" bind:this={canvasContainer}></div>
</div>

<AnimationController bind:this={animController} onSyncAll={syncAllAnimations} />

<ExportQueue />
<Notification />

<style>
  #spinner-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(3px);
    z-index: 2999;
  }

  #spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 80px;
    height: 80px;
    border: 8px solid #eee;
    border-top: 8px solid #888;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  #canvasContainer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
  }

  #canvasContainer :global(canvas) {
    position: absolute;
    top: 0;
    left: 0;
  }
</style>
