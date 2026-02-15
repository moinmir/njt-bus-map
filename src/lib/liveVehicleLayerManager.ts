import L from "leaflet";
import type { RouteState } from "@/types";
import { MAP_PANES } from "@/lib/mapPanes";
import {
  loadLiveVehicles,
  type LiveVehicle,
  type LiveVehiclesSourceStatus,
} from "@/lib/liveVehiclesClient";

interface LiveVehicleLayerManagerDeps {
  map: L.Map;
  routeStateByKey: Map<string, RouteState>;
}

export interface LiveVehicleLayerManager {
  setSelectedRouteKeys: (routeKeys: Iterable<string>) => void;
  destroy: () => void;
}

interface VehicleLayerState {
  vehicle: LiveVehicle;
  marker: L.CircleMarker;
  headingLine: L.Polyline | null;
  animationFrame: number | null;
}

const LIVE_POLL_INTERVAL_MS = 15_000;
const LIVE_MOVE_ANIMATION_MS = 900;
const HEADING_LINE_PIXELS = 16;
const VEHICLE_RADIUS = 6.4;

const FALLBACK_COLOR_BY_AGENCY: Record<LiveVehicle["agencyId"], string> = {
  njt: "#0f5ea8",
  princeton: "#e7721b",
};

function normalizeBearing(value: number | null): number | null {
  if (value === null) return null;
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : null;
}

function interpolateBearing(
  startBearing: number | null,
  endBearing: number | null,
  progress: number,
): number | null {
  if (startBearing === null && endBearing === null) return null;
  if (startBearing === null) return progress < 1 ? null : endBearing;
  if (endBearing === null) return progress < 1 ? startBearing : null;

  const delta = ((((endBearing - startBearing) % 360) + 540) % 360) - 180;
  return normalizeBearing(startBearing + delta * progress);
}

function isRealtimeRouteKey(routeKey: string): boolean {
  return routeKey.startsWith("princeton:") || routeKey.startsWith("njt:");
}

function toRouteKeySignature(routeKeys: Iterable<string>): string {
  return [...routeKeys].sort().join("|");
}

function getVehicleColor(
  routeStateByKey: Map<string, RouteState>,
  vehicle: LiveVehicle,
): string {
  const routeState = routeStateByKey.get(vehicle.routeKey);
  return routeState?.meta?.color || FALLBACK_COLOR_BY_AGENCY[vehicle.agencyId];
}

function getVehicleTooltipText(
  routeStateByKey: Map<string, RouteState>,
  vehicle: LiveVehicle,
): string {
  const routeLabel = routeStateByKey.get(vehicle.routeKey)?.meta?.label || vehicle.routeKey;
  return `${routeLabel} • ${vehicle.label}`;
}

function getHeadingLineEnd(
  map: L.Map,
  latitude: number,
  longitude: number,
  bearing: number,
): L.LatLng {
  const startPoint = map.latLngToLayerPoint([latitude, longitude]);
  const radians = ((bearing - 90) * Math.PI) / 180;
  const endPoint = L.point(
    startPoint.x + Math.cos(radians) * HEADING_LINE_PIXELS,
    startPoint.y + Math.sin(radians) * HEADING_LINE_PIXELS,
  );
  return map.layerPointToLatLng(endPoint);
}

