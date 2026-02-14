import { ChevronUp } from "lucide-react";
import { SidebarContent, type SidebarContentProps } from "./SidebarContent";
import { cn } from "@/lib/utils";

interface MobileSidebarProps extends SidebarContentProps {
  collapsed: boolean;
  onTogglePanel: () => void;
}

export function MobileSidebar({
  collapsed,
  onTogglePanel,
  ...contentProps
}: MobileSidebarProps) {
  return (
    <aside
      className={cn(
        "relative bg-white/90 backdrop-blur-md border-b border-border shadow-lg",
        "transition-all duration-200 ease-out flex flex-col overflow-hidden",
        collapsed ? "max-h-12" : "max-h-[56dvh]",
      )}
      aria-label="Route controls"
    >
      {/* Header bar — always visible, acts as the toggle */}
      <button
        onClick={onTogglePanel}
        type="button"
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 w-full text-left shrink-0",
          "hover:bg-accent/30 transition-colors cursor-pointer",
          !collapsed && "border-b border-border/60",
        )}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand route controls" : "Collapse route controls"}
      >
        <ChevronUp
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200",
            collapsed && "rotate-180",
          )}
        />
        <span className="text-sm font-bold font-[Sora,sans-serif] tracking-tight truncate">
          NJ + Princeton Transit Explorer
        </span>
      </button>

      {/* Expanded content */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <SidebarContent {...contentProps} />
          </div>
        </div>
      )}
    </aside>
  );
}
