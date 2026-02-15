export interface LiveVehicle {
  id: string;
  agencyId: "princeton" | "njt";
  routeKey: string;
  vehicleId: string;
  label: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speedMps: number | null;
  timestamp: string;
}

export interface LiveVehiclesSourceStatus {
  agencyId: "princeton" | "njt";
  status: "ok" | "error" | "unavailable" | "skipped";
  message?: string;
  vehicleCount: number;
}

export interface LiveVehiclesResponse {
  fetchedAt: string;
  vehicles: LiveVehicle[];
  sources: LiveVehiclesSourceStatus[];
}

export async function loadLiveVehicles(
  routeKeys: string[],
  signal?: AbortSignal,
): Promise<LiveVehiclesResponse> {
  const response = await fetch("/api/live-vehicles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
    signal,
    body: JSON.stringify({ routeKeys }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<LiveVehiclesResponse>;
}
