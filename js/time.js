import { DAY_LABELS, JS_DAY_TO_KEY } from "./constants.js";

export function parseGtfsSeconds(rawTime) {
  const [h, m, s] = rawTime.split(":").map((segment) => Number.parseInt(segment, 10));
  if ([h, m, s].some(Number.isNaN)) return Number.NaN;
  return h * 3600 + m * 60 + s;
}

export function formatGtfsTime(rawTime) {
  const totalSeconds = parseGtfsSeconds(rawTime);
  if (Number.isNaN(totalSeconds)) return rawTime;

  const overflowDays = Math.floor(totalSeconds / 86400);
  const secondOfDay = totalSeconds % 86400;
  const hours24 = Math.floor(secondOfDay / 3600);
  const minutes = Math.floor((secondOfDay % 3600) / 60);

  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const base = `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;

  if (overflowDays > 0) {
    return `${base} (+${overflowDays})`;
  }
  return base;
}

export function formatDateShort(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function findNextArrival(daySchedules) {
  const now = new Date();
  let best = null;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayKey = JS_DAY_TO_KEY[baseDate.getDay()];
    const times = daySchedules[dayKey] ?? [];

    for (const rawTime of times) {
      const totalSeconds = parseGtfsSeconds(rawTime);
      if (Number.isNaN(totalSeconds)) continue;

      const extraDays = Math.floor(totalSeconds / 86400);
      const secondOfDay = totalSeconds % 86400;
      const candidate = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + extraDays,
        Math.floor(secondOfDay / 3600),
        Math.floor((secondOfDay % 3600) / 60),
        secondOfDay % 60,
      );

      if (candidate < now) continue;
      if (!best || candidate < best.when) {
        best = {
          when: candidate,
          token: `${dayKey}:${rawTime}`,
          dayKey,
          rawTime,
        };
      }
    }
  }

  return best;
}

export function findUpcomingArrivals(daySchedules, maxCount) {
  const now = new Date();
  const candidates = [];

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayKey = JS_DAY_TO_KEY[baseDate.getDay()];
    const times = daySchedules[dayKey] ?? [];

    for (const rawTime of times) {
      const totalSeconds = parseGtfsSeconds(rawTime);
      if (Number.isNaN(totalSeconds)) continue;

      const extraDays = Math.floor(totalSeconds / 86400);
      const secondOfDay = totalSeconds % 86400;
      const candidate = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + extraDays,
        Math.floor(secondOfDay / 3600),
        Math.floor((secondOfDay % 3600) / 60),
        secondOfDay % 60,
      );

      if (candidate < now) continue;
      candidates.push({ candidate, dayKey, rawTime });
    }
  }

  candidates.sort((a, b) => a.candidate - b.candidate);

  return candidates.slice(0, maxCount).map((entry) => {
    const dayLabel = DAY_LABELS[entry.dayKey];
    return `${dayLabel} ${formatGtfsTime(entry.rawTime)}`;
  });
}
