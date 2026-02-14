import { useCallback, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MapView } from "@/components/MapView";
import { MapAreaFilter } from "@/components/MapAreaFilter";
import { useAppState } from "@/hooks/useAppState";
import type { Source } from "@/types";

export default function App() {
  const [state, actions] = useAppState();
  const mapRef = useRef<L.Map | null>(null);
  const [sources, setSources] = useState<Source[]>([]);

  const handleMapReady = useCallback(
    (map: L.Map) => {
      mapRef.current = map;
      actions.init(map)
        .then((manifest) => {
          setSources(manifest.sources ?? []);
        })
        .catch(console.error);
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
    <div className="grid h-dvh grid-cols-[auto_1fr] overflow-hidden">
      <Sidebar
        state={state}
        sources={sources}
        onSearchChange={actions.setSearchTerm}
        onToggleRoute={actions.toggleRoute}
        onClearAll={actions.clearAllRoutes}
        onFitSelected={handleFitSelected}
        onLocateMe={handleLocateMe}
        onSetAgencySelected={actions.setAgencySelected}
        onTogglePanel={actions.togglePanel}
      />

      <main className="relative min-h-0 min-w-0">
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
