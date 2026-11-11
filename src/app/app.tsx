import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";

import { I18nProvider } from "./i18n-provider";
import { queryClient } from "./query-client";
import { router } from "./router";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  );
}
