import {
  HOVER_POINTER_QUERY,
  MOBILE_LAYOUT_QUERY,
  POPUP_CLOSE_DELAY_MS,
} from "./config/constants.js";
import { loadManifest, loadRouteData, loadScheduleData } from "./data/transitDataClient.js";
import { attachInteractivePopup } from "./map/attachInteractivePopup.js";
import { createBaseMap } from "./map/createBaseMap.js";
import { buildStopPopupContent } from "./ui/popup/buildStopPopupContent.js";
import { escapeHtml } from "./utils/escapeHtml.js";

const mobileLayoutMediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
const map = createBaseMap();

const routeGroupsNode = document.getElementById("route-groups");
const routeSearchNode = document.getElementById("route-search");
const statusNode = document.getElementById("status");
const sourceDetailsNode = document.getElementById("source-details");
const fitButton = document.getElementById("fit-selected");
const locateMeButton = document.getElementById("locate-me");
const selectVisibleButton = document.getElementById("select-visible");
const clearSelectedButton = document.getElementById("clear-selected");
const searchAreaButton = document.getElementById("search-area");
const clearAreaButton = document.getElementById("clear-area");
const panelNode = document.querySelector(".panel");
const panelToggleButton = document.getElementById("panel-toggle");

const routeStateByKey = new Map();
const agencyStateById = new Map();
const selectedRouteKeys = new Set();

let activeSearchTerm = "";
let activeAreaBounds = null;
let userLocationLayer = null;
let mobilePanelCollapsed = mobileLayoutMediaQuery.matches;
let areaSelectionInProgress = false;

init().catch((error) => {
  console.error(error);
  statusNode.textContent = `Failed to load data: ${error.message}`;
});

async function init() {
  const manifestData = await loadManifest();

  buildRouteControls(manifestData);
  renderSourceDetails(manifestData.sources ?? []);
  attachTopLevelEvents();
  configureMobilePanel();
  registerServiceWorker();
  applySearchFilter();
  updateAreaFilterControls();
  updateStatus();
}

function attachTopLevelEvents() {
  routeSearchNode.addEventListener("input", () => {
    activeSearchTerm = routeSearchNode.value.trim().toLowerCase();
    applySearchFilter();
    updateStatus();
  });

  fitButton.addEventListener("click", fitToSelectedRoutes);
  locateMeButton.addEventListener("click", locateUser);

  searchAreaButton?.addEventListener("click", () => {
    void applyCurrentMapAreaFilter();
  });

  clearAreaButton?.addEventListener("click", () => {
    void clearAreaFilter();
  });

  selectVisibleButton.addEventListener("click", () => {
    void setRouteKeysSelected(getVisibleRouteKeys(), true, {
      statusText: "Loading visible routes...",
    });
  });

  clearSelectedButton.addEventListener("click", () => {
    void setRouteKeysSelected([...selectedRouteKeys], false);
  });
}

function configureMobilePanel() {
  if (!panelNode || !panelToggleButton) return;

  const syncPanelState = () => {
    const shouldCollapse = mobileLayoutMediaQuery.matches && mobilePanelCollapsed;
    panelNode.classList.toggle("is-collapsed", shouldCollapse);
    panelToggleButton.setAttribute("aria-expanded", String(!shouldCollapse));
    panelToggleButton.textContent = shouldCollapse ? "Show Controls" : "Hide Controls";
    window.setTimeout(() => map.invalidateSize(), 180);
  };

  panelToggleButton.addEventListener("click", () => {
    mobilePanelCollapsed = !mobilePanelCollapsed;
    syncPanelState();
  });

  const onViewportChange = (event) => {
    mobilePanelCollapsed = event.matches;
    syncPanelState();
  };

  if (typeof mobileLayoutMediaQuery.addEventListener === "function") {
    mobileLayoutMediaQuery.addEventListener("change", onViewportChange);
  } else {
    mobileLayoutMediaQuery.addListener(onViewportChange);
  }

  syncPanelState();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => registration.update())
        .catch((error) => {
          console.warn("Service worker registration failed:", error);
        });
    },
    { once: true },
  );
}

