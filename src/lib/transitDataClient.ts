import type { Manifest, RouteData, ScheduleData } from "@/types";

let activeDataRevision = "";

function withDataRevision(path: string): string {
  if (!activeDataRevision) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(activeDataRevision)}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function loadManifest(): Promise<Manifest> {
  const manifest = await fetchJson<Manifest>("./data/manifest.json", { cache: "no-store" });
  activeDataRevision = manifest.generatedAt || "";
  return manifest;
}

export async function loadRouteData(filePath: string): Promise<RouteData> {
  return fetchJson<RouteData>(withDataRevision(`./data/${filePath}`));
}

export async function loadScheduleData(filePath: string): Promise<ScheduleData | null> {
  if (!filePath) return null;
  return fetchJson<ScheduleData>(withDataRevision(`./data/${filePath}`));
}
