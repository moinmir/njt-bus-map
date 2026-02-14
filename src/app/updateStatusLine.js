export function updateStatusLine({
  statusNode,
  selectedRouteKeys,
  routeStateByKey,
  activeAreaBounds,
  activeSearchTerm,
  visibleCount,
}) {
  const selectedCount = selectedRouteKeys.size;

  if (selectedCount === 0) {
    const scopeLabel = activeAreaBounds ? "in searched map area" : "in filter";
    statusNode.textContent = `No routes selected. ${visibleCount} route(s) currently visible ${scopeLabel}.`;
    return;
  }

  const byAgency = new Map();
  for (const key of selectedRouteKeys) {
    const state = routeStateByKey.get(key);
    if (!state) continue;
    const label = state.meta.agencyLabel;
    byAgency.set(label, (byAgency.get(label) ?? 0) + 1);
  }

  const agencyText = [...byAgency.entries()]
    .map(([label, count]) => `${label}: ${count}`)
    .join(" | ");

  const filters = [];
  if (activeSearchTerm) filters.push(`Search: "${activeSearchTerm}"`);
  if (activeAreaBounds) filters.push("Area filter: on");

  const filterText = filters.length ? ` | ${filters.join(" | ")}` : "";
  statusNode.textContent = `Selected ${selectedCount} route(s)${filterText} | ${agencyText}`;
}
