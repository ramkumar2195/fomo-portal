import { SurfaceCard } from "@/components/admin/page-frame";

interface PendingApiPlaceholderProps {
  title: string;
  missingEndpoints: string[];
  note?: string;
}

export function PendingApiPlaceholder({ title, missingEndpoints, note }: PendingApiPlaceholderProps) {
  return (
    <SurfaceCard title={title}>
      <div className="space-y-3">
        <p className="text-sm text-slate-700">Pending backend API</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          {missingEndpoints.map((endpoint) => (
            <li key={endpoint}>{endpoint}</li>
          ))}
        </ul>
        {note ? <p className="text-xs text-slate-500">{note}</p> : null}
      </div>
    </SurfaceCard>
  );
}
