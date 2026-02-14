import { useState, useCallback } from "react";
import { ChevronLeft, ChevronDown, MapPin, Maximize2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RouteSearch } from "./RouteSearch";
import { RouteGroups } from "./RouteGroups";
import { StatusSection } from "./StatusSection";
import { DataSources } from "./DataSources";
import { cn } from "@/lib/utils";
import type { AppState, Source } from "@/types";

interface SidebarProps {
  state: AppState;
  sources: Source[];
  isMobile: boolean;
  onSearchChange: (term: string) => void;
  onToggleRoute: (routeKey: string, selected: boolean) => void;
  onClearAll: () => void;
  onFitSelected: () => void;
  onLocateMe: () => void;
  onClearAgency: (agencyId: string) => void;
  onTogglePanel: () => void;
}

export function Sidebar({
  state,
  sources,
  isMobile,
  onSearchChange,
  onToggleRoute,
  onClearAll,
  onFitSelected,
  onLocateMe,
  onClearAgency,
  onTogglePanel,
}: SidebarProps) {
  const collapsed = state.mobilePanelCollapsed;
  const [searchValue, setSearchValue] = useState("");

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      onSearchChange(value);
    },
    [onSearchChange],
  );

  return (
    <aside
      className={cn(
        "relative bg-white/90 backdrop-blur-md border-r border-border shadow-xl transition-all duration-200 ease-out flex flex-col",
        // Desktop
        !isMobile && !collapsed && "w-[390px]",
        !isMobile && collapsed && "w-12",
        // Mobile
        isMobile && !collapsed && "w-full max-h-[56dvh] border-r-0 border-b border-border",
        isMobile && collapsed && "w-full max-h-14 border-r-0 border-b border-border overflow-hidden",
      )}
      aria-label="Route controls"
    >
      {/* Toggle button */}
      <button
        onClick={onTogglePanel}
        className={cn(
          "absolute z-10 flex items-center justify-center rounded-full",
          "h-7 w-7 border border-border bg-secondary text-secondary-foreground",
          "hover:bg-accent transition-colors cursor-pointer",
          !isMobile && "top-3 right-2",
          isMobile && "top-2.5 right-3",
        )}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand controls sidebar" : "Collapse controls sidebar"}
      >
        {isMobile ? (
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              collapsed && "rotate-180",
            )}
          />
        ) : (
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              collapsed && "rotate-180",
            )}
          />
        )}
      </button>

      {/* Collapsed state: show nothing else (or just title on mobile) */}
      {collapsed && isMobile && (
        <div className="px-4 py-3 pr-12">
          <h1 className="text-base font-bold font-[Sora,sans-serif] tracking-tight truncate">
            NJ + Princeton Transit Explorer
          </h1>
        </div>
      )}

      {/* Expanded content */}
      {!collapsed && (
        <ScrollArea className="flex-1 min-h-0">
          <div className={cn("p-4 space-y-4", isMobile && "pb-[calc(1rem+env(safe-area-inset-bottom))]")}>
            {/* Header */}
            <div className="pr-8">
              <h1 className="text-lg font-bold font-[Sora,sans-serif] tracking-tight leading-tight">
                NJ + Princeton Transit Explorer
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground leading-snug">
                Official GTFS-backed map for all NJ Transit bus routes plus Princeton transit
                routes (TigerTransit, Princeton Loop, Weekend Shopper).
              </p>
            </div>

            {/* Search */}
            <section className="rounded-xl border border-border bg-white/80 p-3 space-y-2">
              <h2 className="text-sm font-semibold font-[Sora,sans-serif]">Search</h2>
              <RouteSearch value={searchValue} onChange={handleSearchChange} />
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
                onClearAgency={onClearAgency}
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
                <h2 className="text-sm font-semibold font-[Sora,sans-serif]">Data Sources</h2>
                <DataSources sources={sources} />
              </section>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
