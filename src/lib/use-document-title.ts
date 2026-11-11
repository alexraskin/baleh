import { useEffect } from "react";

import { pageTitle } from "@/config/brand";

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
