interface PanelSkeletonProps {
  title: string;
  rows?: number;
}

export default function PanelSkeleton({ title, rows = 3 }: PanelSkeletonProps) {
  return (
    <section className="bg-bg-card rounded-2xl border border-border overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-border">
        <div className="h-4 w-32 bg-bg-primary rounded" aria-label={title} />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-12 bg-bg-primary rounded-lg" />
        ))}
      </div>
    </section>
  );
}
