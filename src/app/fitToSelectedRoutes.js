export function fitToSelectedRoutes(map, selectedRouteKeys, routeStateByKey) {
  const bounds = L.latLngBounds([]);

  for (const key of selectedRouteKeys) {
    const state = routeStateByKey.get(key);
    if (!state?.meta?.bounds) continue;

    const [[south, west], [north, east]] = state.meta.bounds;
    bounds.extend([south, west]);
    bounds.extend([north, east]);
  }

  if (bounds.isValid()) {
    map.fitBounds(bounds, {
      padding: [32, 32],
      animate: true,
      duration: 0.5,
    });
  }
}
