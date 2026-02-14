import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import type { AreaBounds } from "@/types";

interface MapAreaFilterProps {
  activeAreaBounds: AreaBounds | null;
  areaSelectionInProgress: boolean;
  onSearchArea: () => void;
  onClearArea: () => void;
}

export function MapAreaFilter({
  activeAreaBounds,
  areaSelectionInProgress,
  onSearchArea,
  onClearArea,
}: MapAreaFilterProps) {
  const areaFilterActive = Boolean(activeAreaBounds);

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1100] flex gap-2 pointer-events-none">
      <Button
        variant="outline"
        size="sm"
        className="pointer-events-auto rounded-full bg-white/95 shadow-lg border-border/50 backdrop-blur-sm text-foreground font-semibold text-xs"
        disabled={areaSelectionInProgress}
        onClick={onSearchArea}
      >
        <Search className="h-3.5 w-3.5" />
        {areaFilterActive ? "Search this area again" : "Search this area"}
      </Button>
      {(areaFilterActive || areaSelectionInProgress) && (
        <Button
          variant="outline"
          size="icon"
          className="pointer-events-auto rounded-full bg-white/95 shadow-lg border-border/50 backdrop-blur-sm h-7 w-7"
          disabled={areaSelectionInProgress}
          onClick={onClearArea}
          aria-label="Clear area and deselect all routes"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
