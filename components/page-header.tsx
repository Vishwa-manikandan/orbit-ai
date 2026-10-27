import type { ReactNode } from "react";
import { OrbitMark } from "./orbit-mark";

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <OrbitMark className="size-6 shrink-0 lg:hidden" />
        <div className="min-w-0">
          <span className="mono-label !text-[8.5px]">{kicker}</span>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-[16px] font-semibold tracking-tight text-text">{title}</h1>
            {description && (
              <p className="hidden truncate text-[11.5px] text-faint sm:block">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  );
}
