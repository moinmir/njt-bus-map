import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface RouteSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function RouteSearch({ value, onChange }: RouteSearchProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search route number or name"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
