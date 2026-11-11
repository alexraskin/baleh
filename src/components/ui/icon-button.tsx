import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; icon-only buttons must always have one. */
  label: string;
  children: ReactNode;
}

export function IconButton({ label, className, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors",
        "hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
