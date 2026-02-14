import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  return (
    <aside
      className={cn(
        "relative bg-white/90 backdrop-blur-md border-r border-border shadow-xl",
        "transition-all duration-200 ease-out flex flex-col",
        collapsed ? "w-12" : "w-[390px]",
      )}
      aria-label="Route controls"
    >
      {/* Toggle button — always visible at the top */}
      <div className={cn("flex items-center p-2", collapsed ? "justify-center" : "justify-end")}>
        <button
          onClick={onTogglePanel}
          className={cn(
            "flex items-center justify-center rounded-lg",
            "h-8 w-8 border border-border bg-secondary text-secondary-foreground",
            "hover:bg-accent transition-colors cursor-pointer",
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
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 pb-4">
            <SidebarContent {...contentProps} />
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
