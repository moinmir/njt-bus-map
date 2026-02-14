import type L from "leaflet";

export const MAP_PANES = {
  routeLines: "route-lines",
  stopVisuals: "stop-visuals",
  stopHitTargets: "stop-hit-targets",
} as const;

interface PaneConfig {
  name: (typeof MAP_PANES)[keyof typeof MAP_PANES];
  zIndex: number;
}

const PANE_CONFIGS: PaneConfig[] = [
  { name: MAP_PANES.routeLines, zIndex: 430 },
  { name: MAP_PANES.stopVisuals, zIndex: 620 },
  { name: MAP_PANES.stopHitTargets, zIndex: 625 },
];

function ensurePane(map: L.Map, config: PaneConfig): void {
  const pane = map.getPane(config.name) ?? map.createPane(config.name);
  pane.style.zIndex = String(config.zIndex);
}

export function ensureTransitMapPanes(map: L.Map): void {
  for (const config of PANE_CONFIGS) {
    ensurePane(map, config);
  }
}
