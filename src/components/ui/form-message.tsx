import { CircleAlert, CircleCheck } from "lucide-react";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

export function FormMessage({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: string | null | undefined;
}) {
  const { error } = useI18n();
  if (!children) return null;
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm",
        tone === "error" ? "bg-danger/8 text-danger" : "bg-accent-soft text-accent-hover",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {error(children)}
    </p>
  );
}
