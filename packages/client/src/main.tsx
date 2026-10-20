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

// Asked one time, at start. Both the CSP of the document and the resolved
// server stay the same for the life of the page. A copy that names a server
// that its own policy blocks cannot do anything useful. Thus, it tells which
// lines are missing, and does not show a login screen whose requests all fail
// silently.
const setupProblem = serverSetupProblem(SERVER_URL);

// The HTML contains the name and icon of the app. Those of the instance join
// them here. Thus, the meta tags of a release bundle are the one place to set
// them.
document.title = WINDOW_TITLE;
applyFavicon(FAVICON);

// The page of a public link is alone: no account, no board, one note.
const publicToken = publicLinkToken(window.location.pathname);
// So is the page to which an AI assistant sends the browser when it signs in.
const oauthConsent = isOAuthConsentPath(window.location.pathname);

// Opened in its language from the first frame. The catalogue of the saved
// language, when it is not English, comes before the first render. It is
// precached. Thus, this waits for the network only on a first visit.
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
  // A setup error is the full page, and is ready now. The app tells when it is
  // ready.
  if (setupProblem) revealApp();
  else capSplash();
  // Measured now, while the splash is still on the screen to measure.
  offerLaunchImage();
  registerServiceWorker();
}