export function createLiveVehicleLayerManager({
  map,
  routeStateByKey,
}: LiveVehicleLayerManagerDeps): LiveVehicleLayerManager {
  const layerGroup = L.layerGroup().addTo(map);
  const layersByVehicleId = new Map<string, VehicleLayerState>();
  const sourceStatusSignatureByAgency = new Map<string, string>();

  let selectedRouteKeys = new Set<string>();
  let selectedRouteKeySignature = "";
  let pollTimer: number | null = null;
  let inFlightController: AbortController | null = null;
  let destroyed = false;

  const refreshHeadingsForMapMove = () => {
    for (const layerState of layersByVehicleId.values()) {
      const { vehicle } = layerState;
      const color = getVehicleColor(routeStateByKey, vehicle);
      applyVehicleGeometry(layerState, vehicle.latitude, vehicle.longitude, vehicle.bearing, color);
    }
  };

  map.on("zoomend", refreshHeadingsForMapMove);
  map.on("moveend", refreshHeadingsForMapMove);

  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => {
      void refreshVehicles();
    }, LIVE_POLL_INTERVAL_MS);
  }

  function cancelAnimation(layerState: VehicleLayerState): void {
    if (layerState.animationFrame !== null) {
      window.cancelAnimationFrame(layerState.animationFrame);
      layerState.animationFrame = null;
    }
  }

  function removeVehicleLayer(layerState: VehicleLayerState): void {
    cancelAnimation(layerState);
    if (layerState.headingLine) {
      layerGroup.removeLayer(layerState.headingLine);
      layerState.headingLine = null;
    }
    layerGroup.removeLayer(layerState.marker);
  }

  function clearAllLayers(): void {
    for (const layerState of layersByVehicleId.values()) {
      removeVehicleLayer(layerState);
    }
    layersByVehicleId.clear();
  }

  function applyVehicleGeometry(
    layerState: VehicleLayerState,
    latitude: number,
    longitude: number,
    bearing: number | null,
    color: string,
  ): void {
    layerState.marker.setLatLng([latitude, longitude]);
    layerState.marker.setStyle({ fillColor: color });

    if (bearing === null) {
      if (layerState.headingLine) {
        layerGroup.removeLayer(layerState.headingLine);
        layerState.headingLine = null;
      }
      return;
    }

    const headingEnd = getHeadingLineEnd(map, latitude, longitude, bearing);
    const lineLatLngs: L.LatLngExpression[] = [
      [latitude, longitude],
      [headingEnd.lat, headingEnd.lng],
    ];

    if (!layerState.headingLine) {
      layerState.headingLine = L.polyline(lineLatLngs, {
        pane: MAP_PANES.liveVehicles,
        color,
        weight: 2.2,
        opacity: 0.9,
        lineCap: "round",
      }).addTo(layerGroup);
      return;
    }

    layerState.headingLine.setStyle({ color });
    layerState.headingLine.setLatLngs(lineLatLngs);
  }

  function createVehicleLayer(vehicle: LiveVehicle): VehicleLayerState {
    const color = getVehicleColor(routeStateByKey, vehicle);

    const marker = L.circleMarker([vehicle.latitude, vehicle.longitude], {
      pane: MAP_PANES.liveVehicles,
      radius: VEHICLE_RADIUS,
      color: "#ffffff",
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.96,
    }).addTo(layerGroup);

    marker.bindTooltip(getVehicleTooltipText(routeStateByKey, vehicle), {
      direction: "top",
      offset: [0, -8],
      opacity: 0.95,
      className: "route-hover-tooltip",
    });

    const layerState: VehicleLayerState = {
      vehicle,
      marker,
      headingLine: null,
      animationFrame: null,
    };

    applyVehicleGeometry(layerState, vehicle.latitude, vehicle.longitude, vehicle.bearing, color);

    return layerState;
  }

  function animateVehicleTo(layerState: VehicleLayerState, nextVehicle: LiveVehicle): void {
    cancelAnimation(layerState);

    const startLatLng = layerState.marker.getLatLng();
    const startBearing = layerState.vehicle.bearing;
    const endBearing = nextVehicle.bearing;
    const startLat = startLatLng.lat;
    const startLon = startLatLng.lng;
    const endLat = nextVehicle.latitude;
    const endLon = nextVehicle.longitude;
    const color = getVehicleColor(routeStateByKey, nextVehicle);

    const deltaLat = endLat - startLat;
    const deltaLon = endLon - startLon;
    const shouldAnimate = Math.abs(deltaLat) > 0.000005 || Math.abs(deltaLon) > 0.000005;

    if (!shouldAnimate) {
      applyVehicleGeometry(layerState, endLat, endLon, endBearing, color);
      layerState.vehicle = nextVehicle;
      layerState.marker.setTooltipContent(getVehicleTooltipText(routeStateByKey, nextVehicle));
      return;
    }

    const animationStart = performance.now();

    const step = (now: number) => {
      const elapsed = now - animationStart;
      const progress = Math.min(1, elapsed / LIVE_MOVE_ANIMATION_MS);
      const latitude = startLat + deltaLat * progress;
      const longitude = startLon + deltaLon * progress;
      const bearing = interpolateBearing(startBearing, endBearing, progress);

      applyVehicleGeometry(layerState, latitude, longitude, bearing, color);

      if (progress < 1) {
        layerState.animationFrame = window.requestAnimationFrame(step);
        return;
      }

      layerState.animationFrame = null;
      layerState.vehicle = nextVehicle;
      layerState.marker.setTooltipContent(getVehicleTooltipText(routeStateByKey, nextVehicle));
    };

    layerState.animationFrame = window.requestAnimationFrame(step);
  }

  function syncVehicleLayers(vehicles: LiveVehicle[]): void {
    const nextById = new Map<string, LiveVehicle>();
    for (const vehicle of vehicles) {
      if (!selectedRouteKeys.has(vehicle.routeKey)) continue;
      nextById.set(vehicle.id, vehicle);
    }

    for (const [vehicleId, layerState] of layersByVehicleId.entries()) {
      if (nextById.has(vehicleId)) continue;
      removeVehicleLayer(layerState);
      layersByVehicleId.delete(vehicleId);
    }

    for (const vehicle of nextById.values()) {
      const existing = layersByVehicleId.get(vehicle.id);
      if (!existing) {
        layersByVehicleId.set(vehicle.id, createVehicleLayer(vehicle));
        continue;
      }
      animateVehicleTo(existing, vehicle);
    }
  }

  async function refreshVehicles(): Promise<void> {
    if (destroyed) return;
    if (inFlightController) return;
    if (selectedRouteKeys.size === 0) {
      clearAllLayers();
      return;
    }

    const routeKeysSnapshot = [...selectedRouteKeys];
    const signatureSnapshot = selectedRouteKeySignature;

    const controller = new AbortController();
    inFlightController = controller;

    try {
      const response = await loadLiveVehicles(routeKeysSnapshot, controller.signal);
      if (destroyed) return;
      if (signatureSnapshot !== selectedRouteKeySignature) return;
      syncSourceStatuses(response.sources);
      syncVehicleLayers(response.vehicles);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("Failed to refresh live vehicles", error);
    } finally {
      if (inFlightController === controller) {
        inFlightController = null;
      }
    }
  }

  function syncSourceStatuses(sources: LiveVehiclesSourceStatus[]): void {
    for (const source of sources) {
      const signature = `${source.status}:${source.message ?? ""}`;
      const previousSignature = sourceStatusSignatureByAgency.get(source.agencyId);
      if (previousSignature === signature) continue;
      sourceStatusSignatureByAgency.set(source.agencyId, signature);

      if (source.status === "ok" || source.status === "skipped") continue;

      const details = source.message ? ` - ${source.message}` : "";
      console.warn(`Live vehicles source ${source.agencyId}: ${source.status}${details}`);
    }
  }

  function setSelectedRouteKeysFromState(routeKeys: Iterable<string>): void {
    if (destroyed) return;

    const nextRouteKeys = new Set<string>();
    for (const routeKey of routeKeys) {
      if (!isRealtimeRouteKey(routeKey)) continue;
      nextRouteKeys.add(routeKey);
    }

    const nextSignature = toRouteKeySignature(nextRouteKeys);
    if (nextSignature === selectedRouteKeySignature) return;

    selectedRouteKeys = nextRouteKeys;
    selectedRouteKeySignature = nextSignature;

    if (selectedRouteKeys.size === 0) {
      stopPolling();
      if (inFlightController) {
        inFlightController.abort();
        inFlightController = null;
      }
      clearAllLayers();
      return;
    }

    startPolling();
    void refreshVehicles();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    stopPolling();

    if (inFlightController) {
      inFlightController.abort();
      inFlightController = null;
    }

    map.off("zoomend", refreshHeadingsForMapMove);
    map.off("moveend", refreshHeadingsForMapMove);

    clearAllLayers();
    map.removeLayer(layerGroup);
  }

  return {
    setSelectedRouteKeys: setSelectedRouteKeysFromState,
    destroy,
  };
}
