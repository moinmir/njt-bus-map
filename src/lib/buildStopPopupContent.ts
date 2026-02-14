import { DAY_KEYS, DAY_LABELS, JS_DAY_TO_KEY } from "./constants";
import { escapeHtml } from "./escapeHtml";
import { findNextArrival, formatDateShort, formatGtfsTime, parseGtfsSeconds } from "./time";
import type { DayKey, DaySchedules, RouteMeta, RouteData, StopData, ScheduleData } from "@/types";

interface DirectionScheduleView {
  key: string;
  label: string;
  displayLabel: string;
  icon: string;
  daySchedules: DaySchedules;
}

const EXACT_FARE_SUFFIX_RE = /\s*-\s*exact fare\s*$/i;

function createEmptyDaySchedules(): DaySchedules {
  const byDay = {} as DaySchedules;
  for (const dayKey of DAY_KEYS) {
    byDay[dayKey] = [];
  }
  return byDay;
}

function hasAnyDayDepartures(daySchedules: DaySchedules): boolean {
  return DAY_KEYS.some((dayKey) => (daySchedules[dayKey]?.length ?? 0) > 0);
}

function filterDirectionsWithDepartures(
  byDirection: Record<string, DaySchedules>,
): Record<string, DaySchedules> {
  const filtered: Record<string, DaySchedules> = {};
  let filteredCount = 0;
  for (const [directionKey, daySchedules] of Object.entries(byDirection)) {
    if (!hasAnyDayDepartures(daySchedules)) continue;
    filtered[directionKey] = daySchedules;
    filteredCount += 1;
  }

  if (filteredCount > 0) {
    return filtered;
  }

  return byDirection;
}

function hasInlineDirectionScheduleData(routeData: RouteData, stop: StopData): boolean {
  return Boolean(routeData.activeServicesByDayByDirection) && Boolean(stop.serviceScheduleByDirection);
}

function normalizeExternalDirectionDaySchedules(
  rawByDirection: Record<string, Record<string, string[]>> | undefined,
): Record<string, DaySchedules> {
  const byDirection: Record<string, DaySchedules> = {};
  if (!rawByDirection) return byDirection;

  for (const [directionKey, rawByDay] of Object.entries(rawByDirection)) {
    const byDay = createEmptyDaySchedules();
    for (const dayKey of DAY_KEYS) {
      byDay[dayKey] = [...(rawByDay?.[dayKey] ?? [])];
    }
    byDirection[directionKey] = byDay;
  }

  return byDirection;
}

function computeInlineDirectionDaySchedules(
  routeData: RouteData,
  stop: StopData,
): Record<string, DaySchedules> {
  if (stop._daySchedulesByDirection) {
    return stop._daySchedulesByDirection as Record<string, DaySchedules>;
  }

  const byDirection: Record<string, DaySchedules> = {};
  const activeByDirection = routeData.activeServicesByDayByDirection ?? {};

  for (const [directionKey, activeByDay] of Object.entries(activeByDirection)) {
    const byDay = createEmptyDaySchedules();

    for (const dayKey of DAY_KEYS) {
      const merged = new Set<string>();
      const serviceIds = activeByDay?.[dayKey] ?? [];

      for (const serviceId of serviceIds) {
        const times = stop.serviceScheduleByDirection?.[directionKey]?.[serviceId] ?? [];
        for (const value of times) {
          merged.add(value);
        }
      }

      byDay[dayKey] = [...merged].sort((a, b) => parseGtfsSeconds(a) - parseGtfsSeconds(b));
    }

    byDirection[directionKey] = byDay;
  }

  stop._daySchedulesByDirection = byDirection as Record<string, Record<string, string[]>>;
  return byDirection;
}

