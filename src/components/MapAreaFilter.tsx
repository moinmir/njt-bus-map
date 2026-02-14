import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import type { AreaBounds } from "@/types";

interface MapAreaFilterProps {
  activeAreaBounds: AreaBounds | null;
  areaSelectionInProgress: boolean;
  onSearchArea: () => void;
  onClearArea: () => void;
}

const MAP_OVERLAY_HORIZONTAL_MARGIN_PX = 24;

function resolveOverlayViewport(element: HTMLElement): HTMLElement | null {
  if (element.offsetParent instanceof HTMLElement) {
    return element.offsetParent;
  }
  return element.parentElement;
}

export function MapAreaFilter({
  activeAreaBounds,
  areaSelectionInProgress,
  onSearchArea,
  onClearArea,
}: MapAreaFilterProps) {
  const areaFilterActive = Boolean(activeAreaBounds);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasHorizontalSpace, setHasHorizontalSpace] = useState(true);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let animationFrameId: number | null = null;

    const updateVisibility = () => {
      const viewport = resolveOverlayViewport(element);
      if (!viewport) return;

      const requiredWidth = element.scrollWidth + MAP_OVERLAY_HORIZONTAL_MARGIN_PX;
      const nextHasHorizontalSpace = viewport.clientWidth >= requiredWidth;
      setHasHorizontalSpace((current) =>
        current === nextHasHorizontalSpace ? current : nextHasHorizontalSpace,
      );
    };

    const scheduleUpdate = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updateVisibility();
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(element);
    const viewport = resolveOverlayViewport(element);
    if (viewport) {
      resizeObserver?.observe(viewport);
    }

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [areaFilterActive, areaSelectionInProgress]);

  return (
    <div
      ref={containerRef}
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1100] flex gap-2 pointer-events-none ${
        hasHorizontalSpace ? "" : "invisible"
      }`}
      aria-hidden={!hasHorizontalSpace}
    >
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
