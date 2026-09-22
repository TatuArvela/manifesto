import { render } from "preact";
import { App } from "./components/App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ServerSetupError } from "./components/ServerSetupError.js";
import { registerServiceWorker } from "./serviceWorker.js";
import { SERVER_URL } from "./state/auth.js";
import { serverSetupProblem } from "./utils/serverCsp.js";
import "./assets/fonts/fonts.css";
import "./styles.css";

/**
 * Takes down the loading screen in index.html, one frame after the first
 * render, so the app has been painted behind it before it starts to fade.
 *
 * The element is removed rather than left faded out: it covers the viewport
 * and would otherwise sit over every tap for the life of the page. The timer
 * is what guarantees that, since `transitionend` never fires in a background
 * tab, and not at all under the reduced-motion rule that collapses the fade.
 */
function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  requestAnimationFrame(() => {
    splash.dataset.done = "true";
    splash.addEventListener("transitionend", () => splash.remove(), {
      once: true,
    });
    setTimeout(() => splash.remove(), 1000);
  });
}

// Asked once, at boot: both the document's CSP and the resolved server are
// fixed for the life of the page. A copy that names a server its own policy
// blocks cannot do anything useful, so it says which lines are missing
// instead of rendering a login screen whose every request dies silently.
const setupProblem = serverSetupProblem(SERVER_URL);

const root = document.getElementById("app");
if (root)
  render(
    <ErrorBoundary>
      {setupProblem ? <ServerSetupError problem={setupProblem} /> : <App />}
    </ErrorBoundary>,
    root,
  );
dismissSplash();
registerServiceWorker();