function resolveDirectionDaySchedules(
  routeData: RouteData,
  stop: StopData,
  scheduleData: ScheduleData | null,
): Record<string, DaySchedules> | null {
  const externalByStop = scheduleData?.daySchedulesByStopByDirection?.[stop.stopId];
  const external = filterDirectionsWithDepartures(normalizeExternalDirectionDaySchedules(externalByStop));
  if (Object.keys(external).length > 0) {
    return external;
  }

  if (hasInlineDirectionScheduleData(routeData, stop)) {
    const inline = filterDirectionsWithDepartures(computeInlineDirectionDaySchedules(routeData, stop));
    if (Object.keys(inline).length > 0) {
      return inline;
    }
  }

  return null;
}

function formatDirectionLabel(rawLabel: string, directionKey: string): string {
  const strippedFare = rawLabel.replace(EXACT_FARE_SUFFIX_RE, "").trim();
  const strippedPrefix = strippedFare.replace(/^\d+[A-Z]?\s+/, "").trim();
  const normalized = strippedPrefix.replace(/\s+/g, " ");
  if (!normalized) {
    return `Direction ${directionKey}`;
  }
  if (normalized.length > 28) {
    return `${normalized.slice(0, 27)}…`;
  }
  return normalized;
}

function inferDirectionIcon(directionKey: string, label: string): string {
  const lower = label.toLowerCase();
  if (/\bcounterclockwise\b|\banti-?clockwise\b/.test(lower)) return "↺";
  if (/\bclockwise\b/.test(lower)) return "↻";
  if (/\bnorth(?:bound)?\b/.test(lower)) return "↑";
  if (/\bsouth(?:bound)?\b/.test(lower)) return "↓";
  if (/\beast(?:bound)?\b/.test(lower)) return "→";
  if (/\bwest(?:bound)?\b/.test(lower)) return "←";
  if (/\binbound\b/.test(lower)) return "↘";
  if (/\boutbound\b/.test(lower)) return "↗";
  if (/(?:^|[_\s-])0$/.test(directionKey)) return "↗";
  if (/(?:^|[_\s-])1$/.test(directionKey)) return "↘";

  return "→";
}

