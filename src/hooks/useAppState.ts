import { useCallback, useRef, useSyncExternalStore } from "react";
import L from "leaflet";
import type {
  AppState,
  AgencyState,
  RouteSelectionManager,
  Manifest,
  RouteMeta,
} from "@/types";
import { MOBILE_LAYOUT_QUERY } from "@/lib/constants";
import { createRouteSelectionManager } from "@/lib/routeSelectionManager";
import { applyRouteFilters, getVisibleRouteKeys, createMapAreaBounds } from "@/lib/routeFiltering";
import { loadManifest } from "@/lib/transitDataClient";
import { resolveAreaRouteKeys } from "@/lib/resolveAreaRouteKeys";

type Listener = () => void;

interface Store {
  state: AppState;
  listeners: Set<Listener>;
  notify: () => void;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => AppState;
}

function createStore(): Store {
  const mobileLayoutMediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);

  const state: AppState = {
    routeStateByKey: new Map(),
    agencyStateById: new Map(),
    selectedRouteKeys: new Set(),
    activeSearchTerm: "",
    activeAreaBounds: null,
    userLocationLayer: null,
    mobilePanelCollapsed: mobileLayoutMediaQuery.matches,
    areaSelectionInProgress: false,
  };

  const listeners = new Set<Listener>();

  // useSyncExternalStore compares snapshots via Object.is.
  // We mutate `state` in-place, so we produce a new shallow copy on
  // every notify() so React sees a different reference and re-renders.
  let snapshot: AppState = { ...state };

  const notify = () => {
    snapshot = { ...state };
    for (const l of listeners) l();
  };

  return {
    state,
    listeners,
    notify,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

export interface AppActions {
  init: (map: L.Map) => Promise<Manifest>;
  setSearchTerm: (term: string) => void;
  toggleRoute: (routeKey: string, selected: boolean) => void;
  clearAllRoutes: () => void;
  fitSelectedRoutes: (map: L.Map) => void;
  locateUser: (map: L.Map, options?: { onLocated?: () => void }) => void;
  applyAreaFilter: (map: L.Map) => void;
  clearAreaFilter: () => void;
  togglePanel: () => void;
  setAgencySelected: (agencyId: string, selected: boolean) => void;
  getFilterResult: () => ReturnType<typeof applyRouteFilters>;
}

export function useAppState(): [AppState, AppActions] {
  const storeRef = useRef<Store | null>(null);
  const managerRef = useRef<RouteSelectionManager | null>(null);
  const manifestRef = useRef<Manifest | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  if (storeRef.current === null) {
    storeRef.current = createStore();
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const refreshFilters = useCallback(() => {
    const s = store.state;
    applyRouteFilters({
      routeStateByKey: s.routeStateByKey,
      agencyStateById: s.agencyStateById,
      searchTerm: s.activeSearchTerm,
      areaBounds: s.activeAreaBounds,
    });
    store.notify();
  }, [store]);

  const actions = useRef<AppActions>({
    init: async (map: L.Map) => {
      mapRef.current = map;
      const manifest = await loadManifest();
      manifestRef.current = manifest;
      const s = store.state;

      const agencies = manifest.agencies ?? [];
      const routes = manifest.routes ?? [];
      const routesByAgency = new Map<string, RouteMeta[]>();

      for (const agency of agencies) {
        routesByAgency.set(agency.id, []);
      }

      for (const route of routes) {
        if (!routesByAgency.has(route.agencyId)) {
          routesByAgency.set(route.agencyId, []);
        }
        routesByAgency.get(route.agencyId)!.push(route);
      }

      for (const agency of agencies) {
        const agencyRoutes = (routesByAgency.get(agency.id) ?? []).sort((a, b) =>
          a.shortName.localeCompare(b.shortName, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );

        const agencyState: AgencyState = {
          agency,
          routeKeys: [],
        };
        s.agencyStateById.set(agency.id, agencyState);

        for (const route of agencyRoutes) {
          agencyState.routeKeys.push(route.key);
          s.routeStateByKey.set(route.key, {
            meta: route,
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

      managerRef.current = createRouteSelectionManager({
        map,
        routeStateByKey: s.routeStateByKey,
        selectedRouteKeys: s.selectedRouteKeys,
        onStatusUpdate: () => store.notify(),
        onUiRefresh: () => {
          refreshFilters();
        },
      });

      refreshFilters();
      return manifest;
    },

    setSearchTerm: (term: string) => {
      store.state.activeSearchTerm = term.trim().toLowerCase();
      refreshFilters();
    },

    toggleRoute: (routeKey: string, selected: boolean) => {
      if (managerRef.current) {
        void managerRef.current.setRouteSelection(routeKey, selected);
      }
    },

    clearAllRoutes: () => {
      if (managerRef.current) {
        void managerRef.current.setRouteKeysSelected(
          [...store.state.selectedRouteKeys],
          false,
        );
      }
    },

    fitSelectedRoutes: (map: L.Map) => {
      const bounds = L.latLngBounds([]);

      for (const key of store.state.selectedRouteKeys) {
        const rs = store.state.routeStateByKey.get(key);
        if (!rs?.meta?.bounds) continue;
        const [[south, west], [north, east]] = rs.meta.bounds;
        bounds.extend([south, west]);
        bounds.extend([north, east]);
      }

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [32, 32], animate: true, duration: 0.5 });
      }
    },

    locateUser: (map: L.Map, options) => {
      if (!("geolocation" in navigator)) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          const latLng: L.LatLngExpression = [latitude, longitude];

          let didInvokeOnLocated = false;
          const invokeOnLocated = () => {
            if (didInvokeOnLocated) return;
            didInvokeOnLocated = true;
            options?.onLocated?.();
          };

          map.once("moveend", invokeOnLocated);
          window.setTimeout(invokeOnLocated, 1200);

          map.flyTo(latLng, 13, { animate: true, duration: 0.6 });

          if (store.state.userLocationLayer && map.hasLayer(store.state.userLocationLayer)) {
            map.removeLayer(store.state.userLocationLayer);
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

          store.state.userLocationLayer = L.layerGroup([accuracyRing, marker]).addTo(map);
          store.notify();
        },
        () => {
          store.notify();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    },

    applyAreaFilter: (map: L.Map) => {
      if (store.state.areaSelectionInProgress) return;

      const s = store.state;
      s.areaSelectionInProgress = true;
      store.notify();

      const areaBounds = createMapAreaBounds(map.getBounds());
      s.activeAreaBounds = areaBounds;
      refreshFilters();

      const candidateKeys = getVisibleRouteKeys(s.routeStateByKey);

      const doWork = async () => {
        try {
          await managerRef.current?.setRouteKeysSelected(
            [...s.selectedRouteKeys],
            false,
            { concurrency: 8, refreshUiAtEnd: false, statusText: "Clearing existing routes..." },
          );

          if (candidateKeys.length === 0) return;

          const keysToSelect = await resolveAreaRouteKeys({
            routeKeys: candidateKeys,
            routeStateByKey: s.routeStateByKey,
            areaBounds,
            concurrency: 8,
          });

          if (keysToSelect.length === 0) return;

          await managerRef.current?.setRouteKeysSelected(keysToSelect, true, {
            concurrency: 6,
            refreshUiAtEnd: false,
            statusText: `Loading ${keysToSelect.length} route(s) in this area...`,
          });
        } finally {
          s.areaSelectionInProgress = false;
          refreshFilters();
        }
      };

      void doWork();
    },

    clearAreaFilter: () => {
      if (store.state.areaSelectionInProgress) return;

      const s = store.state;
      s.areaSelectionInProgress = true;
      store.notify();

      s.activeAreaBounds = null;

      const doWork = async () => {
        try {
          await managerRef.current?.setRouteKeysSelected(
            [...s.selectedRouteKeys],
            false,
            { concurrency: 8, refreshUiAtEnd: false, statusText: "Clearing selected routes..." },
          );
        } finally {
          s.areaSelectionInProgress = false;
          refreshFilters();
        }
      };

      void doWork();
    },

    togglePanel: () => {
      store.state.mobilePanelCollapsed = !store.state.mobilePanelCollapsed;
      store.notify();
      if (mapRef.current) {
        window.setTimeout(() => mapRef.current?.invalidateSize(), 200);
      }
    },

    setAgencySelected: (agencyId: string, selected: boolean) => {
      const agencyState = store.state.agencyStateById.get(agencyId);
      if (!agencyState || !managerRef.current) return;
      const keysToUpdate = agencyState.routeKeys.filter((key) => {
        const routeState = store.state.routeStateByKey.get(key);
        if (!routeState) return false;
        return routeState.selected !== selected;
      });
      void managerRef.current.setRouteKeysSelected(
        keysToUpdate,
        selected,
      );
    },

    getFilterResult: () => {
      return applyRouteFilters({
        routeStateByKey: store.state.routeStateByKey,
        agencyStateById: store.state.agencyStateById,
        searchTerm: store.state.activeSearchTerm,
        areaBounds: store.state.activeAreaBounds,
      });
    },
  }).current;

  return [state, actions];
}
