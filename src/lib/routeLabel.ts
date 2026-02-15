import type { RouteMeta } from "@/types";

export function getRouteHoverLabel(routeMeta: RouteMeta): string {
  const baseLabel = routeMeta.shortName || routeMeta.label || routeMeta.routeId;
  const longName = routeMeta.longName.trim();
  const noun = routeMeta.mode === "rail" ? "Line" : "Route";

  if (!longName) {
    return `${noun} ${baseLabel}`;
  }

  return `${noun} ${baseLabel}: ${longName}`;
}
