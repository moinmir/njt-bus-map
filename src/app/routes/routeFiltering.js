export function createMapAreaBounds(bounds) {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

export function getVisibleRouteKeys(routeStateByKey) {
  const visibleKeys = [];
  for (const [key, state] of routeStateByKey) {
    if (state.isVisible) {
      visibleKeys.push(key);
    }
  }
  return visibleKeys;
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

export function applyRouteFilters({
  routeStateByKey,
  agencyStateById,
  searchTerm,
  areaBounds,
}) {
  for (const state of routeStateByKey.values()) {
    const haystack = state.meta.searchText || "";
    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    const matchesArea = !areaBounds || routeIntersectsArea(state.meta.bounds, areaBounds);
    const matches = matchesSearch && matchesArea;

    state.isVisible = matches;
    state.row.style.display = matches ? "" : "none";
  }

  for (const agencyState of agencyStateById.values()) {
    const totalCount = agencyState.routeKeys.length;
    let visibleCount = 0;
    let selectedCount = 0;

    for (const key of agencyState.routeKeys) {
      const routeState = routeStateByKey.get(key);
      if (!routeState) continue;
      if (routeState.isVisible) visibleCount += 1;
      if (routeState.selected) selectedCount += 1;
    }

    if (agencyState.countNode) {
      agencyState.countNode.textContent =
        `${selectedCount} selected / ${visibleCount} visible / ${totalCount} total`;
    }
  }
}

export function updateAreaFilterControls({
  searchAreaButton,
  clearAreaButton,
  areaSelectionInProgress,
  activeAreaBounds,
}) {
  const areaFilterActive = Boolean(activeAreaBounds);

  searchAreaButton.disabled = areaSelectionInProgress;
  searchAreaButton.textContent = areaFilterActive ? "Search this area again" : "Search this area";

  clearAreaButton.disabled = areaSelectionInProgress;
  clearAreaButton.classList.toggle("is-hidden", !areaFilterActive && !areaSelectionInProgress);
}
