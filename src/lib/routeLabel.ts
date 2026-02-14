import type { RouteMeta } from "@/types";

export function getRouteHoverLabel(routeMeta: RouteMeta): string {
  const baseLabel = routeMeta.shortName || routeMeta.label || routeMeta.routeId;
  const longName = routeMeta.longName.trim();

  if (!longName) {
    return `Route ${baseLabel}`;
  }

  return `Route ${baseLabel}: ${longName}`;
}
