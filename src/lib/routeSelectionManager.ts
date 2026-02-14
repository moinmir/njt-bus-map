import L from "leaflet";
import { HOVER_POINTER_QUERY, POPUP_CLOSE_DELAY_MS } from "./constants";
import { getRouteHoverLabel } from "./routeLabel";
import { loadRouteData, loadScheduleData } from "./transitDataClient";
import { attachInteractivePopup } from "./attachInteractivePopup";
import { buildStopPopupContent } from "./buildStopPopupContent";
import type {
  RouteState,
  RouteSelectionManager,
  SetRouteKeysOptions,
  ScheduleData,
} from "@/types";

interface ManagerDeps {
  map: L.Map;
  routeStateByKey: Map<string, RouteState>;
  selectedRouteKeys: Set<string>;
  onStatusUpdate: (text: string) => void;
  onUiRefresh: () => void;
}

export function createRouteSelectionManager({
  map,
  routeStateByKey,
  selectedRouteKeys,
  onStatusUpdate,
  onUiRefresh,
}: ManagerDeps): RouteSelectionManager {
  const refreshUi = onUiRefresh;
  const previewHoverCountsByRouteKey = new Map<string, number>();
  const previewActivationOrderByRouteKey = new Map<string, number>();
  let activePreviewRouteKey: string | null = null;
  let previewActivationSequence = 0;

  function setLayerVisibility(state: RouteState, visible: boolean): void {
    if (!state.layer) return;
    const hasLayer = map.hasLayer(state.layer);
    if (visible && !hasLayer) {
      map.addLayer(state.layer);
      return;
    }
    if (!visible && hasLayer) {
      map.removeLayer(state.layer);
    }
  }

  function shouldShowSelectedRoute(routeKey: string, state: RouteState): boolean {
    if (!state.selected || !state.layer) return false;
    if (!activePreviewRouteKey) return true;
    return routeKey === activePreviewRouteKey;
  }

  function syncSelectedRouteLayer(routeKey: string): void {
    const state = routeStateByKey.get(routeKey);
    if (!state) return;
    setLayerVisibility(state, shouldShowSelectedRoute(routeKey, state));
  }

  function syncAllSelectedRouteLayers(): void {
    for (const routeKey of selectedRouteKeys) {
      syncSelectedRouteLayer(routeKey);
    }
  }

  function pickNextPreviewRouteKey(): string | null {
    let nextRouteKey: string | null = null;
    let bestActivation = -1;

    for (const [routeKey, hoverCount] of previewHoverCountsByRouteKey) {
      if (hoverCount <= 0) continue;
      const state = routeStateByKey.get(routeKey);
      if (!state?.selected) continue;

      const activationOrder = previewActivationOrderByRouteKey.get(routeKey) ?? -1;
      if (activationOrder > bestActivation) {
        bestActivation = activationOrder;
        nextRouteKey = routeKey;
      }
    }

    return nextRouteKey;
  }

  function applyActivePreviewRoute(routeKey: string | null): void {
    if (activePreviewRouteKey === routeKey) return;
    activePreviewRouteKey = routeKey;
    syncAllSelectedRouteLayers();
  }

  function startStationHoverPreview(routeKey: string): void {
    const state = routeStateByKey.get(routeKey);
    if (!state?.selected) return;

    previewHoverCountsByRouteKey.set(routeKey, (previewHoverCountsByRouteKey.get(routeKey) ?? 0) + 1);
    previewActivationSequence += 1;
    previewActivationOrderByRouteKey.set(routeKey, previewActivationSequence);
    applyActivePreviewRoute(routeKey);
  }

  function endStationHoverPreview(routeKey: string): void {
    const hoverCount = previewHoverCountsByRouteKey.get(routeKey) ?? 0;
    if (hoverCount <= 1) {
      previewHoverCountsByRouteKey.delete(routeKey);
      previewActivationOrderByRouteKey.delete(routeKey);
    } else {
      previewHoverCountsByRouteKey.set(routeKey, hoverCount - 1);
    }

    if (activePreviewRouteKey !== routeKey) return;
    if ((previewHoverCountsByRouteKey.get(routeKey) ?? 0) > 0) return;
    applyActivePreviewRoute(pickNextPreviewRouteKey());
  }

  function clearStationHoverPreviewForRoute(routeKey: string): void {
    previewHoverCountsByRouteKey.delete(routeKey);
    previewActivationOrderByRouteKey.delete(routeKey);
    if (activePreviewRouteKey !== routeKey) return;
    applyActivePreviewRoute(pickNextPreviewRouteKey());
  }

  async function setRouteKeysSelected(
    keys: string[],
    selected: boolean,
    options: SetRouteKeysOptions = {},
  ): Promise<void> {
    if (keys.length === 0) {
      if (options.refreshUiAtEnd !== false) {
        refreshUi();
      }
      return;
    }

    const { concurrency = 6, refreshUiAtEnd = true, statusText = "" } = options;

    if (statusText) {
      onStatusUpdate(statusText);
    }

    const queue = [...keys];
    const workerCount = Math.min(concurrency, queue.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const routeKey = queue.shift();
        if (!routeKey) continue;
        await setRouteSelectionInternal(routeKey, selected, false);
      }
    });

    await Promise.all(workers);

    if (refreshUiAtEnd) {
      refreshUi();
    }
  }

  async function setRouteSelection(routeKey: string, selected: boolean): Promise<void> {
    await setRouteSelectionInternal(routeKey, selected, true);
  }

  async function setRouteSelectionInternal(
    routeKey: string,
    selected: boolean,
    refreshUiAtEnd: boolean,
  ): Promise<void> {
    const state = routeStateByKey.get(routeKey);
    if (!state) {
      if (refreshUiAtEnd) {
        refreshUi();
      }
      return;
    }

    state.selected = selected;

    try {
      if (selected) {
        selectedRouteKeys.add(routeKey);

        try {
          await ensureRouteLoaded(state);
          if (!state.selected || !state.layer) {
            return;
          }
          syncSelectedRouteLayer(routeKey);
        } catch (error) {
          console.error(error);
          state.selected = false;
          selectedRouteKeys.delete(routeKey);
          clearStationHoverPreviewForRoute(routeKey);
          syncSelectedRouteLayer(routeKey);
          onStatusUpdate(
            `Failed to load route ${state.meta.shortName}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      } else {
        selectedRouteKeys.delete(routeKey);
        clearStationHoverPreviewForRoute(routeKey);
        syncSelectedRouteLayer(routeKey);
      }
    } finally {
      if (refreshUiAtEnd) {
        refreshUi();
      }
    }
  }

  async function ensureRouteLoaded(state: RouteState): Promise<void> {
    if (state.layer) {
      prefetchScheduleForRoute(state);
      return;
    }

    // Area filtering may pre-load route data before a route is selected.
    if (state.routeData) {
      state.layer = buildRouteLayer(state);
      prefetchScheduleForRoute(state);
      return;
    }

    if (state.loadPromise) {
      await state.loadPromise;
      return;
    }

    state.loadPromise = (async () => {
      const routeData = await loadRouteData(state.meta.file);
      state.routeData = routeData;
      state.layer = buildRouteLayer(state);
      prefetchScheduleForRoute(state);
    })();

    try {
      await state.loadPromise;
    } finally {
      state.loadPromise = null;
    }
  }

  function resolveScheduleFile(state: RouteState): string | null {
    return state.meta.scheduleFile || state.routeData?.scheduleFile || null;
  }

  async function ensureRouteScheduleLoaded(state: RouteState): Promise<ScheduleData | null> {
    if (state.routeData?.activeServicesByDayByDirection) {
      return null;
    }

    if (state.scheduleData) {
      return state.scheduleData;
    }

    const scheduleFile = resolveScheduleFile(state);
    if (!scheduleFile) {
      return null;
    }

    if (state.scheduleLoadPromise) {
      return state.scheduleLoadPromise;
    }

    state.scheduleLoadPromise = loadScheduleData(scheduleFile)
      .then((scheduleData) => {
        state.scheduleData = scheduleData;
        return scheduleData;
      })
      .finally(() => {
        state.scheduleLoadPromise = null;
      });

    return state.scheduleLoadPromise;
  }

  function prefetchScheduleForRoute(state: RouteState): void {
    if (!state.routeData) return;
    if (state.routeData.activeServicesByDayByDirection) return;
    if (state.scheduleData || state.scheduleLoadPromise) return;

    const scheduleFile = resolveScheduleFile(state);
    if (!scheduleFile) return;

    void ensureRouteScheduleLoaded(state).catch((error) => {
      console.warn(`Schedule preload failed for route ${state.meta.shortName}:`, error);
    });
  }

  function buildRouteLayer(state: RouteState): L.LayerGroup {
    const routeData = state.routeData!;
    const routeMeta = state.meta;
    const group = L.layerGroup();
    const routeHoverLabel = getRouteHoverLabel(routeMeta);

    for (const shape of routeData.shapes ?? []) {
      const polyline = L.polyline(shape.points, {
        color: routeMeta.color,
        weight: 3.8,
        opacity: 0.86,
        lineCap: "round",
        lineJoin: "round",
      });

      polyline.bindTooltip(routeHoverLabel, {
        sticky: true,
        direction: "top",
        offset: [0, -4],
        className: "route-hover-tooltip",
      });

      polyline.addTo(group);
    }

    for (const stop of routeData.stops ?? []) {
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 5.2,
        color: "#ffffff",
        weight: 1.4,
        fillColor: routeMeta.color,
        fillOpacity: 0.95,
      });

      marker.bindPopup("", {
        closeButton: false,
        autoPan: true,
        className: "stop-popup",
        offset: [0, -6],
      });

      attachInteractivePopup(
        marker,
        async () => {
          let scheduleData = state.scheduleData;
          if (!scheduleData && !routeData.activeServicesByDayByDirection) {
            scheduleData = await ensureRouteScheduleLoaded(state);
          }
          return buildStopPopupContent(routeMeta, routeData, stop, scheduleData);
        },
        {
          closeDelayMs: POPUP_CLOSE_DELAY_MS,
          hoverPointerQuery: HOVER_POINTER_QUERY,
          onHoverSessionStart: () => {
            startStationHoverPreview(routeMeta.key);
          },
          onHoverSessionEnd: () => {
            endStationHoverPreview(routeMeta.key);
          },
        },
      );

      marker.addTo(group);
    }

    return group;
  }

  return {
    setRouteSelection,
    setRouteKeysSelected,
  };
}
