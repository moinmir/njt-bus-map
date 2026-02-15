import L from "leaflet";
import { HOVER_POINTER_QUERY, POPUP_CLOSE_DELAY_MS } from "./constants";
import { getRouteHoverLabel } from "./routeLabel";
import { loadRouteData, loadScheduleData } from "./transitDataClient";
import { attachInteractivePopup } from "./attachInteractivePopup";
import { buildStopClusterPopupContent, type StopClusterRouteView } from "./buildStopClusterPopupContent";
import { MAP_PANES } from "./mapPanes";
import type {
  RouteState,
  RouteSelectionManager,
  SetRouteKeysOptions,
  RouteData,
  ScheduleData,
  StopData,
} from "@/types";

interface ManagerDeps {
  map: L.Map;
  routeStateByKey: Map<string, RouteState>;
  selectedRouteKeys: Set<string>;
  onStatusUpdate: (text: string) => void;
  onUiRefresh: () => void;
}

interface RouteShapeLayerState {
  layers: L.Polyline[];
  directionKeys: Set<string>;
}

interface RouteShapeRenderLayers {
  interactiveLayer: L.Polyline;
  layers: L.Polyline[];
}

interface StopVariantState {
  routeKey: string;
  routeData: RouteData;
  routeState: RouteState;
  stop: StopData;
}

interface StopClusterBuildState {
  anchorX: number;
  anchorY: number;
  sumLat: number;
  sumLon: number;
  stopCount: number;
  variants: StopVariantState[];
}

interface StopClusterLayerState {
  variants: StopVariantState[];
  activeRouteKey: string;
  usesRailIcon: boolean;
  visualMarker: L.CircleMarker | L.Marker;
  hitMarker: L.CircleMarker;
}

const STOP_CLUSTER_MERGE_DISTANCE_METERS = 24;
const STOP_CLUSTER_NEUTRAL_FILL = "#f6f9fe";
const STOP_CLUSTER_NEUTRAL_STROKE = "#29496d";
const STOP_CLUSTER_MULTI_RADIUS = 6.1;
const STOP_CLUSTER_MULTI_FOCUS_RADIUS = 7;
const STOP_VISUAL_RADIUS = 5.2;
const STOP_VISUAL_FOCUS_RADIUS = 6.4;
const STOP_VISUAL_STROKE_COLOR = "#ffffff";
const STOP_VISUAL_FOCUS_STROKE_COLOR = "#10233d";
const STOP_VISUAL_STROKE_WEIGHT = 1.4;
const STOP_VISUAL_FOCUS_STROKE_WEIGHT = 2.1;
const STOP_VISUAL_FILL_OPACITY = 0.95;
const STATION_ICON_BASE_SIZE = 20;
const STATION_ICON_FOCUS_SIZE = 24;
const RAIL_ROUTE_HALO_WEIGHT = 8.2;
const RAIL_ROUTE_HALO_OPACITY = 0.25;
const RAIL_ROUTE_BED_WEIGHT = 5.4;
const RAIL_ROUTE_BED_COLOR = "#111111";
const RAIL_ROUTE_TEXTURE_WEIGHT = 2;
const RAIL_ROUTE_TEXTURE_COLOR = "#c4cbd4";
const RAIL_ROUTE_TEXTURE_PATTERN = "2 10";

const STOP_HIT_FOCUS_OPACITY = 0.14;
const STOP_HIT_RADIUS_FINE_POINTER = 12;
const STOP_HIT_RADIUS_COARSE_POINTER = 16;
const STOP_HIT_RADIUS_MIN_FINE_POINTER = 6.5;
const STOP_HIT_RADIUS_MIN_COARSE_POINTER = 9;
const STOP_HIT_RADIUS_DENSE_SCALE = 0.44;
const STOP_HIT_TARGET_CELL_SIZE_PX = 28;
const METERS_PER_DEGREE = 111_320;

function stopHasExternalDirectionDepartures(
  scheduleData: ScheduleData | null,
  stop: StopData,
  directionKey: string,
): boolean {
  const byDirection = scheduleData?.daySchedulesByStopByDirection?.[stop.stopId];
  if (!byDirection) return false;
  const byDay = byDirection[directionKey];
  if (!byDay) return false;
  return Object.values(byDay).some((times) => times.length > 0);
}

