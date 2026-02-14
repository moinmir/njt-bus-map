import type { Manifest, RouteData, ScheduleData } from "@/types";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function loadManifest(): Promise<Manifest> {
  return fetchJson<Manifest>("./data/manifest.json");
}

export async function loadRouteData(filePath: string): Promise<RouteData> {
  return fetchJson<RouteData>(`./data/${filePath}`);
}

export async function loadScheduleData(filePath: string): Promise<ScheduleData | null> {
  if (!filePath) return null;
  return fetchJson<ScheduleData>(`./data/${filePath}`);
}
