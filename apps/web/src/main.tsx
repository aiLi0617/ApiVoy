import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@apivoy/ui/styles.css";
import { App } from "./App";
import { ApiVoyProviders } from "@apivoy/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiVoyProviders><App /></ApiVoyProviders>
  </StrictMode>,
);
