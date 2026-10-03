// apps/web - owns: Three.js presentation, accessible DOM controls
// Must not: advance authoritative world state
// Status: stub - Slice 1 implementation pending

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <div>Ember Line - scaffold</div>;
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
