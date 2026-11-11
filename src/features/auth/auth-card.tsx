import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        {description && <p className="text-sm text-text-muted">{description}</p>}
      </div>
      {children}
      {footer && <p className="text-center text-sm text-text-muted">{footer}</p>}
    </Card>
  );
}

export const authLinkClass = "font-medium text-accent hover:text-accent-hover";
