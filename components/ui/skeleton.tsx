import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md border border-purple-500/10 bg-slate-800/60",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
