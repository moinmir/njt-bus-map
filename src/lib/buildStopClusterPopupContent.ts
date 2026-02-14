import { buildStopPopupSections } from "./buildStopPopupContent";
import { escapeHtml } from "./escapeHtml";
import type { RouteMeta, RouteData, StopData, ScheduleData } from "@/types";

export interface StopClusterRouteView {
  routeKey: string;
  routeMeta: RouteMeta;
  routeData: RouteData;
  stop: StopData;
  scheduleData: ScheduleData | null;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const normalized = index % length;
  return normalized < 0 ? normalized + length : normalized;
}

function getInitialRouteIndex(views: StopClusterRouteView[], activeRouteKey: string | null): number {
  if (!activeRouteKey) return 0;
  const index = views.findIndex((view) => view.routeKey === activeRouteKey);
  return index >= 0 ? index : 0;
}

export function buildStopClusterPopupContent(
  views: StopClusterRouteView[],
  activeRouteKey: string | null,
): string {
  if (views.length === 0) {
    return `
      <div class="popup-shell">
        <div class="next-card next-card--status" aria-live="polite">
          <p class="next-kicker"><span class="next-icon" aria-hidden="true">ℹ</span>Status</p>
          <p class="next-empty">No stop data is available right now.</p>
        </div>
      </div>
    `;
  }

  if (views.length === 1) {
    const section = buildStopPopupSections(
      views[0].routeMeta,
      views[0].routeData,
      views[0].stop,
      views[0].scheduleData,
    );
    return `
      <div class="popup-shell">
        <div class="popup-head">
          <h3 class="popup-title">${section.title}</h3>
          <p class="popup-subtitle">${section.subtitle}</p>
        </div>
        ${section.bodyHtml}
      </div>
    `;
  }

  const initialIndex = clampIndex(getInitialRouteIndex(views, activeRouteKey), views.length);
  const initialView = views[initialIndex];

  const routeToggleHtml = `
    <div class="route-toggle" role="group" aria-label="Route switcher">
      <button
        type="button"
        class="route-nav route-nav--prev"
        data-route-nav="-1"
        aria-label="Previous route"
        title="Previous route"
      >
        <span aria-hidden="true">←</span>
      </button>
      <div class="route-chip" aria-live="polite" aria-atomic="true">
        <span class="route-chip-icon" aria-hidden="true">🚌</span>
        <span class="route-chip-label" data-route-current-label>${escapeHtml(initialView.routeMeta.shortName)}</span>
        <span class="route-chip-count" data-route-current-count>${initialIndex + 1}/${views.length}</span>
      </div>
      <button
        type="button"
        class="route-nav route-nav--next"
        data-route-nav="1"
        aria-label="Next route"
        title="Next route"
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  `;

  const routePanelsHtml = views
    .map((view, index) => {
      const section = buildStopPopupSections(view.routeMeta, view.routeData, view.stop, view.scheduleData);
      const active = index === initialIndex;
      return `
        <section
          class="route-panel${active ? " is-active" : ""}"
          data-route-panel="${escapeHtml(view.routeKey)}"
          data-route-short-name="${escapeHtml(view.routeMeta.shortName)}"
          aria-hidden="${active ? "false" : "true"}"
        >
          <div class="popup-head">
            <h3 class="popup-title">${section.title}</h3>
            <p class="popup-subtitle">${section.subtitle}</p>
          </div>
          ${section.bodyHtml}
        </section>
      `;
    })
    .join("");

  return `
    <div class="popup-shell">
      ${routeToggleHtml}
      <div class="route-panel-group">${routePanelsHtml}</div>
    </div>
  `;
}
