import { useId, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const i18n = useI18n();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-12 rounded-xl border border-border bg-surface px-4 text-base text-text transition-colors",
          "placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:outline-none",
          "focus:ring-3 focus:ring-accent/15 disabled:opacity-60",
          "aria-invalid:border-danger aria-invalid:focus:ring-danger/15",
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {i18n.error(error)}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
