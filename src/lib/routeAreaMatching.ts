import type { AreaBounds, RouteBounds, RouteData } from "@/types";

function pointInAreaBounds(
  lat: number,
  lon: number,
  areaBounds: AreaBounds,
): boolean {
  return (
    lat >= areaBounds.south &&
    lat <= areaBounds.north &&
    lon >= areaBounds.west &&
    lon <= areaBounds.east
  );
}

function routeDataHasGeometry(routeData: RouteData | null | undefined): boolean {
  if (!routeData) return false;
  if ((routeData.stops?.length ?? 0) > 0) return true;
  return (routeData.shapes ?? []).some((shape) => shape.points.length > 0);
}

function routeBoundsIntersectsArea(
  routeBounds: RouteBounds | undefined,
  areaBounds: AreaBounds,
): boolean {
  if (!routeBounds) return false;

  const [[south, west], [north, east]] = routeBounds;
  return (
    north >= areaBounds.south &&
    south <= areaBounds.north &&
    east >= areaBounds.west &&
    west <= areaBounds.east
  );
}

function routeDataIntersectsArea(
  routeData: RouteData | null | undefined,
  areaBounds: AreaBounds,
): boolean {
  if (!routeData) return false;

  for (const stop of routeData.stops ?? []) {
    if (pointInAreaBounds(stop.lat, stop.lon, areaBounds)) {
      return true;
    }
  }

  for (const shape of routeData.shapes ?? []) {
    for (const [lat, lon] of shape.points) {
      if (pointInAreaBounds(lat, lon, areaBounds)) {
        return true;
      }
    }
  }

  return false;
}

export function routeIntersectsArea(
  routeBounds: RouteBounds | undefined,
  routeData: RouteData | null | undefined,
  areaBounds: AreaBounds,
): boolean {
  if (routeDataHasGeometry(routeData)) {
    return routeDataIntersectsArea(routeData, areaBounds);
  }
  return routeBoundsIntersectsArea(routeBounds, areaBounds);
}
