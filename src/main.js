import { configureMobilePanel } from "./app/configureMobilePanel.js";
import { fitToSelectedRoutes } from "./app/fitToSelectedRoutes.js";
import { getDomNodes } from "./app/getDomNodes.js";
import { locateUser } from "./app/locateUser.js";
import { registerServiceWorker } from "./app/registerServiceWorker.js";
import { updateStatusLine } from "./app/updateStatusLine.js";
import { buildRouteControls, renderSourceDetails } from "./app/routes/buildRouteControls.js";
import { createRouteSelectionManager } from "./app/routes/createRouteSelectionManager.js";
import {
  applyRouteFilters,
  createMapAreaBounds,
  getVisibleRouteKeys,
  updateAreaFilterControls,
} from "./app/routes/routeFiltering.js";
import { MOBILE_LAYOUT_QUERY } from "./config/constants.js";
import { loadManifest } from "./data/transitDataClient.js";
import { createBaseMap } from "./map/createBaseMap.js";

const dom = getDomNodes();
const map = createBaseMap();
const mobileLayoutMediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);

const appState = {
  routeStateByKey: new Map(),
  agencyStateById: new Map(),
  selectedRouteKeys: new Set(),
  activeSearchTerm: "",
  activeAreaBounds: null,
  userLocationLayer: null,
  mobilePanelCollapsed: mobileLayoutMediaQuery.matches,
  areaSelectionInProgress: false,
};

const routeSelectionManager = createRouteSelectionManager({
  map,
  routeStateByKey: appState.routeStateByKey,
  selectedRouteKeys: appState.selectedRouteKeys,
  statusNode: dom.statusNode,
  onUiRefresh: refreshUi,
});

init().catch((error) => {
  console.error(error);
  dom.statusNode.textContent = `Failed to load data: ${error.message}`;
});

async function init() {
  const manifestData = await loadManifest();

  buildRouteControls({
    manifest: manifestData,
    routeGroupsNode: dom.routeGroupsNode,
    routeStateByKey: appState.routeStateByKey,
    agencyStateById: appState.agencyStateById,
    onRouteCheckboxChange: (routeKey, selected) => {
      void routeSelectionManager.setRouteSelection(routeKey, selected);
    },
    onAgencyAction: ({ action, agencyId }) => {
      void handleAgencyAction(action, agencyId);
    },
  });

  renderSourceDetails(dom.sourceDetailsNode, manifestData.sources ?? []);
  attachTopLevelEvents();
  configureMobilePanel({
    map,
    mediaQuery: mobileLayoutMediaQuery,
    panelNode: dom.panelNode,
    panelToggleButton: dom.panelToggleButton,
    appState,
  });
  registerServiceWorker();
  syncAreaFilterControls();
  refreshUi();
}

function attachTopLevelEvents() {
  dom.routeSearchNode.addEventListener("input", () => {
    appState.activeSearchTerm = dom.routeSearchNode.value.trim().toLowerCase();
    refreshUi();
  });

  dom.fitButton.addEventListener("click", () => {
    fitToSelectedRoutes(map, appState.selectedRouteKeys, appState.routeStateByKey);
  });

  dom.locateMeButton.addEventListener("click", () => {
    locateUser({ map, statusNode: dom.statusNode, appState });
  });

  dom.searchAreaButton.addEventListener("click", () => {
    void applyCurrentMapAreaFilter();
  });

  dom.clearAreaButton.addEventListener("click", () => {
    void clearAreaFilter();
  });

  dom.selectVisibleButton.addEventListener("click", () => {
    void routeSelectionManager.setRouteKeysSelected(getVisibleRouteKeys(appState.routeStateByKey), true, {
      statusText: "Loading visible routes...",
    });
  });

  dom.clearSelectedButton.addEventListener("click", () => {
    void routeSelectionManager.setRouteKeysSelected([...appState.selectedRouteKeys], false);
  });
}

async function handleAgencyAction(action, agencyId) {
  const agencyState = appState.agencyStateById.get(agencyId);
  if (!agencyState) return;

  if (action === "select-visible") {
    const keys = agencyState.routeKeys.filter((key) => appState.routeStateByKey.get(key)?.isVisible);
    await routeSelectionManager.setRouteKeysSelected(keys, true);
    return;
  }

  if (action === "clear-agency") {
    const selectedInAgency = agencyState.routeKeys.filter(
      (key) => appState.routeStateByKey.get(key)?.selected,
    );
    await routeSelectionManager.setRouteKeysSelected(selectedInAgency, false);
  }
}

function refreshUi() {
  applyRouteFilters({
    routeStateByKey: appState.routeStateByKey,
    agencyStateById: appState.agencyStateById,
    searchTerm: appState.activeSearchTerm,
    areaBounds: appState.activeAreaBounds,
  });

  const visibleCount = getVisibleRouteKeys(appState.routeStateByKey).length;
  updateStatusLine({
    statusNode: dom.statusNode,
    selectedRouteKeys: appState.selectedRouteKeys,
    routeStateByKey: appState.routeStateByKey,
    activeAreaBounds: appState.activeAreaBounds,
    activeSearchTerm: appState.activeSearchTerm,
    visibleCount,
  });
}

function syncAreaFilterControls() {
  updateAreaFilterControls({
    searchAreaButton: dom.searchAreaButton,
    clearAreaButton: dom.clearAreaButton,
    areaSelectionInProgress: appState.areaSelectionInProgress,
    activeAreaBounds: appState.activeAreaBounds,
  });
}

async function applyCurrentMapAreaFilter() {
  if (appState.areaSelectionInProgress) return;

  appState.areaSelectionInProgress = true;
  syncAreaFilterControls();

  appState.activeAreaBounds = createMapAreaBounds(map.getBounds());
  refreshUi();

  const keysToSelect = getVisibleRouteKeys(appState.routeStateByKey);

  try {
    if (keysToSelect.length === 0) {
      return;
    }

    await routeSelectionManager.setRouteKeysSelected([...appState.selectedRouteKeys], false, {
      concurrency: 8,
      refreshUiAtEnd: false,
      statusText: "Clearing existing routes...",
    });

    await routeSelectionManager.setRouteKeysSelected(keysToSelect, true, {
      concurrency: 6,
      refreshUiAtEnd: false,
      statusText: `Loading ${keysToSelect.length} route(s) in this area...`,
    });
  } finally {
    appState.areaSelectionInProgress = false;
    syncAreaFilterControls();
    refreshUi();
  }
}

async function clearAreaFilter() {
  if (appState.areaSelectionInProgress) return;

  appState.areaSelectionInProgress = true;
  syncAreaFilterControls();

  appState.activeAreaBounds = null;

  try {
    await routeSelectionManager.setRouteKeysSelected([...appState.selectedRouteKeys], false, {
      concurrency: 8,
      refreshUiAtEnd: false,
      statusText: "Clearing selected routes...",
    });
  } finally {
    appState.areaSelectionInProgress = false;
    syncAreaFilterControls();
    refreshUi();
  }
}
