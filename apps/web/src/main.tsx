// apps/web - owns: Three.js presentation, accessible DOM controls
// Must not: advance authoritative world state
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
