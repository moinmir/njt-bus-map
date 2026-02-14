import type { AppState } from "@/types";
import { getVisibleRouteKeys } from "@/lib/routeFiltering";

interface StatusSectionProps {
  state: AppState;
}

export function StatusSection({ state }: StatusSectionProps) {
  const selectedCount = state.selectedRouteKeys.size;
  const visibleCount = getVisibleRouteKeys(state.routeStateByKey).length;

  let statusText: string;

  if (selectedCount === 0) {
    const scopeLabel = state.activeAreaBounds ? "in searched map area" : "in filter";
    statusText = `No routes selected. ${visibleCount} route(s) currently visible ${scopeLabel}.`;
  } else {
    const byAgency = new Map<string, number>();
    for (const key of state.selectedRouteKeys) {
      const rs = state.routeStateByKey.get(key);
      if (!rs) continue;
      const label = rs.meta.agencyLabel;
      byAgency.set(label, (byAgency.get(label) ?? 0) + 1);
    }

    const agencyText = [...byAgency.entries()]
      .map(([label, count]) => `${label}: ${count}`)
      .join(" | ");

    const filters: string[] = [];
    if (state.activeSearchTerm) filters.push(`Search: "${state.activeSearchTerm}"`);
    if (state.activeAreaBounds) filters.push("Area filter: on");

    const filterText = filters.length ? ` | ${filters.join(" | ")}` : "";
    statusText = `Selected ${selectedCount} route(s)${filterText} | ${agencyText}`;
  }

  return (
    <p className="text-sm text-muted-foreground leading-relaxed" role="status" aria-live="polite">
      {statusText}
    </p>
  );
}
