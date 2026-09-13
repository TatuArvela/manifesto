import { render } from "preact";
import { App } from "./components/App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { registerServiceWorker } from "./serviceWorker.js";
import "./assets/fonts/fonts.css";
import "./styles.css";

const root = document.getElementById("app");
if (root)
  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
    root,
  );
registerServiceWorker();
