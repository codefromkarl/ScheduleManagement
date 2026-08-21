import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#5d63e9]/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#5d63e9] text-white shadow-sm hover:bg-[#4e54c8]",
        outline: "border border-[#e9eaf2] bg-white text-[#686b80] hover:border-[#d8daf8] hover:text-[#5d63e9]",
        ghost: "text-[#9699aa] hover:bg-[#eef0ff] hover:text-[#5d63e9]",
        soft: "bg-[#eef0ff] text-[#5d63e9] hover:bg-[#e3e5ff]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
