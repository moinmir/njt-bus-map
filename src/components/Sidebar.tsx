import { DesktopSidebar } from "./DesktopSidebar";
import { MobileSidebar } from "./MobileSidebar";
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

export function Sidebar({ isMobile, state, onTogglePanel, ...rest }: SidebarProps) {
  const collapsed = state.mobilePanelCollapsed;

  const contentProps = { state, ...rest };

  if (isMobile) {
    return (
      <MobileSidebar
        collapsed={collapsed}
        onTogglePanel={onTogglePanel}
        {...contentProps}
      />
    );
  }

  return (
    <DesktopSidebar
      collapsed={collapsed}
      onTogglePanel={onTogglePanel}
      {...contentProps}
    />
  );
}
