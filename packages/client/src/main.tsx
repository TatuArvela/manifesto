import { render } from "preact";
import { App } from "./components/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { OAuthConsentPage } from "./components/OAuthConsentPage.tsx";
import { PublicNotePage } from "./components/PublicNotePage.tsx";
import { ServerSetupError } from "./components/ServerSetupError.tsx";
import { applyFavicon, FAVICON, WINDOW_TITLE } from "./config.ts";
import { loadCatalogue } from "./i18n/index.ts";
import { offerLaunchImage } from "./launchImage.ts";
import { registerServiceWorker } from "./serviceWorker.ts";
import { capSplash, revealApp } from "./splash.ts";
import { SERVER_URL } from "./state/account/auth.ts";
import { isOAuthConsentPath } from "./state/account/oauth.ts";
import { locale } from "./state/prefs.ts";
import { publicLinkToken } from "./state/publicLinks.ts";
import { serverSetupProblem } from "./utils/serverCsp.ts";
import "./assets/fonts/fonts.css";
import "./styles.css";

// Asked once, at boot: both the document's CSP and the resolved server are
// fixed for the life of the page. A copy that names a server its own policy
// blocks cannot do anything useful, so it says which lines are missing
// instead of rendering a login screen whose every request dies silently.
const setupProblem = serverSetupProblem(SERVER_URL);

// The HTML carries the app's name and icon; the instance's join them here,
// so a release bundle's meta tags are the one place to set them.
document.title = WINDOW_TITLE;
applyFavicon(FAVICON);

// A public link's page stands alone: no account, no board, one note.
const publicToken = publicLinkToken(window.location.pathname);
// So does the page an AI assistant sends the browser to when it signs in.
const oauthConsent = isOAuthConsentPath(window.location.pathname);

// Opened in its language from the first frame: the saved language's
// catalogue, when it is not English, comes before the first render. It is
// precached, so this waits on the network only on a first visit.
void loadCatalogue(locale.peek()).then(start);

function start() {
  const root = document.getElementById("app");
  if (root)
    render(
      <ErrorBoundary>
        {setupProblem ? (
          <ServerSetupError problem={setupProblem} />
        ) : publicToken ? (
          <PublicNotePage token={publicToken} />
        ) : oauthConsent ? (
          <OAuthConsentPage />
        ) : (
          <App />
        )}
      </ErrorBoundary>,
      root,
    );
  // A setup error is the whole page, and ready now; the app says when it is.
  if (setupProblem) revealApp();
  else capSplash();
  // Measured now, while the splash is still on screen to be measured.
  offerLaunchImage();
  registerServiceWorker();
}
