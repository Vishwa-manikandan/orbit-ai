import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium tracking-wide",
  {
    variants: {
      variant: {
        neutral: "border-line bg-panel-2 text-muted",
        amber: "border-amber/25 bg-amber/10 text-amber",
        success: "border-mint/25 bg-mint/10 text-mint",
        danger: "border-rose/25 bg-rose/10 text-rose",
        lilac: "border-lilac/25 bg-lilac/10 text-lilac",
        outline: "border-line text-faint",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
