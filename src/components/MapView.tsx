import { useEffect, useRef } from "react";
import { createBaseMap } from "@/lib/createBaseMap";

interface MapViewProps {
  onMapReady: (map: L.Map) => void;
}

export function MapView({ onMapReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = createBaseMap(containerRef.current);
    mapRef.current = map;
    onMapReady(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // onMapReady is stable (from useRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      role="region"
      aria-label="Map of transit routes"
    />
  );
}
