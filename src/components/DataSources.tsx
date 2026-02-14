import type { Source } from "@/types";

interface DataSourcesProps {
  sources: Source[];
}

export function DataSources({ sources }: DataSourcesProps) {
  if (sources.length === 0) return null;

  return (
    <div className="grid gap-3">
      {sources.map((source) => {
        const updatedAt = source.feedUpdatedAt
          ? new Date(source.feedUpdatedAt).toLocaleString()
          : "Unknown";

        return (
          <div key={source.agencyId} className="text-sm">
            <p className="font-semibold">{source.agencyLabel}</p>
            {source.description && (
              <p className="text-muted-foreground">{source.description}</p>
            )}
            <p>
              <a
                href={source.gtfsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 break-all"
              >
                {source.gtfsUrl}
              </a>
            </p>
            <p className="text-muted-foreground">Feed updated: {updatedAt}</p>
          </div>
        );
      })}
    </div>
  );
}
