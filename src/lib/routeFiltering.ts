import type { AreaBounds, RouteBounds, RouteState, AgencyState } from "@/types";

export function createMapAreaBounds(bounds: L.LatLngBounds): AreaBounds {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

export function getVisibleRouteKeys(routeStateByKey: Map<string, RouteState>): string[] {
  const visibleKeys: string[] = [];
  for (const [key, state] of routeStateByKey) {
    if (state.isVisible) {
      visibleKeys.push(key);
    }
  }
  return visibleKeys;
}

function routeIntersectsArea(routeBounds: RouteBounds | undefined, areaBounds: AreaBounds): boolean {
  if (!routeBounds) return false;

  const [[south, west], [north, east]] = routeBounds;
  return (
    north >= areaBounds.south &&
    south <= areaBounds.north &&
    east >= areaBounds.west &&
    west <= areaBounds.east
  );
}

export interface ApplyRouteFiltersParams {
  routeStateByKey: Map<string, RouteState>;
  agencyStateById: Map<string, AgencyState>;
  searchTerm: string;
  areaBounds: AreaBounds | null;
}

export interface FilterResult {
  visibleCount: number;
  agencyCounts: Map<string, { selected: number; visible: number; total: number }>;
  routeVisibility: Map<string, boolean>;
}

export function applyRouteFilters({
  routeStateByKey,
  agencyStateById,
  searchTerm,
  areaBounds,
}: ApplyRouteFiltersParams): FilterResult {
  const routeVisibility = new Map<string, boolean>();

  for (const [key, state] of routeStateByKey) {
    const haystack = state.meta.searchText || "";
    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    const matchesArea = !areaBounds || routeIntersectsArea(state.meta.bounds, areaBounds);
    const matches = matchesSearch && matchesArea;
    state.isVisible = matches;
    routeVisibility.set(key, matches);
  }

  const agencyCounts = new Map<string, { selected: number; visible: number; total: number }>();

  for (const [agencyId, agencyState] of agencyStateById) {
    const totalCount = agencyState.routeKeys.length;
    let visibleCount = 0;
    let selectedCount = 0;

    for (const key of agencyState.routeKeys) {
      const routeState = routeStateByKey.get(key);
      if (!routeState) continue;
      if (routeState.isVisible) visibleCount += 1;
      if (routeState.selected) selectedCount += 1;
    }

    agencyCounts.set(agencyId, { selected: selectedCount, visible: visibleCount, total: totalCount });
  }

  let totalVisible = 0;
  for (const v of routeVisibility.values()) {
    if (v) totalVisible++;
  }

  return { visibleCount: totalVisible, agencyCounts, routeVisibility };
}
