import L from "leaflet";
import { ensureTransitMapPanes } from "./mapPanes";

export function createBaseMap(container: HTMLElement): L.Map {
  const map = L.map(container, {
    preferCanvas: true,
    zoomControl: false,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    minZoom: 8,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);
  ensureTransitMapPanes(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
  }).addTo(map);

  map.setView([40.258, -74.66], 10.5);
  return map;
}
