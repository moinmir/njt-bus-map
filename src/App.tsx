import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MapView } from "@/components/MapView";
import { MapAreaFilter } from "@/components/MapAreaFilter";
import { useAppState } from "@/hooks/useAppState";
import { MOBILE_LAYOUT_QUERY } from "@/lib/constants";
import type { Source } from "@/types";
import { cn } from "@/lib/utils";

export default function App() {
  const [state, actions] = useAppState();
  const mapRef = useRef<L.Map | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_LAYOUT_QUERY).matches);

  // Track mobile state
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const handleMapReady = useCallback(
    (map: L.Map) => {
      mapRef.current = map;
      actions.init(map).then(() => {
        // Load sources from manifest
        fetch("./data/manifest.json")
          .then((res) => res.json())
          .then((manifest: { sources?: Source[] }) => {
            setSources(manifest.sources ?? []);
          })
          .catch(console.error);
      }).catch(console.error);
    },
    [actions],
  );

  const handleFitSelected = useCallback(() => {
    if (mapRef.current) actions.fitSelectedRoutes(mapRef.current);
  }, [actions]);

  const handleLocateMe = useCallback(() => {
    if (mapRef.current) actions.locateUser(mapRef.current);
  }, [actions]);

  const handleSearchArea = useCallback(() => {
    if (mapRef.current) actions.applyAreaFilter(mapRef.current);
  }, [actions]);

  const handleClearArea = useCallback(() => {
    actions.clearAreaFilter();
  }, [actions]);

  return (
    <div
      className={cn(
        "grid h-dvh",
        isMobile ? "grid-cols-1 grid-rows-[auto_1fr]" : "grid-cols-[auto_1fr]",
      )}
    >
      <Sidebar
        state={state}
        sources={sources}
        isMobile={isMobile}
        onSearchChange={actions.setSearchTerm}
        onToggleRoute={actions.toggleRoute}
        onClearAll={actions.clearAllRoutes}
        onFitSelected={handleFitSelected}
        onLocateMe={handleLocateMe}
        onClearAgency={actions.clearAgency}
        onTogglePanel={actions.togglePanel}
      />

      <main className="relative min-w-0">
        <MapView onMapReady={handleMapReady} />
        <MapAreaFilter
          activeAreaBounds={state.activeAreaBounds}
          areaSelectionInProgress={state.areaSelectionInProgress}
          onSearchArea={handleSearchArea}
          onClearArea={handleClearArea}
        />
      </main>
    </div>
  );
}
