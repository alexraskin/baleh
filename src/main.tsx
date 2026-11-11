import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/app";
import { router } from "@/app/router";
import { pageTitle } from "@/config/brand";
import { initAutoUpdate } from "@/lib/auto-update";
import { registerServiceWorker } from "@/lib/push";
import { initTheme } from "@/lib/theme";

import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

document.title = pageTitle();
initTheme();
registerServiceWorker((path) => void router.navigate(path));
initAutoUpdate();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
