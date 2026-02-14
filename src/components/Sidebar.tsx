import { DesktopSidebar } from "./DesktopSidebar";
import type { AppState, Source } from "@/types";

interface SidebarProps {
  state: AppState;
  sources: Source[];
  onSearchChange: (term: string) => void;
  onToggleRoute: (routeKey: string, selected: boolean) => void;
  onClearAll: () => void;
  onFitSelected: () => void;
  onLocateMe: () => void;
  onSetAgencySelected: (agencyId: string, selected: boolean) => void;
  onTogglePanel: () => void;
}

export function Sidebar({ state, onTogglePanel, ...rest }: SidebarProps) {
  const collapsed = state.mobilePanelCollapsed;

  const contentProps = { state, ...rest };

  return (
    <DesktopSidebar
      collapsed={collapsed}
      onTogglePanel={onTogglePanel}
      {...contentProps}
    />
  );
}
