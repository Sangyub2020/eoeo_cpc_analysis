import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/40",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-cyan-200",
        secondary:
          "border border-purple-500/30 bg-slate-800 text-gray-300",
        destructive:
          "border-transparent bg-gradient-to-r from-red-500 to-pink-500 text-white",
        outline: "border-cyan-500/30 text-cyan-300",
        success:
          "border-transparent bg-gradient-to-r from-emerald-500/30 to-green-500/30 text-emerald-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
