import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return <main className="shell">
    <p className="eyebrow">COMMANDER LINK</p>
    <h1>Private PTT beside Discord</h1>
    <p>This scaffold is intentionally safe-by-default. Complete the ordered work in TASKS.md.</p>
    <button className="ptt" disabled aria-label="Push to talk not implemented yet">HOLD TO TALK</button>
    <p className="status">Muted · implementation pending</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
