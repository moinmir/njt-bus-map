const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_LABELS = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const JS_DAY_TO_KEY = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const POPUP_CLOSE_DELAY_MS = 240;
const MOBILE_LAYOUT_QUERY = "(max-width: 1020px)";
const HOVER_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const mobileLayoutMediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);

const map = L.map("map", {
  preferCanvas: true,
  zoomControl: false,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  minZoom: 8,
});

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
}).addTo(map);

map.setView([40.258, -74.66], 10.5);

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

let manifestData = null;
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
  const response = await fetch("./data/manifest.json");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading manifest`);
  }

  manifestData = await response.json();

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

  selectVisibleButton.addEventListener("click", async () => {
    const keys = getVisibleRouteKeys();
    for (const key of keys) {
      await setRouteSelection(key, true);
    }
    updateStatus();
  });

  clearSelectedButton.addEventListener("click", () => {
    for (const key of [...selectedRouteKeys]) {
      void setRouteSelection(key, false);
    }
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
      navigator.serviceWorker.register("./sw.js").catch((error) => {
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
      for (const key of agencyState.routeKeys) {
        const state = routeStateByKey.get(key);
        if (state?.selected) {
          void setRouteSelection(key, false);
        }
      }
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
  for (const key of agencyState.routeKeys) {
    const state = routeStateByKey.get(key);
    if (!state || !state.isVisible) continue;
    await setRouteSelection(key, true);
  }
  updateStatus();
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

  statusNode.textContent = `Loading ${keysToSelect.length} route(s) in this area...`;

  try {
    for (const key of [...selectedRouteKeys]) {
      await setRouteSelection(key, false, { refreshUi: false });
    }

    for (const key of keysToSelect) {
      await setRouteSelection(key, true, { refreshUi: false });
    }
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
    for (const key of [...selectedRouteKeys]) {
      await setRouteSelection(key, false, { refreshUi: false });
    }
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
  if (state.layer) return;
  if (state.loadPromise) {
    await state.loadPromise;
    return;
  }

  state.row.classList.add("is-loading");
  state.loadPromise = (async () => {
    const response = await fetch(`./data/${state.meta.file}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const routeData = await response.json();
    state.routeData = routeData;
    state.layer = buildRouteLayer(state, routeData);
  })();

  try {
    await state.loadPromise;
  } finally {
    state.loadPromise = null;
    state.row.classList.remove("is-loading");
  }
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

    attachInteractivePopup(marker, () => buildStopPopup(state, stop));
    marker.addTo(group);
  }

  return group;
}

function attachInteractivePopup(marker, contentFactory) {
  let closeTimer = null;
  let popupRequestToken = 0;
  const hoverCapable = window.matchMedia(HOVER_POINTER_QUERY).matches;

  const clearCloseTimer = () => {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer = window.setTimeout(() => {
      marker.closePopup();
    }, POPUP_CLOSE_DELAY_MS);
  };

  const openPopup = () => {
    clearCloseTimer();
    const token = ++popupRequestToken;
    marker.setPopupContent(
      '<div class="popup-shell"><div class="next-bar">Loading stop schedule...</div></div>',
    );
    marker.openPopup();
    Promise.resolve(contentFactory())
      .then((content) => {
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(content);
      })
      .catch((error) => {
        console.error(error);
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(
          '<div class="popup-shell"><div class="next-bar">Unable to load stop schedule right now.</div></div>',
        );
      });
  };

  if (hoverCapable) {
    marker.on("mouseover", openPopup);
    marker.on("mouseout", scheduleClose);
  }
  marker.on("click", openPopup);

  marker.on("popupopen", () => {
    const popupElement = marker.getPopup()?.getElement();
    if (!popupElement) return;

    L.DomEvent.disableClickPropagation(popupElement);
    L.DomEvent.disableScrollPropagation(popupElement);

    if (popupElement.dataset.boundInteractive === "1") {
      return;
    }
    popupElement.dataset.boundInteractive = "1";

    popupElement.addEventListener("mouseenter", clearCloseTimer);
    popupElement.addEventListener("mouseleave", scheduleClose);
  });

  marker.on("remove", clearCloseTimer);
}

async function buildStopPopup(state, stop) {
  const routeMeta = state.meta;
  const routeData = state.routeData;
  const scheduleData = await ensureRouteScheduleLoaded(state);
  const daySchedules = computeDaySchedules(routeData, stop, scheduleData);
  const representativeDates = scheduleData?.representativeDates ?? routeData.representativeDates;
  const hasScheduleData = DAY_KEYS.some((dayKey) => (daySchedules[dayKey] ?? []).length > 0);

  if (!hasScheduleData) {
    return `
      <div class="popup-shell">
        <div class="popup-head">
          <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
          <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
        </div>
        <div class="next-bar">No stop-level schedule data is currently available for this stop.</div>
      </div>
    `;
  }

  const next = findNextArrival(daySchedules);
  const upcoming = findUpcomingArrivals(daySchedules, 3);

  const defaultOpenDay = next?.dayKey ?? JS_DAY_TO_KEY[new Date().getDay()];

  const dayBlocks = DAY_KEYS.map((dayKey) => {
    const times = daySchedules[dayKey] ?? [];
    const representativeDate = representativeDates?.[dayKey];
    const openAttr = dayKey === defaultOpenDay ? " open" : "";

    let bodyHtml = '<div class="no-service">No service</div>';
    if (times.length > 0) {
      const chips = times
        .map((rawTime) => {
          const token = `${dayKey}:${rawTime}`;
          const label = formatGtfsTime(rawTime);
          if (next?.token === token) {
            return `<strong class="next-chip">${label}</strong>`;
          }
          return `<span class="time-chip">${label}</span>`;
        })
        .join("");
      bodyHtml = `<div class="times-grid">${chips}</div>`;
    }

    const dayDate = representativeDate
      ? `<span class="day-date">${formatDateShort(representativeDate)}</span>`
      : "";

    const countLabel = times.length > 0 ? `${times.length} departures` : "No service";

    return `
      <details class="day-item"${openAttr}>
        <summary>
          <span class="day-left"><span class="day-label">${DAY_LABELS[dayKey]}</span>${dayDate}</span>
          <span class="day-count">${countLabel}</span>
        </summary>
        <div class="day-body">${bodyHtml}</div>
      </details>
    `;
  }).join("");

  const nextBar = upcoming.length
    ? `<strong>${upcoming[0]}</strong>${upcoming.length > 1 ? ` • ${upcoming.slice(1).join(" • ")}` : ""}`
    : "No upcoming departure in this representative week.";

  return `
    <div class="popup-shell">
      <div class="popup-head">
        <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
        <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
      </div>
      <div class="next-bar">Next: ${nextBar}</div>
      <div class="day-list">${dayBlocks}</div>
    </div>
  `;
}

