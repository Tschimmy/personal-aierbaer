import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyTheme, loadTheme } from "./lib/api";
import "./styles.css";

applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
