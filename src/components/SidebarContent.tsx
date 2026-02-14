import { useCallback } from "react";
import { MapPin, Maximize2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSearch } from "./RouteSearch";
import { RouteGroups } from "./RouteGroups";
import { StatusSection } from "./StatusSection";
import { DataSources } from "./DataSources";
import type { AppState, Source } from "@/types";

export interface SidebarContentProps {
  state: AppState;
  sources: Source[];
  onSearchChange: (term: string) => void;
  onToggleRoute: (routeKey: string, selected: boolean) => void;
  onClearAll: () => void;
  onFitSelected: () => void;
  onLocateMe: () => void;
  onSetAgencySelected: (agencyId: string, selected: boolean) => void;
}

export function SidebarContent({
  state,
  sources,
  onSearchChange,
  onToggleRoute,
  onClearAll,
  onFitSelected,
  onLocateMe,
  onSetAgencySelected,
}: SidebarContentProps) {
  const handleSearchChange = useCallback(
    (value: string) => {
      onSearchChange(value);
    },
    [onSearchChange],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold font-[Sora,sans-serif] tracking-tight leading-tight">
          NJ + Princeton Transit Explorer
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground leading-snug">
          Official GTFS-backed map for all NJ Transit bus routes plus Princeton
          transit routes (TigerTransit, Princeton Loop, Weekend Shopper).
        </p>
      </div>

      {/* Search */}
      <section className="rounded-xl border border-border bg-white/80 p-3 space-y-2">
        <h2 className="text-sm font-semibold font-[Sora,sans-serif]">Search</h2>
        <RouteSearch value={state.activeSearchTerm} onChange={handleSearchChange} />
      </section>

      {/* Routes */}
      <section className="rounded-xl border border-border bg-white/80 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold font-[Sora,sans-serif]">Routes</h2>
          <Button variant="secondary" size="sm" onClick={onClearAll}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear All
          </Button>
        </div>

        <RouteGroups
          state={state}
          onToggleRoute={onToggleRoute}
          onSetAgencySelected={onSetAgencySelected}
        />

        <div className="grid gap-2 pt-1">
          <Button onClick={onFitSelected} size="default" className="w-full">
            <Maximize2 className="h-4 w-4" />
            Fit Selected Routes
          </Button>
          <Button
            variant="secondary"
            size="default"
            onClick={onLocateMe}
            className="w-full"
          >
            <MapPin className="h-4 w-4" />
            Use My Location
          </Button>
        </div>
      </section>

      {/* Status */}
      <section className="rounded-xl border border-border bg-white/80 p-3 space-y-2">
        <h2 className="text-sm font-semibold font-[Sora,sans-serif]">Status</h2>
        <StatusSection state={state} />
      </section>

      {/* Data Sources */}
      {sources.length > 0 && (
        <section className="rounded-xl border border-border bg-white/80 p-3 space-y-2">
          <h2 className="text-sm font-semibold font-[Sora,sans-serif]">
            Data Sources
          </h2>
          <DataSources sources={sources} />
        </section>
      )}
    </div>
  );
}
