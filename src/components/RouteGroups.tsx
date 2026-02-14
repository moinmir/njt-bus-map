import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { AppState, AgencyState, RouteState } from "@/types";

interface RouteGroupsProps {
  state: AppState;
  onToggleRoute: (routeKey: string, selected: boolean) => void;
  onClearAgency: (agencyId: string) => void;
}

interface RouteItemProps {
  routeState: RouteState;
  onToggle: (routeKey: string, selected: boolean) => void;
}

function RouteItem({ routeState, onToggle }: RouteItemProps) {
  const { meta, selected, isVisible } = routeState;

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
  onClearAgency: (agencyId: string) => void;
}

function AgencyGroup({
  agencyState,
  routeStateByKey,
  onToggleRoute,
  onClearAgency,
}: AgencyGroupProps) {
  const { agency, routeKeys } = agencyState;

  const { selectedCount, visibleCount, totalCount } = useMemo(() => {
    let selected = 0;
    let visible = 0;
    for (const key of routeKeys) {
      const rs = routeStateByKey.get(key);
      if (!rs) continue;
      if (rs.selected) selected++;
      if (rs.isVisible) visible++;
    }
    return { selectedCount: selected, visibleCount: visible, totalCount: routeKeys.length };
  }, [routeKeys, routeStateByKey]);

  return (
    <Collapsible defaultOpen className="border border-border rounded-xl bg-background overflow-hidden">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors cursor-pointer group">
        <span className="font-bold text-[0.88rem]">{agency.label}</span>
        <span className="flex items-center gap-2">
          <Badge variant="muted" className="text-[0.72rem] font-normal tabular-nums">
            {selectedCount} / {visibleCount} / {totalCount}
          </Badge>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex justify-end gap-1.5 px-2.5 py-1.5 border-t border-border/60">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onClearAgency(agency.id)}
          >
            Clear Agency
          </Button>
        </div>
        <ScrollArea className="max-h-60">
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
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RouteGroups({ state, onToggleRoute, onClearAgency }: RouteGroupsProps) {
  const agencies = useMemo(() => {
    return [...state.agencyStateById.entries()].map(([id, agencyState]) => ({
      id,
      agencyState,
    }));
  }, [state.agencyStateById]);

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
          onClearAgency={onClearAgency}
        />
      ))}
    </div>
  );
}
