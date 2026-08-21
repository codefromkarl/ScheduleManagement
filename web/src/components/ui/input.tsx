import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full min-w-0 rounded-lg border border-[#e1e2f4] bg-white px-3 py-2 text-xs text-[#52556d] shadow-xs outline-none transition-colors placeholder:text-[#babcc8] focus-visible:border-[#9da2f0] focus-visible:ring-2 focus-visible:ring-[#5d63e9]/15 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export { Input };