async function ensureRouteScheduleLoaded(state) {
  if (state.routeData?.activeServicesByDay) {
    return null;
  }

  if (state.scheduleData) {
    return state.scheduleData;
  }

  const scheduleFile = state.routeData?.scheduleFile;
  if (!scheduleFile) {
    return null;
  }

  if (state.scheduleLoadPromise) {
    await state.scheduleLoadPromise;
    return state.scheduleData;
  }

  state.scheduleLoadPromise = (async () => {
    const response = await fetch(`./data/${scheduleFile}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.scheduleData = await response.json();
  })();

  try {
    await state.scheduleLoadPromise;
  } finally {
    state.scheduleLoadPromise = null;
  }

  return state.scheduleData;
}

function computeDaySchedules(routeData, stop, scheduleData = null) {
  const externalByStop = scheduleData?.daySchedulesByStop?.[stop.stopId];
  if (externalByStop) {
    return externalByStop;
  }

  if (stop._daySchedules) {
    return stop._daySchedules;
  }

  const byDay = {};
  for (const dayKey of DAY_KEYS) {
    const serviceIds = routeData.activeServicesByDay?.[dayKey] ?? [];
    const merged = new Set();

    for (const serviceId of serviceIds) {
      const times = stop.serviceSchedule?.[serviceId] ?? [];
      for (const value of times) {
        merged.add(value);
      }
    }

    byDay[dayKey] = [...merged].sort((a, b) => parseGtfsSeconds(a) - parseGtfsSeconds(b));
  }

  stop._daySchedules = byDay;
  return byDay;
}

function findNextArrival(daySchedules) {
  const now = new Date();
  let best = null;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayKey = JS_DAY_TO_KEY[baseDate.getDay()];
    const times = daySchedules[dayKey] ?? [];

    for (const rawTime of times) {
      const totalSeconds = parseGtfsSeconds(rawTime);
      if (Number.isNaN(totalSeconds)) continue;

      const extraDays = Math.floor(totalSeconds / 86400);
      const secondOfDay = totalSeconds % 86400;
      const candidate = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + extraDays,
        Math.floor(secondOfDay / 3600),
        Math.floor((secondOfDay % 3600) / 60),
        secondOfDay % 60,
      );

      if (candidate < now) continue;
      if (!best || candidate < best.when) {
        best = {
          when: candidate,
          token: `${dayKey}:${rawTime}`,
          dayKey,
          rawTime,
        };
      }
    }
  }

  return best;
}

function findUpcomingArrivals(daySchedules, maxCount) {
  const now = new Date();
  const candidates = [];

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayKey = JS_DAY_TO_KEY[baseDate.getDay()];
    const times = daySchedules[dayKey] ?? [];

    for (const rawTime of times) {
      const totalSeconds = parseGtfsSeconds(rawTime);
      if (Number.isNaN(totalSeconds)) continue;

      const extraDays = Math.floor(totalSeconds / 86400);
      const secondOfDay = totalSeconds % 86400;
      const candidate = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + extraDays,
        Math.floor(secondOfDay / 3600),
        Math.floor((secondOfDay % 3600) / 60),
        secondOfDay % 60,
      );

      if (candidate < now) continue;
      candidates.push({ candidate, dayKey, rawTime });
    }
  }

  candidates.sort((a, b) => a.candidate - b.candidate);

  return candidates.slice(0, maxCount).map((entry) => {
    const dayLabel = DAY_LABELS[entry.dayKey];
    return `${dayLabel} ${formatGtfsTime(entry.rawTime)}`;
  });
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

function parseGtfsSeconds(rawTime) {
  const [h, m, s] = rawTime.split(":").map((segment) => Number.parseInt(segment, 10));
  if ([h, m, s].some(Number.isNaN)) return Number.NaN;
  return h * 3600 + m * 60 + s;
}

function formatGtfsTime(rawTime) {
  const totalSeconds = parseGtfsSeconds(rawTime);
  if (Number.isNaN(totalSeconds)) return rawTime;

  const overflowDays = Math.floor(totalSeconds / 86400);
  const secondOfDay = totalSeconds % 86400;
  const hours24 = Math.floor(secondOfDay / 3600);
  const minutes = Math.floor((secondOfDay % 3600) / 60);

  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const base = `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;

  if (overflowDays > 0) {
    return `${base} (+${overflowDays})`;
  }
  return base;
}

function formatDateShort(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
