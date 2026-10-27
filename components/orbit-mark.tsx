import { cn } from "@/lib/utils";

export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={cn("size-8", className)} aria-hidden="true">
      <defs>
        <linearGradient id="orbit-stroke" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD18D" />
          <stop offset="0.55" stopColor="#F2B45F" />
          <stop offset="1" stopColor="#C98B3F" />
        </linearGradient>
      </defs>
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7.2"
        transform="rotate(-28 20 20)"
        stroke="url(#orbit-stroke)"
        strokeWidth="1.35"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="12.2"
        ry="5.2"
        transform="rotate(38 20 20)"
        stroke="url(#orbit-stroke)"
        strokeOpacity="0.5"
        strokeWidth="1"
      />
      <circle cx="20" cy="20" r="3.1" fill="url(#orbit-stroke)" />
      <circle cx="32.6" cy="12.8" r="1.55" fill="#FFE6BD" />
    </svg>
  );
}