function locateUser() {
  if (!("geolocation" in navigator)) {
    statusNode.textContent = "Geolocation is not supported on this browser.";
    return;
  }

  statusNode.textContent = "Locating your position...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      const latLng = [latitude, longitude];

      map.flyTo(latLng, 13, { animate: true, duration: 0.6 });

      if (userLocationLayer && map.hasLayer(userLocationLayer)) {
        map.removeLayer(userLocationLayer);
      }

      const marker = L.circleMarker(latLng, {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#0d4278",
        fillOpacity: 1,
      });
      marker.bindTooltip("Your location", { direction: "top", offset: [0, -8] });

      const accuracyRing = L.circle(latLng, {
        radius: Math.max(accuracy, 50),
        color: "#0d4278",
        weight: 1,
        fillOpacity: 0.12,
      });

      userLocationLayer = L.layerGroup([accuracyRing, marker]).addTo(map);
      statusNode.textContent = "Centered map on your current location.";
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        statusNode.textContent =
          "Location permission is blocked. Enable location access and try again.";
        return;
      }
      statusNode.textContent = "Unable to read your location right now.";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    },
  );
}

function buildRouteControls(manifest) {
  routeGroupsNode.innerHTML = "";

  const agencies = manifest.agencies ?? [];
  const routes = manifest.routes ?? [];
  const routesByAgency = new Map();

  for (const agency of agencies) {
    routesByAgency.set(agency.id, []);
  }

  for (const route of routes) {
    if (!routesByAgency.has(route.agencyId)) {
      routesByAgency.set(route.agencyId, []);
    }
    routesByAgency.get(route.agencyId).push(route);
  }

  for (const agency of agencies) {
    const agencyRoutes = (routesByAgency.get(agency.id) ?? []).sort((a, b) =>
      a.shortName.localeCompare(b.shortName, undefined, { numeric: true, sensitivity: "base" }),
    );

    const details = document.createElement("details");
    details.className = "agency-group";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="agency-label">${escapeHtml(agency.label)}</span><span class="agency-count" data-agency-count="${escapeHtml(agency.id)}"></span>`;
    details.appendChild(summary);

    const actions = document.createElement("div");
    actions.className = "agency-actions-row";
    actions.innerHTML = `
      <button type="button" class="secondary" data-action="select-visible" data-agency="${escapeHtml(agency.id)}">Select Visible</button>
      <button type="button" class="secondary" data-action="clear-agency" data-agency="${escapeHtml(agency.id)}">Clear Agency</button>
    `;
    details.appendChild(actions);

    const routeList = document.createElement("div");
    routeList.className = "route-list";
    details.appendChild(routeList);

    routeGroupsNode.appendChild(details);

    const agencyState = {
      agency,
      details,
      countNode: summary.querySelector("[data-agency-count]"),
      routeKeys: [],
    };
    agencyStateById.set(agency.id, agencyState);

    for (const route of agencyRoutes) {
      const routeRow = buildRouteRow(route);
      routeList.appendChild(routeRow.row);

      agencyState.routeKeys.push(route.key);
      routeStateByKey.set(route.key, {
        meta: route,
        row: routeRow.row,
        checkbox: routeRow.checkbox,
        selected: false,
        isVisible: true,
        layer: null,
        routeData: null,
        scheduleData: null,
        loadPromise: null,
        scheduleLoadPromise: null,
      });
    }
  }

  routeGroupsNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const agencyId = target.dataset.agency;
    if (!action || !agencyId) return;

    const agencyState = agencyStateById.get(agencyId);
    if (!agencyState) return;

    if (action === "select-visible") {
      void selectVisibleInAgency(agencyState);
      return;
    }

    if (action === "clear-agency") {
      const selectedInAgency = agencyState.routeKeys.filter((key) => routeStateByKey.get(key)?.selected);
      void setRouteKeysSelected(selectedInAgency, false);
    }
  });
}

function buildRouteRow(routeMeta) {
  const row = document.createElement("label");
  row.className = "route-option";
  row.dataset.routeKey = routeMeta.key;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = false;

  const swatch = document.createElement("span");
  swatch.className = "route-swatch";
  swatch.style.background = routeMeta.color;

  const text = document.createElement("span");
  text.className = "route-text";

  const title = document.createElement("span");
  title.className = "route-title";
  title.textContent = routeMeta.shortName;

  const longPart = routeMeta.longName ? ` - ${routeMeta.longName}` : "";
  const sub = document.createElement("span");
  sub.className = "route-sub";
  sub.textContent = `${routeMeta.stopCount} stops${longPart}`;

  text.appendChild(title);
  text.appendChild(sub);

  row.appendChild(checkbox);
  row.appendChild(swatch);
  row.appendChild(text);

  checkbox.addEventListener("change", () => {
    void setRouteSelection(routeMeta.key, checkbox.checked);
  });

  return { row, checkbox };
}

async function selectVisibleInAgency(agencyState) {
  const keys = agencyState.routeKeys.filter((key) => routeStateByKey.get(key)?.isVisible);
  await setRouteKeysSelected(keys, true);
}

function getVisibleRouteKeys() {
  const keys = [];
  for (const [key, state] of routeStateByKey) {
    if (state.isVisible) {
      keys.push(key);
    }
  }
  return keys;
}

async function setRouteKeysSelected(keys, selected, options = {}) {
  if (keys.length === 0) {
    applySearchFilter();
    updateStatus();
    return;
  }

  const {
    concurrency = 6,
    refreshUiAtEnd = true,
    statusText = "",
  } = options;

  if (statusText) {
    statusNode.textContent = statusText;
  }

  const queue = [...keys];
  const workerCount = Math.min(concurrency, queue.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) continue;
      await setRouteSelection(key, selected, { refreshUi: false });
    }
  });

  await Promise.all(workers);

  if (refreshUiAtEnd) {
    applySearchFilter();
    updateStatus();
  }
}

async function applyCurrentMapAreaFilter() {
  if (areaSelectionInProgress) return;
  areaSelectionInProgress = true;
  updateAreaFilterControls();

  activeAreaBounds = createMapAreaBounds(map.getBounds());
  applySearchFilter();

  const keysToSelect = getVisibleRouteKeys();
  if (keysToSelect.length === 0) {
    areaSelectionInProgress = false;
    updateAreaFilterControls();
    updateStatus();
    return;
  }

  try {
    await setRouteKeysSelected([...selectedRouteKeys], false, {
      concurrency: 8,
      refreshUiAtEnd: false,
      statusText: "Clearing existing routes...",
    });

    await setRouteKeysSelected(keysToSelect, true, {
      concurrency: 6,
      refreshUiAtEnd: false,
      statusText: `Loading ${keysToSelect.length} route(s) in this area...`,
    });
  } finally {
    areaSelectionInProgress = false;
    updateAreaFilterControls();
    applySearchFilter();
    updateStatus();
  }
}

async function clearAreaFilter() {
  if (areaSelectionInProgress) return;
  areaSelectionInProgress = true;
  updateAreaFilterControls();

  activeAreaBounds = null;

  try {
    await setRouteKeysSelected([...selectedRouteKeys], false, {
      concurrency: 8,
      refreshUiAtEnd: false,
      statusText: "Clearing selected routes...",
    });
  } finally {
    areaSelectionInProgress = false;
    updateAreaFilterControls();
    applySearchFilter();
    updateStatus();
  }
}

function updateAreaFilterControls() {
  const areaFilterActive = Boolean(activeAreaBounds);

  if (searchAreaButton) {
    searchAreaButton.disabled = areaSelectionInProgress;
    searchAreaButton.textContent = areaFilterActive ? "Search this area again" : "Search this area";
  }

  if (clearAreaButton) {
    clearAreaButton.disabled = areaSelectionInProgress;
    clearAreaButton.classList.toggle("is-hidden", !areaFilterActive && !areaSelectionInProgress);
  }
}

function createMapAreaBounds(bounds) {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

function routeIntersectsArea(routeBounds, areaBounds) {
  if (!routeBounds) return false;

  const [[south, west], [north, east]] = routeBounds;
  return (
    north >= areaBounds.south &&
    south <= areaBounds.north &&
    east >= areaBounds.west &&
    west <= areaBounds.east
  );
}

function applySearchFilter() {
  const areaBounds = activeAreaBounds;

  for (const state of routeStateByKey.values()) {
    const haystack = state.meta.searchText || "";
    const matchesSearch = !activeSearchTerm || haystack.includes(activeSearchTerm);
    const matchesArea = !areaBounds || routeIntersectsArea(state.meta.bounds, areaBounds);
    const matches = matchesSearch && matchesArea;

    state.isVisible = matches;
    state.row.style.display = matches ? "" : "none";
  }

  for (const agencyState of agencyStateById.values()) {
    const total = agencyState.routeKeys.length;
    let visible = 0;
    let selected = 0;

    for (const key of agencyState.routeKeys) {
      const state = routeStateByKey.get(key);
      if (!state) continue;
      if (state.isVisible) visible += 1;
      if (state.selected) selected += 1;
    }

    if (agencyState.countNode) {
      agencyState.countNode.textContent = `${selected} selected / ${visible} visible / ${total} total`;
    }
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
    applySearchFilter();
    updateStatus();
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

function fitToSelectedRoutes() {
  const bounds = L.latLngBounds([]);

  for (const key of selectedRouteKeys) {
    const state = routeStateByKey.get(key);
    if (!state?.meta?.bounds) continue;

    const [[south, west], [north, east]] = state.meta.bounds;
    bounds.extend([south, west]);
    bounds.extend([north, east]);
  }

  if (bounds.isValid()) {
    map.fitBounds(bounds, {
      padding: [32, 32],
      animate: true,
      duration: 0.5,
    });
  }
}

function updateStatus() {
  const selectedCount = selectedRouteKeys.size;
  const visibleCount = getVisibleRouteKeys().length;

  if (selectedCount === 0) {
    const scopeLabel = activeAreaBounds ? "in searched map area" : "in filter";
    statusNode.textContent = `No routes selected. ${visibleCount} route(s) currently visible ${scopeLabel}.`;
    return;
  }

  const byAgency = new Map();
  for (const key of selectedRouteKeys) {
    const state = routeStateByKey.get(key);
    if (!state) continue;
    const label = state.meta.agencyLabel;
    byAgency.set(label, (byAgency.get(label) ?? 0) + 1);
  }

  const agencyText = [...byAgency.entries()]
    .map(([label, count]) => `${label}: ${count}`)
    .join(" | ");

  const filters = [];
  if (activeSearchTerm) filters.push(`Search: "${activeSearchTerm}"`);
  if (activeAreaBounds) filters.push("Area filter: on");

  const filterText = filters.length ? ` | ${filters.join(" | ")}` : "";
  statusNode.textContent = `Selected ${selectedCount} route(s)${filterText} | ${agencyText}`;
}

function renderSourceDetails(sources) {
  sourceDetailsNode.innerHTML = "";

  for (const source of sources) {
    const wrapper = document.createElement("div");
    wrapper.className = "source-item";

    const updatedAt = source.feedUpdatedAt
      ? new Date(source.feedUpdatedAt).toLocaleString()
      : "Unknown";

    wrapper.innerHTML = `
      <p><strong>${escapeHtml(source.agencyLabel)}</strong></p>
      <p>${escapeHtml(source.description || "")}</p>
      <p><a href="${escapeHtml(source.gtfsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(source.gtfsUrl)}</a></p>
      <p>Feed updated: ${escapeHtml(updatedAt)}</p>
    `;

    sourceDetailsNode.appendChild(wrapper);
  }
}
