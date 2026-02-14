import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarContent, type SidebarContentProps } from "./SidebarContent";
import { cn } from "@/lib/utils";

interface DesktopSidebarProps extends SidebarContentProps {
  collapsed: boolean;
  onTogglePanel: () => void;
}

export function DesktopSidebar({
  collapsed,
  onTogglePanel,
  ...contentProps
}: DesktopSidebarProps) {
  const asideClassName = collapsed
    ? "w-0 min-w-0 overflow-visible border-r-0 bg-transparent shadow-none pointer-events-none"
    : "w-[min(390px,88vw)] overflow-hidden border-r border-border bg-white/90 backdrop-blur-md shadow-xl flex flex-col";

  return (
    <aside
      className={cn(
        "relative h-full min-h-0 transition-all duration-200 ease-out",
        asideClassName,
      )}
      aria-label="Route controls"
    >
      {/* Toggle button — always visible at the top */}
      <div
        className={cn(
          "z-[1200]",
          collapsed
            ? "pointer-events-auto absolute left-3 top-3"
            : "flex items-center justify-end p-2",
        )}
      >
        <button
          onClick={onTogglePanel}
          className={cn(
            "flex items-center justify-center transition-colors cursor-pointer",
            collapsed
              ? "h-10 w-10 rounded-full border border-border/70 bg-white/95 text-foreground shadow-lg backdrop-blur-sm hover:bg-white"
              : "h-8 w-8 rounded-lg border border-border bg-secondary text-secondary-foreground hover:bg-accent",
          )}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="px-4 pb-4">
            <SidebarContent {...contentProps} />
          </div>
        </div>
      )}
    </aside>
  );
}
