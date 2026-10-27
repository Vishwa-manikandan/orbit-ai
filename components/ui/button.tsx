import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-amber/60 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px",
  {
    variants: {
      variant: {
        primary:
          "bg-amber text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_24px_-12px_rgba(242,180,95,0.7)] hover:bg-amber-bright",
        secondary:
          "border border-line bg-panel-2 text-text hover:border-faint/40 hover:bg-hover",
        ghost: "text-muted hover:bg-hover hover:text-text",
        danger:
          "border border-rose/25 bg-rose/10 text-rose hover:border-rose/40 hover:bg-rose/15",
        approve: "bg-mint text-accent-ink hover:brightness-105",
      },
      size: {
        sm: "h-8 px-3 text-[12.5px]",
        md: "h-9.5 px-4 text-[13px]",
        lg: "h-11 px-5 text-sm",
        icon: "size-8.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
