import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/syne/700.css";
import "@fontsource/syne/800.css";
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import App from "./App.jsx";
import "./styles.css";
import { debugLog } from "./lib/debugLog.js";

// #region agent log
debugLog("A", "main.jsx:boot", "client_bundle_loaded", {
  href: typeof location !== "undefined" ? location.href : "",
  host: typeof location !== "undefined" ? location.host : "",
});
// #endregion

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
