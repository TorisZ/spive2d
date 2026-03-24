<script>
  import {
    getLayers,
    getActiveLayerId,
    moveLayer,
    setLayerVisible,
    setLayerOpacity,
    GROUP_CYCLE,
    GROUP_COLORS,
  } from '$lib/layerStore.svelte.js';

  let { onLayerSelect, onLayerRemove, onLayerReset, onLayerGroupCycle } = $props();

  function handleLayerClick(id) {
    if (id !== getActiveLayerId()) onLayerSelect(id);
  }

  function handleMoveUp(e, id) {
    e.stopPropagation();
    moveLayer(id, 1);
  }

  function handleMoveDown(e, id) {
    e.stopPropagation();
    moveLayer(id, -1);
  }

  function handleToggleVisible(e, id) {
    e.stopPropagation();
    const layer = getLayers().find(l => l.id === id);
    if (layer) setLayerVisible(id, !layer.visible);
  }

  function handleRemove(e, id) {
    e.stopPropagation();
    onLayerRemove(id);
  }

  function handleReset(e, id) {
    e.stopPropagation();
    onLayerReset(id);
  }

  function handleGroupCycle(e, id) {
    e.stopPropagation();
    onLayerGroupCycle(id);
  }

  function handleOpacity(id, value) {
    setLayerOpacity(id, parseFloat(value));
  }

  function groupColor(groupId) {
    return groupId ? GROUP_COLORS[groupId] : 'transparent';
  }

  function groupTitle(groupId) {
    if (!groupId) return 'No group — click to assign a group';
    if (groupId === 'g1') return 'Group 1 (default) — click to change group';
    const idx = GROUP_CYCLE.indexOf(groupId);
    return `Group ${idx} — click to change group`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div id="layer-panel" onmousedown={(e) => e.stopPropagation()}>
  <div class="panel-title">Layers</div>
  <div class="layers-list">
    <!-- Reversed so highest z-index (top of stack) appears first -->
    {#each [...getLayers()].reverse() as layer (layer.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="layer-row"
        class:active={layer.id === getActiveLayerId()}
        onclick={() => handleLayerClick(layer.id)}
      >
        <!-- Group color indicator -->
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button
          class="group-dot"
          style:background={groupColor(layer.groupId)}
          style:border-color={layer.groupId ? GROUP_COLORS[layer.groupId] : 'rgba(255,255,255,0.3)'}
          onclick={(e) => handleGroupCycle(e, layer.id)}
          title={groupTitle(layer.groupId)}
        ></button>

        <!-- Z-order arrows -->
        <div class="layer-move">
          <button class="icon-btn" onclick={(e) => handleMoveUp(e, layer.id)} title="Move up (higher z-order)">▲</button>
          <button class="icon-btn" onclick={(e) => handleMoveDown(e, layer.id)} title="Move down (lower z-order)">▼</button>
        </div>

        <!-- Visibility eye -->
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button
          class="icon-btn eye-btn"
          class:hidden-layer={!layer.visible}
          onclick={(e) => handleToggleVisible(e, layer.id)}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
        >
          {#if layer.visible}
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
            </svg>
          {/if}
        </button>

        <span class="layer-label" title={layer.label}>{layer.label}</span>

        <!-- Reset transform -->
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button class="icon-btn reset-btn" onclick={(e) => handleReset(e, layer.id)} title="Reset position &amp; scale">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
          </svg>
        </button>

        <!-- Delete -->
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button class="icon-btn delete-btn" onclick={(e) => handleRemove(e, layer.id)} title="Remove layer">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>

      {#if layer.id === getActiveLayerId()}
        <div class="opacity-row" onmousedown={(e) => e.stopPropagation()}>
          <span class="opacity-label">Opacity</span>
          <input
            type="range"
            class="opacity-slider"
            min="0"
            max="1"
            step="0.01"
            value={layer.opacity}
            oninput={(e) => handleOpacity(layer.id, e.target.value)}
          />
          <span class="opacity-value">{Math.round(layer.opacity * 100)}%</span>
        </div>
      {/if}
    {/each}

    {#if getLayers().length === 0}
      <div class="empty-hint">Drop a model folder to add a layer</div>
    {/if}
  </div>

  {#if getLayers().length > 0}
    <div class="group-legend">
      {#each Object.entries(GROUP_COLORS) as [gid, color]}
        <span class="legend-dot" style:background={color} title="Group {GROUP_CYCLE.indexOf(gid)}"></span>
      {/each}
      <span class="legend-label">● = group (cyan = default)</span>
    </div>
  {/if}
</div>

<style>
  #layer-panel {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: var(--sidebar-width);
    padding: 10px;
    background: var(--sidebar-color);
    z-index: 100;
    display: flex;
    flex-direction: column;
  }

  .panel-title {
    font-size: 12px;
    font-weight: bold;
    color: var(--text-color);
    text-shadow: var(--text-shadow);
    text-align: center;
    padding: 4px 0 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    margin-bottom: 6px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .layers-list {
    overflow-y: auto;
    flex: 1;
  }

  .layer-row {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 3px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-color);
    text-shadow: var(--text-shadow);
    user-select: none;
    border: 1px solid transparent;
  }

  .layer-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .layer-row.active {
    background: rgba(51, 153, 221, 0.3);
    border-color: rgba(51, 153, 221, 0.55);
  }

  .group-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: transform 0.1s;
  }

  .group-dot:hover {
    transform: scale(1.4);
  }

  .layer-move {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 3px;
    color: var(--text-color);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    line-height: 1;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .eye-btn {
    flex-shrink: 0;
  }

  .eye-btn.hidden-layer {
    opacity: 0.35;
  }

  .layer-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    min-width: 0;
  }

  .reset-btn:hover {
    color: #8df;
  }

  .delete-btn:hover {
    color: #f66;
  }

  .opacity-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 4px 6px 4px;
  }

  .opacity-label {
    font-size: 11px;
    color: var(--text-color);
    text-shadow: var(--text-shadow);
    white-space: nowrap;
  }

  .opacity-slider {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: #555;
    border-radius: 2px;
    outline: none;
    min-width: 0;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    background: #39d;
    border-radius: 50%;
    cursor: pointer;
  }

  .opacity-value {
    font-size: 11px;
    color: var(--text-color);
    text-shadow: var(--text-shadow);
    min-width: 28px;
    text-align: right;
  }

  .group-legend {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 2px 2px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: 4px;
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-label {
    font-size: 10px;
    color: var(--text-color);
    text-shadow: var(--text-shadow);
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-hint {
    color: var(--text-color);
    text-shadow: var(--text-shadow);
    font-size: 11px;
    text-align: center;
    opacity: 0.55;
    padding: 20px 8px;
    line-height: 1.5;
  }
</style>
