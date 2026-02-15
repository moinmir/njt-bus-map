import L from "leaflet";
import { ensureTransitMapPanes } from "./mapPanes";

interface CreateBaseMapOptions {
  onLocateRequest?: () => void;
}

function addLocateButtonToZoomControl(
  zoomControl: L.Control.Zoom,
  onLocateRequest?: () => void,
) {
  if (!onLocateRequest) return;

  const zoomContainer = zoomControl.getContainer();
  if (!zoomContainer) return;

  const locateButton = L.DomUtil.create(
    "a",
    "leaflet-control-zoom-locate",
    zoomContainer,
  ) as HTMLAnchorElement;
  locateButton.href = "#";
  locateButton.title = "Locate me and search this area";
  locateButton.setAttribute("role", "button");
  locateButton.setAttribute("aria-label", "Locate me and search this area");
  locateButton.innerHTML =
    '<svg class="leaflet-control-locate-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5v2.2m0 12.6v2.2m8.5-8.5h-2.2M5.7 12H3.5m13.1 0A4.6 4.6 0 1 1 12 7.4a4.6 4.6 0 0 1 4.6 4.6Z"/></svg>';

  zoomContainer.insertBefore(locateButton, zoomContainer.firstChild);

  L.DomEvent.disableClickPropagation(locateButton);
  L.DomEvent.on(locateButton, "click", (event) => {
    L.DomEvent.stop(event);
    onLocateRequest();
  });
}

export function createBaseMap(
  container: HTMLElement,
  options?: CreateBaseMapOptions,
): L.Map {
  const map = L.map(container, {
    preferCanvas: true,
    zoomControl: false,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    minZoom: 8,
  });

  const zoomControl = L.control.zoom({ position: "bottomright" }).addTo(map);
  addLocateButtonToZoomControl(zoomControl, options?.onLocateRequest);
  ensureTransitMapPanes(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
  }).addTo(map);

  map.setView([40.258, -74.66], 10.5);
  return map;
}
