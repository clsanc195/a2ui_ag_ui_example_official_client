import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Note: we deliberately do NOT inject the @a2ui/react structural CSS because
// we render via our own custom React renderer (see A2UIRenderer.tsx) instead
// of <A2uiSurface>. The SDK's MessageProcessor is still the source of truth
// for surface state.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
