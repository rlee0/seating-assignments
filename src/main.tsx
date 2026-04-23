import "./index.css";

import { applyTheme, resolvePreferredTheme } from "./store/localStorage";

import App from "./App";
import React from "react";
import ReactDOM from "react-dom/client";

applyTheme(resolvePreferredTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
