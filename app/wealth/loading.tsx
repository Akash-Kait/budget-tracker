// Dark skeleton shown while /wealth (force-dynamic) loads its data.
function Box({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

export default function WealthLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Box className="h-8 w-40" />
          <Box className="h-4 w-80 max-w-full" />
        </div>
        <Box className="h-9 w-32" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Box key={i} className="h-24" />
        ))}
      </div>

      <Box className="h-56" />

      <div className="space-y-4">
        <Box className="h-40" />
        <Box className="h-28" />
      </div>
    </div>
  );
}
