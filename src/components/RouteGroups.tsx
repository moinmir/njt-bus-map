import { useEffect, useRef } from "react";
import { BusFront, ChevronDown, TrainFront } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { AppState, AgencyState, RouteState } from "@/types";

interface RouteGroupsProps {
  state: AppState;
  onToggleRoute: (routeKey: string, selected: boolean) => void;
  onSetAgencySelected: (agencyId: string, selected: boolean) => void;
}

interface RouteItemProps {
  routeState: RouteState;
  onToggle: (routeKey: string, selected: boolean) => void;
}

function RouteItem({ routeState, onToggle }: RouteItemProps) {
  const { meta, selected, isVisible } = routeState;
  const ModeIcon = meta.mode === "rail" ? TrainFront : BusFront;

  if (!isVisible) return null;

  return (
    <label
      className={cn(
        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/60 bg-background",
        "cursor-pointer transition-colors duration-100",
        "hover:bg-accent/50",
        selected && "border-primary/30 bg-primary/5",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onToggle(meta.key, e.target.checked)}
        className="h-4 w-4 rounded accent-primary cursor-pointer shrink-0"
      />
      <span
        className="h-3 w-3 rounded-full shrink-0 border border-black/10"
        style={{ background: meta.color }}
      />
      <ModeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.82rem] font-semibold leading-tight text-foreground truncate">
          {meta.shortName}
        </span>
        {(meta.longName || meta.stopCount) && (
          <span className="block text-[0.72rem] leading-tight text-muted-foreground truncate">
            {meta.stopCount} stops{meta.longName ? ` - ${meta.longName}` : ""}
          </span>
        )}
      </span>
    </label>
  );
}

interface AgencyGroupProps {
  agencyState: AgencyState;
  routeStateByKey: Map<string, RouteState>;
  onToggleRoute: (routeKey: string, selected: boolean) => void;
  onSetAgencySelected: (agencyId: string, selected: boolean) => void;
}

function AgencyGroup({
  agencyState,
  routeStateByKey,
  onToggleRoute,
  onSetAgencySelected,
}: AgencyGroupProps) {
  const { agency, routeKeys } = agencyState;

  let selectedCount = 0;
  for (const key of routeKeys) {
    const rs = routeStateByKey.get(key);
    if (!rs) continue;
    if (rs.selected) selectedCount += 1;
  }
  const totalCount = routeKeys.length;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const partiallySelected = selectedCount > 0 && selectedCount < totalCount;
  const checkboxRef = useRef<HTMLInputElement>(null);
  const nextSelectionState = selectedCount === 0;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  return (
    <Collapsible defaultOpen className="border border-border rounded-xl bg-background overflow-hidden">
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 cursor-pointer">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={allSelected}
            onChange={() => onSetAgencySelected(agency.id, nextSelectionState)}
            className="h-4 w-4 rounded accent-primary cursor-pointer shrink-0"
            aria-label={`Toggle all routes for ${agency.label}`}
          />
          <span className="font-bold text-[0.88rem] truncate">{agency.label}</span>
        </label>
        <span className="flex items-center gap-2">
          <Badge variant="muted" className="text-[0.72rem] font-normal tabular-nums">
            {selectedCount} / {totalCount}
          </Badge>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group inline-flex items-center justify-center rounded-md p-1 hover:bg-accent/60 transition-colors cursor-pointer"
              aria-label={`Toggle ${agency.label} routes`}
            >
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
        </span>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border/60" />
        <div className="max-h-60 overflow-y-auto">
          <div className="grid gap-1.5 p-2" aria-live="polite">
            {routeKeys.map((key) => {
              const rs = routeStateByKey.get(key);
              if (!rs) return null;
              return (
                <RouteItem
                  key={key}
                  routeState={rs}
                  onToggle={onToggleRoute}
                />
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RouteGroups({ state, onToggleRoute, onSetAgencySelected }: RouteGroupsProps) {
  const agencies = [...state.agencyStateById.entries()].map(([id, agencyState]) => ({
    id,
    agencyState,
  }));

  if (agencies.length === 0) {
    return <div className="text-muted-foreground text-sm py-2">Loading routes...</div>;
  }

  return (
    <div className="grid gap-2.5">
      {agencies.map(({ id, agencyState }) => (
        <AgencyGroup
          key={id}
          agencyState={agencyState}
          routeStateByKey={state.routeStateByKey}
          onToggleRoute={onToggleRoute}
          onSetAgencySelected={onSetAgencySelected}
        />
      ))}
    </div>
  );
}
