async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadManifest() {
  return fetchJson("./data/manifest.json");
}

export async function loadRouteData(filePath) {
  return fetchJson(`./data/${filePath}`);
}

export async function loadScheduleData(filePath) {
  if (!filePath) return null;
  return fetchJson(`./data/${filePath}`);
}
