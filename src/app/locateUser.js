export function locateUser({ map, statusNode, appState }) {
  if (!("geolocation" in navigator)) {
    statusNode.textContent = "Geolocation is not supported on this browser.";
    return;
  }

  statusNode.textContent = "Locating your position...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      const latLng = [latitude, longitude];

      map.flyTo(latLng, 13, { animate: true, duration: 0.6 });

      if (appState.userLocationLayer && map.hasLayer(appState.userLocationLayer)) {
        map.removeLayer(appState.userLocationLayer);
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

      appState.userLocationLayer = L.layerGroup([accuracyRing, marker]).addTo(map);
      statusNode.textContent = "Centered map on your current location.";
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        statusNode.textContent =
          "Location permission is blocked. Enable location access and try again.";
        return;
      }
      statusNode.textContent = "Unable to read your location right now.";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    },
  );
}
