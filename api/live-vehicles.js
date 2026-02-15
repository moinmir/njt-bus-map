import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const TRIPSHOT_LIVE_STATUS_URL = "https://princeton.tripshot.com/v1/p/liveStatus";
const TRIPSHOT_STATUS_MAX_AGE_MS = 15 * 60 * 1000;
const NJT_VEHICLE_POSITIONS_URL = "https://api.njtransit.com/gtfsrt/getvehiclepositionsfeed";
const NJT_STATUS_MAX_AGE_SECONDS = 20 * 60;
const REQUEST_TIMEOUT_MS = 10_000;

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getRouteKeys(input) {
  if (!Array.isArray(input)) return [];

  const unique = new Set();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return [...unique];
}

function extractAgencyRouteIds(routeKeys, agencyId) {
  const prefix = `${agencyId}:`;
  const ids = [];
  for (const routeKey of routeKeys) {
    if (!routeKey.startsWith(prefix)) continue;
    const routeId = routeKey.slice(prefix.length).trim();
    if (!routeId) continue;
    ids.push(routeId);
  }
  return ids;
}

function toFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null && typeof value.toNumber === "function") {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBearing(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  const normalized = ((numeric % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : null;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function tripshotRideStateKey(stateValue) {
  if (!stateValue || typeof stateValue !== "object") return "";
  const keys = Object.keys(stateValue);
  return keys.length > 0 ? keys[0] : "";
}

function tripshotRouteScore(ride) {
  const stateKey = tripshotRideStateKey(ride?.state);
  let score = 1;

  if (stateKey === "Active") score += 100;
  else if (stateKey === "Accepted") score += 70;
  else if (stateKey === "Scheduled") score += 40;

  if (ride?.liveDataAvailable === true) score += 20;

  return score;
}

function bestRouteIdByVehicleFromRides(rides, selectedRouteIdSet) {
  const routeScoresByVehicle = new Map();

  for (const ride of rides ?? []) {
    const vehicleId = typeof ride?.vehicleId === "string" ? ride.vehicleId : "";
    const routeId = typeof ride?.routeId === "string" ? ride.routeId : "";
    if (!vehicleId || !routeId || !selectedRouteIdSet.has(routeId)) continue;

    const perVehicle = routeScoresByVehicle.get(vehicleId) ?? new Map();
    const nextScore = (perVehicle.get(routeId) ?? 0) + tripshotRouteScore(ride);
    perVehicle.set(routeId, nextScore);
    routeScoresByVehicle.set(vehicleId, perVehicle);
  }

  const bestRouteIdByVehicle = new Map();
  for (const [vehicleId, routeScores] of routeScoresByVehicle.entries()) {
    let bestRouteId = "";
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const [routeId, score] of routeScores.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestRouteId = routeId;
      }
    }

    if (bestRouteId) {
      bestRouteIdByVehicle.set(vehicleId, bestRouteId);
    }
  }

  return bestRouteIdByVehicle;
}

async function loadPrincetonVehicles(selectedRouteIds) {
  const selectedRouteIdSet = new Set(selectedRouteIds);

  if (selectedRouteIdSet.size === 0) {
    return {
      vehicles: [],
      source: { agencyId: "princeton", status: "skipped", vehicleCount: 0 },
    };
  }

  try {
    const response = await fetchWithTimeout(TRIPSHOT_LIVE_STATUS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const detail = `${response.status} ${response.statusText}`.trim();
      return {
        vehicles: [],
        source: {
          agencyId: "princeton",
          status: "error",
          message: `TripShot response error: ${detail}`,
          vehicleCount: 0,
        },
      };
    }

    const payload = await response.json();
    const rides = Array.isArray(payload?.rides) ? payload.rides : [];
    const statuses = Array.isArray(payload?.vehicleStatuses) ? payload.vehicleStatuses : [];
    const vehicles = Array.isArray(payload?.vehicles) ? payload.vehicles : [];

    const vehicleNameById = new Map();
    for (const vehicle of vehicles) {
      if (typeof vehicle?.vehicleId !== "string") continue;
      if (typeof vehicle?.name !== "string") continue;
      vehicleNameById.set(vehicle.vehicleId, vehicle.name);
    }

    const routeIdByVehicleId = bestRouteIdByVehicleFromRides(rides, selectedRouteIdSet);
    const nowMs = Date.now();

    const normalizedVehicles = [];
    for (const status of statuses) {
      const vehicleId = typeof status?.vehicleId === "string" ? status.vehicleId : "";
      if (!vehicleId) continue;
      if (status?.liveDataAvailable !== true) continue;

      const routeId = routeIdByVehicleId.get(vehicleId);
      if (!routeId) continue;

      const latitude = toFiniteNumber(status?.location?.lt);
      const longitude = toFiniteNumber(status?.location?.lg);
      if (latitude === null || longitude === null) continue;

      const timestampMs = Date.parse(String(status?.when ?? ""));
      if (!Number.isFinite(timestampMs)) continue;
      if (nowMs - timestampMs > TRIPSHOT_STATUS_MAX_AGE_MS) continue;

      const routeKey = `princeton:${routeId}`;
      const label =
        (typeof status?.name === "string" && status.name.trim()) ||
        vehicleNameById.get(vehicleId) ||
        vehicleId;

      normalizedVehicles.push({
        id: `princeton:${vehicleId}`,
        agencyId: "princeton",
        routeKey,
        vehicleId,
        label,
        latitude,
        longitude,
        bearing: normalizeBearing(status?.bearing),
        speedMps: toFiniteNumber(status?.speed),
        timestamp: new Date(timestampMs).toISOString(),
      });
    }

    return {
      vehicles: normalizedVehicles,
      source: {
        agencyId: "princeton",
        status: "ok",
        vehicleCount: normalizedVehicles.length,
      },
    };
  } catch (error) {
    return {
      vehicles: [],
      source: {
        agencyId: "princeton",
        status: "error",
        message: error instanceof Error ? error.message : "TripShot request failed",
        vehicleCount: 0,
      },
    };
  }
}

function getNjtApiKey() {
  return process.env.NJT_API_KEY || process.env.NJT_GTFSRT_API_KEY || "";
}

async function loadNjtVehicles(selectedRouteIds) {
  const selectedRouteKeySet = new Set(selectedRouteIds.map((routeId) => `njt:${routeId}`));

  if (selectedRouteKeySet.size === 0) {
    return {
      vehicles: [],
      source: { agencyId: "njt", status: "skipped", vehicleCount: 0 },
    };
  }

  const apiKey = getNjtApiKey();
  if (!apiKey) {
    return {
      vehicles: [],
      source: {
        agencyId: "njt",
        status: "unavailable",
        message: "NJT_API_KEY is not configured",
        vehicleCount: 0,
      },
    };
  }

  const url = `${NJT_VEHICLE_POSITIONS_URL}?apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/x-protobuf, application/octet-stream, application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      const detail = `${response.status} ${response.statusText}`.trim();
      const message = text ? `${detail} - ${text.slice(0, 240)}` : detail;
      return {
        vehicles: [],
        source: {
          agencyId: "njt",
          status: "error",
          message: `NJT GTFS-RT response error: ${message}`,
          vehicleCount: 0,
        },
      };
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    const nowSeconds = Math.floor(Date.now() / 1000);
    const nowIso = new Date().toISOString();

    const normalizedVehicles = [];
    for (const entity of feed?.entity ?? []) {
      const vehicle = entity?.vehicle;
      const trip = vehicle?.trip;
      const position = vehicle?.position;

      if (!trip?.routeId || !position) continue;

      const routeKey = `njt:${String(trip.routeId)}`;
      if (!selectedRouteKeySet.has(routeKey)) continue;

      const latitude = toFiniteNumber(position.latitude);
      const longitude = toFiniteNumber(position.longitude);
      if (latitude === null || longitude === null) continue;

      const timestampSeconds = toFiniteNumber(vehicle.timestamp);
      if (
        timestampSeconds !== null &&
        nowSeconds - timestampSeconds > NJT_STATUS_MAX_AGE_SECONDS
      ) {
        continue;
      }

      const vehicleDescriptor = vehicle.vehicle ?? {};
      const vehicleId = String(
        vehicleDescriptor.id ||
          entity.id ||
          `${routeKey}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`,
      );
      const label = String(vehicleDescriptor.label || vehicleId);

      normalizedVehicles.push({
        id: `njt:${vehicleId}`,
        agencyId: "njt",
        routeKey,
        vehicleId,
        label,
        latitude,
        longitude,
        bearing: normalizeBearing(position.bearing),
        speedMps: toFiniteNumber(position.speed),
        timestamp:
          timestampSeconds !== null
            ? new Date(timestampSeconds * 1000).toISOString()
            : nowIso,
      });
    }

    return {
      vehicles: normalizedVehicles,
      source: {
        agencyId: "njt",
        status: "ok",
        vehicleCount: normalizedVehicles.length,
      },
    };
  } catch (error) {
    return {
      vehicles: [],
      source: {
        agencyId: "njt",
        status: "error",
        message: error instanceof Error ? error.message : "NJT GTFS-RT request failed",
        vehicleCount: 0,
      },
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const body = await readJsonBody(req);
  const routeKeys = getRouteKeys(body?.routeKeys);

  if (routeKeys.length === 0) {
    return jsonResponse(res, 200, {
      fetchedAt: new Date().toISOString(),
      vehicles: [],
      sources: [],
    });
  }

  const princetonRouteIds = extractAgencyRouteIds(routeKeys, "princeton");
  const njtRouteIds = extractAgencyRouteIds(routeKeys, "njt");

  const [princetonResult, njtResult] = await Promise.all([
    loadPrincetonVehicles(princetonRouteIds),
    loadNjtVehicles(njtRouteIds),
  ]);

  return jsonResponse(res, 200, {
    fetchedAt: new Date().toISOString(),
    vehicles: [...princetonResult.vehicles, ...njtResult.vehicles],
    sources: [princetonResult.source, njtResult.source],
  });
}
