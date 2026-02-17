import { useEffect, useRef } from "react";
import { createBaseMap } from "@/lib/createBaseMap";

interface MapViewProps {
  onMapReady: (map: L.Map) => void;
  onLocateRequest: () => void;
}

export function MapView({ onMapReady, onLocateRequest }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = createBaseMap(containerRef.current, { onLocateRequest });
    mapRef.current = map;
    onMapReady(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Parent passes stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      role="region"
      aria-label="Map of transit routes and rail lines"
    />
  );
}
