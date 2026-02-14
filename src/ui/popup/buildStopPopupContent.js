import { DAY_KEYS, DAY_LABELS, JS_DAY_TO_KEY } from "../../config/constants.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import {
  findNextArrival,
  findUpcomingArrivals,
  formatDateShort,
  formatGtfsTime,
  parseGtfsSeconds,
} from "../../utils/time.js";

function hasInlineScheduleData(routeData, stop) {
  return Boolean(routeData.activeServicesByDay) && Boolean(stop.serviceSchedule);
}

function normalizeExternalDaySchedules(rawByDay) {
  const byDay = {};
  for (const dayKey of DAY_KEYS) {
    byDay[dayKey] = rawByDay?.[dayKey] ?? [];
  }
  return byDay;
}

function computeInlineDaySchedules(routeData, stop) {
  if (stop._daySchedules) {
    return stop._daySchedules;
  }

  const byDay = {};
  for (const dayKey of DAY_KEYS) {
    const serviceIds = routeData.activeServicesByDay?.[dayKey] ?? [];
    const merged = new Set();

    for (const serviceId of serviceIds) {
      const times = stop.serviceSchedule?.[serviceId] ?? [];
      for (const value of times) {
        merged.add(value);
      }
    }

    byDay[dayKey] = [...merged].sort((a, b) => parseGtfsSeconds(a) - parseGtfsSeconds(b));
  }

  stop._daySchedules = byDay;
  return byDay;
}

function resolveDaySchedules(routeData, stop, scheduleData) {
  const externalByStop = scheduleData?.daySchedulesByStop?.[stop.stopId];
  if (externalByStop) {
    return normalizeExternalDaySchedules(externalByStop);
  }

  if (hasInlineScheduleData(routeData, stop)) {
    return computeInlineDaySchedules(routeData, stop);
  }

  return null;
}

export function buildStopPopupContent(routeMeta, routeData, stop, scheduleData) {
  const daySchedules = resolveDaySchedules(routeData, stop, scheduleData);
  if (!daySchedules) {
    return `
      <div class="popup-shell">
        <div class="popup-head">
          <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
          <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
        </div>
        <div class="next-bar">Schedule data is unavailable for this route right now.</div>
      </div>
    `;
  }

  const representativeDates = scheduleData?.representativeDates ?? routeData.representativeDates;
  const next = findNextArrival(daySchedules);
  const upcoming = findUpcomingArrivals(daySchedules, 3);
  const defaultOpenDay = next?.dayKey ?? JS_DAY_TO_KEY[new Date().getDay()];

  const dayBlocks = DAY_KEYS.map((dayKey) => {
    const times = daySchedules[dayKey] ?? [];
    const representativeDate = representativeDates?.[dayKey];
    const openAttr = dayKey === defaultOpenDay ? " open" : "";

    let bodyHtml = '<div class="no-service">No service</div>';
    if (times.length > 0) {
      const chips = times
        .map((rawTime) => {
          const token = `${dayKey}:${rawTime}`;
          const label = formatGtfsTime(rawTime);
          if (next?.token === token) {
            return `<strong class="next-chip">${label}</strong>`;
          }
          return `<span class="time-chip">${label}</span>`;
        })
        .join("");
      bodyHtml = `<div class="times-grid">${chips}</div>`;
    }

    const dayDate = representativeDate
      ? `<span class="day-date">${formatDateShort(representativeDate)}</span>`
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

  const nextBar = upcoming.length
    ? `<strong>${upcoming[0]}</strong>${upcoming.length > 1 ? ` • ${upcoming.slice(1).join(" • ")}` : ""}`
    : "No upcoming departure in this representative week.";

  return `
    <div class="popup-shell">
      <div class="popup-head">
        <h3 class="popup-title">${escapeHtml(stop.name)}</h3>
        <p class="popup-subtitle">${escapeHtml(routeMeta.agencyLabel)} • Route ${escapeHtml(routeMeta.shortName)}</p>
      </div>
      <div class="next-bar">Next: ${nextBar}</div>
      <div class="day-list">${dayBlocks}</div>
    </div>
  `;
}
