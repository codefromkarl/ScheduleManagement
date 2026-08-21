import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-1 text-[9px] font-bold leading-none",
  {
    variants: {
      variant: {
        default: "bg-[#e6f8f0] text-[#5aa98d]",
        muted: "bg-[#f1f3f8] text-[#7d859a]",
        warning: "bg-[#fff0e9] text-[#d68162]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
