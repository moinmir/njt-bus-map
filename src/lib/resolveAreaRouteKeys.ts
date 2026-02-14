import { routeIntersectsArea } from "./routeAreaMatching";
import { loadRouteData } from "./transitDataClient";
import type { AreaBounds, RouteState } from "@/types";

interface ResolveAreaRouteKeysParams {
  routeKeys: string[];
  routeStateByKey: Map<string, RouteState>;
  areaBounds: AreaBounds;
  concurrency?: number;
}

async function ensureRouteDataLoaded(routeState: RouteState): Promise<void> {
  if (routeState.routeData) return;

  if (routeState.loadPromise) {
    await routeState.loadPromise;
    return;
  }

  routeState.routeData = await loadRouteData(routeState.meta.file);
}

async function routeKeyMatchesArea(
  routeState: RouteState,
  areaBounds: AreaBounds,
): Promise<boolean> {
  try {
    await ensureRouteDataLoaded(routeState);
    return routeIntersectsArea(routeState.meta.bounds, routeState.routeData, areaBounds);
  } catch (error) {
    console.warn(`Failed to evaluate route ${routeState.meta.shortName} for area match`, error);
    return false;
  }
}

export async function resolveAreaRouteKeys({
  routeKeys,
  routeStateByKey,
  areaBounds,
  concurrency = 8,
}: ResolveAreaRouteKeysParams): Promise<string[]> {
  if (routeKeys.length === 0) return [];

  const queue = [...routeKeys];
  const matchingKeys = new Set<string>();
  const workerCount = Math.max(1, Math.min(concurrency, routeKeys.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const routeKey = queue.shift();
      if (!routeKey) continue;

      const routeState = routeStateByKey.get(routeKey);
      if (!routeState) continue;

      if (await routeKeyMatchesArea(routeState, areaBounds)) {
        matchingKeys.add(routeKey);
      }
    }
  });

  await Promise.all(workers);

  return routeKeys.filter((key) => matchingKeys.has(key));
}
