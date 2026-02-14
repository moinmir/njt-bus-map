import { HOVER_POINTER_QUERY, POPUP_CLOSE_DELAY_MS } from "../../config/constants.js";
import { loadRouteData, loadScheduleData } from "../../data/transitDataClient.js";
import { attachInteractivePopup } from "../../map/attachInteractivePopup.js";
import { buildStopPopupContent } from "../../ui/popup/buildStopPopupContent.js";

export function createRouteSelectionManager({
  map,
  routeStateByKey,
  selectedRouteKeys,
  statusNode,
  onUiRefresh,
}) {
  const refreshUi = typeof onUiRefresh === "function" ? onUiRefresh : () => undefined;

  async function setRouteKeysSelected(keys, selected, options = {}) {
    if (keys.length === 0) {
      if (options.refreshUiAtEnd !== false) {
        refreshUi();
      }
      return;
    }

    const { concurrency = 6, refreshUiAtEnd = true, statusText = "" } = options;

    if (statusText) {
      statusNode.textContent = statusText;
    }

    const queue = [...keys];
    const workerCount = Math.min(concurrency, queue.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const routeKey = queue.shift();
        if (!routeKey) continue;
        await setRouteSelection(routeKey, selected, { refreshUi: false });
      }
    });

    await Promise.all(workers);

    if (refreshUiAtEnd) {
      refreshUi();
    }
  }

  async function setRouteSelection(routeKey, selected, options = {}) {
    const state = routeStateByKey.get(routeKey);
    if (!state) return;

    state.selected = selected;
    if (state.checkbox.checked !== selected) {
      state.checkbox.checked = selected;
    }

    if (selected) {
      selectedRouteKeys.add(routeKey);

      try {
        await ensureRouteLoaded(state);
        if (!state.selected || !state.layer) {
          return;
        }
        if (!map.hasLayer(state.layer)) {
          map.addLayer(state.layer);
        }
      } catch (error) {
        console.error(error);
        state.selected = false;
        state.checkbox.checked = false;
        selectedRouteKeys.delete(routeKey);
        statusNode.textContent = `Failed to load route ${state.meta.shortName}: ${error.message}`;
      }
    } else {
      selectedRouteKeys.delete(routeKey);
      if (state.layer && map.hasLayer(state.layer)) {
        map.removeLayer(state.layer);
      }
    }

    if (options.refreshUi !== false) {
      refreshUi();
    }
  }

  async function ensureRouteLoaded(state) {
    if (state.layer) {
      prefetchScheduleForRoute(state);
      return;
    }

    if (state.loadPromise) {
      await state.loadPromise;
      return;
    }

    state.row.classList.add("is-loading");
    state.loadPromise = (async () => {
      const routeData = await loadRouteData(state.meta.file);
      state.routeData = routeData;
      state.layer = buildRouteLayer(state, routeData);
      prefetchScheduleForRoute(state);
    })();

    try {
      await state.loadPromise;
    } finally {
      state.loadPromise = null;
      state.row.classList.remove("is-loading");
    }
  }

  function resolveScheduleFile(state) {
    return state.meta.scheduleFile || state.routeData?.scheduleFile || null;
  }

  async function ensureRouteScheduleLoaded(state) {
    if (state.routeData?.activeServicesByDay) {
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

  function prefetchScheduleForRoute(state) {
    if (!state.routeData) return;
    if (state.routeData.activeServicesByDay) return;
    if (state.scheduleData || state.scheduleLoadPromise) return;

    const scheduleFile = resolveScheduleFile(state);
    if (!scheduleFile) return;

    void ensureRouteScheduleLoaded(state).catch((error) => {
      console.warn(`Schedule preload failed for route ${state.meta.shortName}:`, error);
    });
  }

  function buildRouteLayer(state, routeData) {
    const routeMeta = state.meta;
    const group = L.layerGroup();

    for (const shape of routeData.shapes ?? []) {
      L.polyline(shape.points, {
        color: routeMeta.color,
        weight: 3.8,
        opacity: 0.86,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
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
          if (!scheduleData && !routeData.activeServicesByDay) {
            scheduleData = await ensureRouteScheduleLoaded(state);
          }
          return buildStopPopupContent(routeMeta, routeData, stop, scheduleData);
        },
        {
          closeDelayMs: POPUP_CLOSE_DELAY_MS,
          hoverPointerQuery: HOVER_POINTER_QUERY,
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
