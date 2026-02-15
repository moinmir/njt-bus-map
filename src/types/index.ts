import type L from "leaflet";

/* ── Manifest & route metadata ── */

export interface Agency {
  id: string;
  label: string;
  description: string;
}

export interface Source {
  agencyId: string;
  agencyLabel: string;
  description: string;
  gtfsUrl: string;
  gtfsZip: string;
  feedUpdatedAt: string;
}

export type RouteBounds = [[number, number], [number, number]];

export interface RouteMeta {
  key: string;
  agencyId: string;
  agencyLabel: string;
  routeId: string;
  shortName: string;
  longName: string;
  routeDesc: string;
  label: string;
  color: string;
  tripCount: number;
  stopCount: number;
  shapeCount: number;
  bounds: RouteBounds;
  file: string;
  searchText: string;
  scheduleFile?: string;
}

export interface Manifest {
  generatedAt: string;
  timezone: string;
  agencies: Agency[];
  sources: Source[];
  routeCount: number;
  routes: RouteMeta[];
}

/* ── Route geometry & schedule data ── */

export interface ShapeData {
  shapeId: string;
  directionKeys: string[];
  points: [number, number][];
}

export interface StopData {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  serviceScheduleByDirection?: Record<string, Record<string, string[]>>;
  _daySchedulesByDirection?: Record<string, Record<string, string[]>>;
}

export interface RouteData {
  shapes?: ShapeData[];
  stops?: StopData[];
  scheduleFile?: string;
  directionLabels?: Record<string, string>;
  activeServicesByDayByDirection?: Record<string, Record<string, string[]>>;
  representativeDates?: Record<string, string>;
}

export interface ScheduleData {
  daySchedulesByStopByDirection?: Record<string, Record<string, Record<string, string[]>>>;
  directionLabels?: Record<string, string>;
  representativeDates?: Record<string, string>;
}

/* ── Application state ── */

export interface RouteState {
  meta: RouteMeta;
  selected: boolean;
  isVisible: boolean;
  layer: L.LayerGroup | null;
  routeData: RouteData | null;
  scheduleData: ScheduleData | null;
  loadPromise: Promise<void> | null;
  scheduleLoadPromise: Promise<ScheduleData | null> | null;
}

export interface AgencyState {
  agency: Agency;
  routeKeys: string[];
}

export interface AreaBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface AppState {
  routeStateByKey: Map<string, RouteState>;
  agencyStateById: Map<string, AgencyState>;
  selectedRouteKeys: Set<string>;
  activeSearchTerm: string;
  activeAreaBounds: AreaBounds | null;
  userLocationLayer: L.LayerGroup | null;
  mobilePanelCollapsed: boolean;
  areaSelectionInProgress: boolean;
}

/* ── Day schedule helpers ── */

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type DaySchedules = Record<DayKey, string[]>;

export interface NextArrival {
  when: Date;
  token: string;
  dayKey: DayKey;
  rawTime: string;
}

/* ── Route selection manager ── */

export interface SetRouteKeysOptions {
  concurrency?: number;
  refreshUiAtEnd?: boolean;
  statusText?: string;
}

export interface RouteSelectionManager {
  setRouteSelection: (routeKey: string, selected: boolean) => Promise<void>;
  setRouteKeysSelected: (
    keys: string[],
    selected: boolean,
    options?: SetRouteKeysOptions,
  ) => Promise<void>;
}

export interface LiveVehicleLayerManager {
  setSelectedRouteKeys: (routeKeys: Iterable<string>) => void;
  destroy: () => void;
}
