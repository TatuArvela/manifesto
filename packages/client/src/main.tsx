import { render } from "preact";
import { App } from "./components/App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ServerSetupError } from "./components/ServerSetupError.js";
import { WINDOW_TITLE } from "./config.js";
import { registerServiceWorker } from "./serviceWorker.js";
import { capSplash, revealApp } from "./splash.js";
import { SERVER_URL } from "./state/auth.js";
import { serverSetupProblem } from "./utils/serverCsp.js";
import { trackVisualViewport } from "./utils/visualViewport.js";
import "./assets/fonts/fonts.css";
import "./styles.css";

// Asked once, at boot: both the document's CSP and the resolved server are
// fixed for the life of the page. A copy that names a server its own policy
// blocks cannot do anything useful, so it says which lines are missing
// instead of rendering a login screen whose every request dies silently.
const setupProblem = serverSetupProblem(SERVER_URL);

// The HTML carries the app's name alone; the instance joins it here, so a
// release bundle's meta tag is the one place to set it.
document.title = WINDOW_TITLE;

const root = document.getElementById("app");
if (root)
  render(
    <ErrorBoundary>
      {setupProblem ? <ServerSetupError problem={setupProblem} /> : <App />}
    </ErrorBoundary>,
    root,
  );
// A setup error is the whole page, and ready now; the app says when it is.
if (setupProblem) revealApp();
else capSplash();
trackVisualViewport();
registerServiceWorker();