function renderStatusCard(message: string): string {
  return `
    <div class="next-card next-card--status" aria-live="polite">
      <p class="next-kicker"><span class="next-icon" aria-hidden="true">ℹ</span>Status</p>
      <p class="next-empty">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderDayBlocks(daySchedules: DaySchedules, representativeDates: Record<string, string> | undefined): string {
  const next = findNextArrival(daySchedules);
  const defaultOpenDay: DayKey = next?.dayKey ?? JS_DAY_TO_KEY[new Date().getDay()];

  return DAY_KEYS.map((dayKey) => {
    const times = daySchedules[dayKey] ?? [];
    const representativeDate = representativeDates?.[dayKey];
    const openAttr = dayKey === defaultOpenDay ? " open" : "";

    let bodyHtml = `
      <div class="no-service">
        <span aria-hidden="true">∅</span>
        <span>No departures scheduled</span>
      </div>
    `;
    if (times.length > 0) {
      const rows = times
        .map((rawTime) => {
          const token = `${dayKey}:${rawTime}`;
          const label = formatGtfsTime(rawTime);
          return `
            <li class="time-entry${next?.token === token ? " is-next" : ""}">
              <span class="time-value">${escapeHtml(label)}</span>
            </li>
          `;
        })
        .join("");
      bodyHtml = `<ol class="times-grid" aria-label="${escapeHtml(DAY_LABELS[dayKey])} departures">${rows}</ol>`;
    }

    const dayDate = representativeDate
      ? `<span class="day-date">${escapeHtml(formatDateShort(representativeDate))}</span>`
      : "";
    const countLabel = times.length > 0 ? `${times.length} departures` : "No service";

    return `
      <details class="day-item"${openAttr}>
        <summary>
          <span class="day-left"><span class="day-label">${DAY_LABELS[dayKey]}</span>${dayDate}</span>
          <span class="day-count">${countLabel}</span>
        </summary>
        <div class="day-body">${bodyHtml}</div>
      </details>
    `;
  }).join("");
}

function renderScheduleSection(daySchedules: DaySchedules, representativeDates: Record<string, string> | undefined): string {
  return `
    <div class="day-list">${renderDayBlocks(daySchedules, representativeDates)}</div>
  `;
}

function buildDirectionViews(
  routeData: RouteData,
  scheduleData: ScheduleData | null,
  directionSchedules: Record<string, DaySchedules>,
): DirectionScheduleView[] {
  const directionKeys = Object.keys(directionSchedules);
  if (directionKeys.length === 0) {
    return [];
  }

  const labelsByKey = scheduleData?.directionLabels ?? routeData.directionLabels ?? {};
  const directionViews = directionKeys.map((directionKey) => {
    const label = labelsByKey[directionKey] ?? `Direction ${directionKey}`;
    const displayLabel = formatDirectionLabel(label, directionKey);
    return {
      key: directionKey,
      label,
      displayLabel,
      icon: inferDirectionIcon(directionKey, displayLabel),
      daySchedules: directionSchedules[directionKey],
    };
  });

  return directionViews;
}

export function buildStopPopupContent(
  routeMeta: RouteMeta,
  routeData: RouteData,
  stop: StopData,
  scheduleData: ScheduleData | null,
): string {
  const directionSchedules = resolveDirectionDaySchedules(routeData, stop, scheduleData);
  if (!directionSchedules || Object.keys(directionSchedules).length === 0) {
    return `
      <div class="popup-shell">
        <div class="popup-head">
          <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
          <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
        </div>
        ${renderStatusCard("Schedule data is unavailable for this route right now.")}
      </div>
    `;
  }

  const directionViews = buildDirectionViews(routeData, scheduleData, directionSchedules);
  if (directionViews.length === 0) {
    return `
      <div class="popup-shell">
        <div class="popup-head">
          <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
          <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
        </div>
        ${renderStatusCard("Direction data is unavailable for this stop right now.")}
      </div>
    `;
  }

  const representativeDates = scheduleData?.representativeDates ?? routeData.representativeDates;

  const directionToggleHtml = directionViews.length > 1
    ? `
      <div class="direction-toggle">
        <button
          type="button"
          class="direction-switch"
          data-direction-switch
          data-direction-index="0"
          aria-label="Switch direction to ${escapeHtml(directionViews[1].displayLabel)}"
          title="Switch direction"
        >
          <span class="direction-switch-current">
            <span class="direction-icon" aria-hidden="true" data-direction-current-icon>${escapeHtml(directionViews[0].icon)}</span>
            <span class="direction-current-label" data-direction-current-label>${escapeHtml(directionViews[0].displayLabel)}</span>
          </span>
          <span class="direction-switch-arrow" aria-hidden="true">↻</span>
        </button>
      </div>
    `
    : "";

  const directionPanelsHtml = directionViews.length === 1
    ? `
      <section class="direction-panel is-active" data-direction-panel="${escapeHtml(directionViews[0].key)}">
        ${renderScheduleSection(directionViews[0].daySchedules, representativeDates)}
      </section>
    `
    : `
      <div class="direction-panel-group">
        ${directionViews.map((view, idx) => `
          <section
            class="direction-panel${idx === 0 ? " is-active" : ""}"
            data-direction-panel="${escapeHtml(view.key)}"
            data-direction-label="${escapeHtml(view.displayLabel)}"
            data-direction-icon="${escapeHtml(view.icon)}"
            aria-hidden="${idx === 0 ? "false" : "true"}"
          >
            ${renderScheduleSection(view.daySchedules, representativeDates)}
          </section>
        `).join("")}
      </div>
    `;

  return `
    <div class="popup-shell">
      <div class="popup-head">
        <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
        <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
      </div>
      ${directionToggleHtml}
      ${directionPanelsHtml}
    </div>
  `;
}