function stopHasInlineDirectionDepartures(stop: StopData, directionKey: string): boolean {
  const byService = stop.serviceScheduleByDirection?.[directionKey];
  if (!byService) return false;
  return Object.values(byService).some((times) => times.length > 0);
}

function getStopDirectionKeysForHoverPreview(
  routeData: RouteData,
  stop: StopData,
  scheduleData: ScheduleData | null,
): string[] {
  const orderedDirectionKeys = Object.keys(routeData.directionLabels ?? {});
  const seen = new Set<string>();
  const keys: string[] = [];

  const maybeAdd = (directionKey: string) => {
    if (!directionKey || seen.has(directionKey)) return;
    seen.add(directionKey);
    keys.push(directionKey);
  };

  for (const directionKey of orderedDirectionKeys) {
    if (
      stopHasExternalDirectionDepartures(scheduleData, stop, directionKey) ||
      stopHasInlineDirectionDepartures(stop, directionKey)
    ) {
      maybeAdd(directionKey);
    }
  }

  const externalByDirection = scheduleData?.daySchedulesByStopByDirection?.[stop.stopId] ?? {};
  for (const [directionKey, byDay] of Object.entries(externalByDirection)) {
    if (Object.values(byDay).some((times) => times.length > 0)) {
      maybeAdd(directionKey);
    }
  }

  for (const [directionKey, byService] of Object.entries(stop.serviceScheduleByDirection ?? {})) {
    if (Object.values(byService).some((times) => times.length > 0)) {
      maybeAdd(directionKey);
    }
  }

  return keys;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function projectToMeters(lat: number, lon: number): { x: number; y: number } {
  const latRadians = (lat * Math.PI) / 180;
  const cosLat = Math.max(0.25, Math.cos(latRadians));
  return {
    x: lon * METERS_PER_DEGREE * cosLat,
    y: lat * METERS_PER_DEGREE,
  };
}

function compareStopVariants(a: StopVariantState, b: StopVariantState): number {
  const routeCompare = a.routeState.meta.shortName.localeCompare(
    b.routeState.meta.shortName,
    undefined,
    { numeric: true, sensitivity: "base" },
  );
  if (routeCompare !== 0) return routeCompare;

  const agencyCompare = a.routeState.meta.agencyLabel.localeCompare(
    b.routeState.meta.agencyLabel,
    undefined,
    { sensitivity: "base" },
  );
  if (agencyCompare !== 0) return agencyCompare;

  return a.routeKey.localeCompare(b.routeKey);
}

function createRailStationIcon(
  fillColor: string,
  sharedStop: boolean,
  focused: boolean,
): L.DivIcon {
  const size = focused ? STATION_ICON_FOCUS_SIZE : STATION_ICON_BASE_SIZE;
  const classes = [
    "station-stop-icon",
    sharedStop ? "is-shared" : "is-single",
    focused ? "is-focused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return L.divIcon({
    className: "station-stop-icon-wrap",
    html: `<span class="${classes}" style="--station-fill:${fillColor}" aria-hidden="true">&#128646;</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function buildRouteShapeLayers(
  points: [number, number][],
  color: string,
  mode: "bus" | "rail",
): RouteShapeRenderLayers {
  if (mode !== "rail") {
    const busLine = L.polyline(points, {
      color,
      weight: 3.8,
      opacity: 0.86,
      lineCap: "round",
      lineJoin: "round",
      pane: MAP_PANES.routeLines,
    });
    return {
      interactiveLayer: busLine,
      layers: [busLine],
    };
  }

  const halo = L.polyline(points, {
    color,
    weight: RAIL_ROUTE_HALO_WEIGHT,
    opacity: RAIL_ROUTE_HALO_OPACITY,
    lineCap: "round",
    lineJoin: "round",
    pane: MAP_PANES.routeLines,
    interactive: false,
  });

  const bed = L.polyline(points, {
    color: RAIL_ROUTE_BED_COLOR,
    weight: RAIL_ROUTE_BED_WEIGHT,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round",
    pane: MAP_PANES.routeLines,
  });

  const textured = L.polyline(points, {
    color: RAIL_ROUTE_TEXTURE_COLOR,
    weight: RAIL_ROUTE_TEXTURE_WEIGHT,
    opacity: 0.72,
    lineCap: "butt",
    lineJoin: "round",
    dashArray: RAIL_ROUTE_TEXTURE_PATTERN,
    pane: MAP_PANES.routeLines,
    interactive: false,
  });

  return {
    interactiveLayer: bed,
    layers: [halo, bed, textured],
  };
}

export function createRouteSelectionManager({
  map,
  routeStateByKey,
  selectedRouteKeys,
  onStatusUpdate,
  onUiRefresh,
}: ManagerDeps): RouteSelectionManager {
  const refreshUi = onUiRefresh;
  const shapeLayersByRouteKey = new Map<string, RouteShapeLayerState[]>();
  const stopClusterLayerGroup = L.layerGroup().addTo(map);
  const stopClusterLayers: StopClusterLayerState[] = [];
  const previewHoverCountsByRouteKey = new Map<string, number>();
  const previewActivationOrderByRouteKey = new Map<string, number>();
  const previewDirectionByRouteKey = new Map<string, string>();
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const defaultStopHitRadius = coarsePointer ? STOP_HIT_RADIUS_COARSE_POINTER : STOP_HIT_RADIUS_FINE_POINTER;
  const minStopHitRadius = coarsePointer ? STOP_HIT_RADIUS_MIN_COARSE_POINTER : STOP_HIT_RADIUS_MIN_FINE_POINTER;
  let stopHitTargetRefreshFrame: number | null = null;
  let stopClusterRebuildFrame: number | null = null;
  let activePreviewRouteKey: string | null = null;
  let previewActivationSequence = 0;

  function getVisibleStopLayers(): StopClusterLayerState[] {
    return stopClusterLayers;
  }

  function getStopHitRadius(nearestDistancePx: number): number {
    if (!Number.isFinite(nearestDistancePx)) {
      return defaultStopHitRadius;
    }
    return clamp(
      nearestDistancePx * STOP_HIT_RADIUS_DENSE_SCALE,
      minStopHitRadius,
      defaultStopHitRadius,
    );
  }

  function refreshVisibleStopHitTargets(): void {
    const visibleStopLayers = getVisibleStopLayers();
    if (visibleStopLayers.length === 0) {
      return;
    }

    if (visibleStopLayers.length === 1) {
      visibleStopLayers[0].hitMarker.setRadius(defaultStopHitRadius);
      return;
    }

    const points = visibleStopLayers.map((stopLayer) => map.latLngToLayerPoint(stopLayer.hitMarker.getLatLng()));
    const grid = new Map<string, number[]>();

    // Bucket points into a small screen-space grid so we only compare nearby markers.
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const cellX = Math.floor(point.x / STOP_HIT_TARGET_CELL_SIZE_PX);
      const cellY = Math.floor(point.y / STOP_HIT_TARGET_CELL_SIZE_PX);
      const key = getCellKey(cellX, cellY);
      const cell = grid.get(key);
      if (cell) {
        cell.push(index);
      } else {
        grid.set(key, [index]);
      }
    }

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const cellX = Math.floor(point.x / STOP_HIT_TARGET_CELL_SIZE_PX);
      const cellY = Math.floor(point.y / STOP_HIT_TARGET_CELL_SIZE_PX);
      let nearestDistanceSq = Number.POSITIVE_INFINITY;

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighbor = grid.get(getCellKey(cellX + offsetX, cellY + offsetY));
          if (!neighbor) continue;

          for (const neighborIndex of neighbor) {
            if (neighborIndex === index) continue;
            const neighborPoint = points[neighborIndex];
            const deltaX = point.x - neighborPoint.x;
            const deltaY = point.y - neighborPoint.y;
            const distanceSq = deltaX * deltaX + deltaY * deltaY;
            if (distanceSq < nearestDistanceSq) {
              nearestDistanceSq = distanceSq;
            }
          }
        }
      }

      const nearestDistancePx = Number.isFinite(nearestDistanceSq)
        ? Math.sqrt(nearestDistanceSq)
        : Number.POSITIVE_INFINITY;
      const nextRadius = getStopHitRadius(nearestDistancePx);
      const hitMarker = visibleStopLayers[index].hitMarker;
      if (Math.abs(hitMarker.getRadius() - nextRadius) > 0.25) {
        hitMarker.setRadius(nextRadius);
      }
    }
  }

  function scheduleStopHitTargetRefresh(): void {
    if (stopHitTargetRefreshFrame !== null) {
      return;
    }
    stopHitTargetRefreshFrame = window.requestAnimationFrame(() => {
      stopHitTargetRefreshFrame = null;
      refreshVisibleStopHitTargets();
    });
  }

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

  function syncRouteShapeVisibility(
    routeKey: string,
    state: RouteState,
    activeDirectionKey: string | null,
  ): void {
    if (!state.layer) return;
    const routeLayer = state.layer;
    const shapeLayers = shapeLayersByRouteKey.get(routeKey);
    if (!shapeLayers) return;

    for (const shapeLayer of shapeLayers) {
      const shouldShowShape = !activeDirectionKey || shapeLayer.directionKeys.has(activeDirectionKey);
      const hasShape = shapeLayer.layers.some((layer) => routeLayer.hasLayer(layer));
      if (shouldShowShape && !hasShape) {
        for (const layer of shapeLayer.layers) {
          layer.addTo(routeLayer);
        }
      } else if (!shouldShowShape && hasShape) {
        for (const layer of shapeLayer.layers) {
          routeLayer.removeLayer(layer);
        }
      }
    }
  }

  function syncSelectedRouteLayer(routeKey: string): void {
    const state = routeStateByKey.get(routeKey);
    if (!state) return;
    const showRoute = shouldShowSelectedRoute(routeKey, state);
    const activeDirectionKey =
      showRoute && activePreviewRouteKey === routeKey
        ? (previewDirectionByRouteKey.get(routeKey) ?? null)
        : null;
    syncRouteShapeVisibility(routeKey, state, activeDirectionKey);
    setLayerVisibility(state, showRoute);
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

  function startStationHoverPreview(routeKey: string, initialDirectionKey: string | null = null): void {
    const state = routeStateByKey.get(routeKey);
    if (!state?.selected) return;

    previewHoverCountsByRouteKey.set(routeKey, (previewHoverCountsByRouteKey.get(routeKey) ?? 0) + 1);
    previewActivationSequence += 1;
    previewActivationOrderByRouteKey.set(routeKey, previewActivationSequence);
    if (initialDirectionKey) {
      previewDirectionByRouteKey.set(routeKey, initialDirectionKey);
    } else {
      previewDirectionByRouteKey.delete(routeKey);
    }
    applyActivePreviewRoute(routeKey);
  }

  function setStationHoverPreviewDirection(routeKey: string, directionKey: string | null): void {
    const state = routeStateByKey.get(routeKey);
    if (!state?.selected) return;
    if ((previewHoverCountsByRouteKey.get(routeKey) ?? 0) <= 0) return;

    const currentDirectionKey = previewDirectionByRouteKey.get(routeKey) ?? null;
    if (directionKey) {
      if (currentDirectionKey === directionKey) return;
      previewDirectionByRouteKey.set(routeKey, directionKey);
    } else {
      if (currentDirectionKey === null) return;
      previewDirectionByRouteKey.delete(routeKey);
    }

    if (activePreviewRouteKey === routeKey) {
      syncSelectedRouteLayer(routeKey);
    }
  }

  function endStationHoverPreview(routeKey: string): void {
    const hoverCount = previewHoverCountsByRouteKey.get(routeKey) ?? 0;
    if (hoverCount <= 1) {
      previewHoverCountsByRouteKey.delete(routeKey);
      previewActivationOrderByRouteKey.delete(routeKey);
      previewDirectionByRouteKey.delete(routeKey);
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
    previewDirectionByRouteKey.delete(routeKey);
    if (activePreviewRouteKey !== routeKey) return;
    applyActivePreviewRoute(pickNextPreviewRouteKey());
  }

  function getActiveClusterVariant(clusterLayer: StopClusterLayerState): StopVariantState {
    return (
      clusterLayer.variants.find((variant) => variant.routeKey === clusterLayer.activeRouteKey) ??
      clusterLayer.variants[0]
    );
  }

  function setClusterActiveRoute(clusterLayer: StopClusterLayerState, routeKey: string): void {
    if (clusterLayer.variants.some((variant) => variant.routeKey === routeKey)) {
      clusterLayer.activeRouteKey = routeKey;
    }
  }

  function setStopClusterFocusState(clusterLayer: StopClusterLayerState, focused: boolean): void {
    const activeVariant = getActiveClusterVariant(clusterLayer);
    const isSharedStop = clusterLayer.variants.length > 1;
    const baseFillColor = isSharedStop ? STOP_CLUSTER_NEUTRAL_FILL : activeVariant.routeState.meta.color;
    const fillColor = focused && isSharedStop ? activeVariant.routeState.meta.color : baseFillColor;
    const strokeColor = isSharedStop
      ? (focused ? STOP_VISUAL_FOCUS_STROKE_COLOR : STOP_CLUSTER_NEUTRAL_STROKE)
      : (focused ? STOP_VISUAL_FOCUS_STROKE_COLOR : STOP_VISUAL_STROKE_COLOR);
    const radius = isSharedStop
      ? (focused ? STOP_CLUSTER_MULTI_FOCUS_RADIUS : STOP_CLUSTER_MULTI_RADIUS)
      : (focused ? STOP_VISUAL_FOCUS_RADIUS : STOP_VISUAL_RADIUS);
    const weight = focused ? STOP_VISUAL_FOCUS_STROKE_WEIGHT : STOP_VISUAL_STROKE_WEIGHT;

    if (clusterLayer.usesRailIcon) {
      const stationMarker = clusterLayer.visualMarker as L.Marker;
      stationMarker.setIcon(createRailStationIcon(fillColor, isSharedStop, focused));
      stationMarker.setZIndexOffset(focused ? 2000 : 0);
    } else {
      const circleMarker = clusterLayer.visualMarker as L.CircleMarker;
      circleMarker.setRadius(radius);
      circleMarker.setStyle({
        color: strokeColor,
        weight,
        fillColor,
        fillOpacity: STOP_VISUAL_FILL_OPACITY,
      });

      if (focused) {
        circleMarker.bringToFront();
      }
    }

    clusterLayer.hitMarker.setStyle({
      fillColor: activeVariant.routeState.meta.color,
      fillOpacity: focused ? STOP_HIT_FOCUS_OPACITY : 0,
    });

    if (focused) {
      clusterLayer.hitMarker.bringToFront();
    }
  }

  function collectSelectedStopVariants(): StopVariantState[] {
    const variants: StopVariantState[] = [];

    for (const routeKey of selectedRouteKeys) {
      const routeState = routeStateByKey.get(routeKey);
      if (!routeState?.selected || !routeState.routeData) continue;

      for (const stop of routeState.routeData.stops ?? []) {
        variants.push({
          routeKey,
          routeData: routeState.routeData,
          routeState,
          stop,
        });
      }
    }

    variants.sort(compareStopVariants);
    return variants;
  }

  function clusterStopVariants(variants: StopVariantState[]): StopClusterBuildState[] {
    const clusters: StopClusterBuildState[] = [];
    const grid = new Map<string, number[]>();
    const maxDistanceSq = STOP_CLUSTER_MERGE_DISTANCE_METERS * STOP_CLUSTER_MERGE_DISTANCE_METERS;

    for (const variant of variants) {
      const projected = projectToMeters(variant.stop.lat, variant.stop.lon);
      const cellX = Math.floor(projected.x / STOP_CLUSTER_MERGE_DISTANCE_METERS);
      const cellY = Math.floor(projected.y / STOP_CLUSTER_MERGE_DISTANCE_METERS);
      let matchedClusterIndex = -1;
      let bestDistanceSq = maxDistanceSq;

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighbor = grid.get(getCellKey(cellX + offsetX, cellY + offsetY));
          if (!neighbor) continue;

          for (const clusterIndex of neighbor) {
            const cluster = clusters[clusterIndex];
            const deltaX = projected.x - cluster.anchorX;
            const deltaY = projected.y - cluster.anchorY;
            const distanceSq = deltaX * deltaX + deltaY * deltaY;
            if (distanceSq <= bestDistanceSq) {
              bestDistanceSq = distanceSq;
              matchedClusterIndex = clusterIndex;
            }
          }
        }
      }

      if (matchedClusterIndex >= 0) {
        const cluster = clusters[matchedClusterIndex];
        cluster.variants.push(variant);
        cluster.sumLat += variant.stop.lat;
        cluster.sumLon += variant.stop.lon;
        cluster.stopCount += 1;
        continue;
      }

      const clusterIndex = clusters.push({
        anchorX: projected.x,
        anchorY: projected.y,
        sumLat: variant.stop.lat,
        sumLon: variant.stop.lon,
        stopCount: 1,
        variants: [variant],
      }) - 1;

      const key = getCellKey(cellX, cellY);
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(clusterIndex);
      } else {
        grid.set(key, [clusterIndex]);
      }
    }

    return clusters;
  }

  function getClusterRouteVariants(
    cluster: StopClusterBuildState,
    centerLat: number,
    centerLon: number,
  ): StopVariantState[] {
    const byRouteKey = new Map<string, { variant: StopVariantState; distanceMeters: number }>();

    for (const variant of cluster.variants) {
      const distanceMeters = map.distance([centerLat, centerLon], [variant.stop.lat, variant.stop.lon]);
      const existing = byRouteKey.get(variant.routeKey);
      if (!existing || distanceMeters < existing.distanceMeters) {
        byRouteKey.set(variant.routeKey, { variant, distanceMeters });
      }
    }

    return [...byRouteKey.values()].map((entry) => entry.variant).sort(compareStopVariants);
  }

  async function buildClusterRouteViews(variants: StopVariantState[]): Promise<StopClusterRouteView[]> {
    return Promise.all(
      variants.map(async (variant) => {
        const state = routeStateByKey.get(variant.routeKey);
        let scheduleData = state?.scheduleData ?? null;

        if (!scheduleData && !variant.routeData.activeServicesByDayByDirection && state) {
          scheduleData = await ensureRouteScheduleLoaded(state);
        }

        return {
          routeKey: variant.routeKey,
          routeMeta: variant.routeState.meta,
          routeData: variant.routeData,
          stop: variant.stop,
          scheduleData,
        };
      }),
    );
  }

  function getInitialDirectionForVariant(variant: StopVariantState): string | null {
    const state = routeStateByKey.get(variant.routeKey);
    const hoverDirectionKeys = getStopDirectionKeysForHoverPreview(
      variant.routeData,
      variant.stop,
      state?.scheduleData ?? null,
    );
    return hoverDirectionKeys.length === 1 ? hoverDirectionKeys[0] : null;
  }

  function rebuildStopClusters(): void {
    stopClusterLayerGroup.clearLayers();
    stopClusterLayers.length = 0;

    const selectedStopVariants = collectSelectedStopVariants();
    if (selectedStopVariants.length === 0) {
      return;
    }

    const clusteredStops = clusterStopVariants(selectedStopVariants);

    for (const clusteredStop of clusteredStops) {
      const centerLat = clusteredStop.sumLat / clusteredStop.stopCount;
      const centerLon = clusteredStop.sumLon / clusteredStop.stopCount;
      const variants = getClusterRouteVariants(clusteredStop, centerLat, centerLon);
      if (variants.length === 0) continue;

      const sharedStop = variants.length > 1;
      const activeRouteKey = variants[0].routeKey;
      const usesRailIcon = variants.some((variant) => variant.routeState.meta.mode === "rail");
      const initialFillColor = sharedStop ? STOP_CLUSTER_NEUTRAL_FILL : variants[0].routeState.meta.color;
      const visualMarker: L.CircleMarker | L.Marker = usesRailIcon
        ? L.marker([centerLat, centerLon], {
          icon: createRailStationIcon(initialFillColor, sharedStop, false),
          pane: MAP_PANES.stopVisuals,
          interactive: false,
          keyboard: false,
          bubblingMouseEvents: false,
        })
        : L.circleMarker([centerLat, centerLon], {
          radius: sharedStop ? STOP_CLUSTER_MULTI_RADIUS : STOP_VISUAL_RADIUS,
          color: sharedStop ? STOP_CLUSTER_NEUTRAL_STROKE : STOP_VISUAL_STROKE_COLOR,
          weight: STOP_VISUAL_STROKE_WEIGHT,
          fillColor: initialFillColor,
          fillOpacity: STOP_VISUAL_FILL_OPACITY,
          pane: MAP_PANES.stopVisuals,
          interactive: false,
          bubblingMouseEvents: false,
        });

      const hitMarker = L.circleMarker([centerLat, centerLon], {
        radius: defaultStopHitRadius,
        stroke: false,
        fill: true,
        fillColor: variants[0].routeState.meta.color,
        fillOpacity: 0,
        pane: MAP_PANES.stopHitTargets,
        bubblingMouseEvents: false,
      });

      const clusterLayer: StopClusterLayerState = {
        variants,
        activeRouteKey,
        usesRailIcon,
        visualMarker,
        hitMarker,
      };
      setStopClusterFocusState(clusterLayer, false);

      let previewRouteKey: string | null = null;

      hitMarker.bindPopup("", {
        closeButton: false,
        autoPan: true,
        className: "stop-popup",
        offset: [0, -6],
      });

      attachInteractivePopup(
        hitMarker,
        async () => {
          const routeViews = await buildClusterRouteViews(clusterLayer.variants);
          return buildStopClusterPopupContent(routeViews, clusterLayer.activeRouteKey);
        },
        {
          closeDelayMs: POPUP_CLOSE_DELAY_MS,
          hoverPointerQuery: HOVER_POINTER_QUERY,
          defaultRouteKey: clusterLayer.activeRouteKey,
          onHoverSessionStart: () => {
            const activeVariant = getActiveClusterVariant(clusterLayer);
            const initialDirection = getInitialDirectionForVariant(activeVariant);
            previewRouteKey = activeVariant.routeKey;
            setStopClusterFocusState(clusterLayer, true);
            startStationHoverPreview(previewRouteKey, initialDirection);
          },
          onRouteChange: (routeKey, directionKey) => {
            if (!routeKey) return;
            setClusterActiveRoute(clusterLayer, routeKey);
            setStopClusterFocusState(clusterLayer, true);

            if (!previewRouteKey) {
              previewRouteKey = routeKey;
              startStationHoverPreview(routeKey, directionKey);
              return;
            }
            if (previewRouteKey !== routeKey) {
              endStationHoverPreview(previewRouteKey);
              previewRouteKey = routeKey;
              startStationHoverPreview(routeKey, directionKey);
              return;
            }
            setStationHoverPreviewDirection(routeKey, directionKey);
          },
          onDirectionChange: (routeKey, directionKey) => {
            if (!routeKey) return;
            if (!previewRouteKey) {
              previewRouteKey = routeKey;
              startStationHoverPreview(routeKey, directionKey);
              return;
            }
            if (previewRouteKey !== routeKey) {
              endStationHoverPreview(previewRouteKey);
              previewRouteKey = routeKey;
              startStationHoverPreview(routeKey, directionKey);
              return;
            }
            setStationHoverPreviewDirection(routeKey, directionKey);
          },
          onHoverSessionEnd: () => {
            setStopClusterFocusState(clusterLayer, false);
            if (!previewRouteKey) return;
            endStationHoverPreview(previewRouteKey);
            previewRouteKey = null;
          },
        },
      );

      visualMarker.addTo(stopClusterLayerGroup);
      hitMarker.addTo(stopClusterLayerGroup);
      stopClusterLayers.push(clusterLayer);
    }

    scheduleStopHitTargetRefresh();
  }

  function scheduleStopClusterRebuild(): void {
    if (stopClusterRebuildFrame !== null) return;
    stopClusterRebuildFrame = window.requestAnimationFrame(() => {
      stopClusterRebuildFrame = null;
      rebuildStopClusters();
    });
  }

  map.on("zoomend", scheduleStopHitTargetRefresh);

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
          scheduleStopClusterRebuild();
        } catch (error) {
          console.error(error);
          state.selected = false;
          selectedRouteKeys.delete(routeKey);
          clearStationHoverPreviewForRoute(routeKey);
          syncSelectedRouteLayer(routeKey);
          scheduleStopClusterRebuild();
          onStatusUpdate(
            `Failed to load route ${state.meta.shortName}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      } else {
        selectedRouteKeys.delete(routeKey);
        clearStationHoverPreviewForRoute(routeKey);
        syncSelectedRouteLayer(routeKey);
        scheduleStopClusterRebuild();
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
    const shapeLayers: RouteShapeLayerState[] = [];

    for (const shape of routeData.shapes ?? []) {
      const { interactiveLayer, layers } = buildRouteShapeLayers(
        shape.points,
        routeMeta.color,
        routeMeta.mode,
      );
      if (layers.length === 0) continue;

      interactiveLayer.bindTooltip(routeHoverLabel, {
        sticky: true,
        direction: "top",
        offset: [0, -4],
        className: "route-hover-tooltip",
      });

      for (const layer of layers) {
        layer.addTo(group);
      }

      shapeLayers.push({
        layers,
        directionKeys: new Set(shape.directionKeys),
      });
    }
    shapeLayersByRouteKey.set(routeMeta.key, shapeLayers);

    return group;
  }

  return {
    setRouteSelection,
    setRouteKeysSelected,
  };
}
