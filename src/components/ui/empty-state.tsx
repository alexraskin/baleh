import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-accent">
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <p className="text-sm text-text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
