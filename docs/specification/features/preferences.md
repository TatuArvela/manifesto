# Preferences

Everything under Settings that is not about the account itself: the theme, the language, the board,
note defaults, hidden tags and the rest. Each client keeps them in `localStorage` under
`manifesto:prefs`; in connected mode most of them also follow the account, so a tag hidden on the
laptop is hidden on the phone.

## Finding a setting

The search field at the top of Settings' sidebar finds a setting by its label, and a page by its name,
in the language the app is shown in, ignoring case and accents; every word typed has to match. The
results take the place of the page list while there is text in the field, each setting named with
the page it is on. Choosing one (or Enter, for the first) opens that page, scrolls the setting into
view and lights it for a moment. What can be found is `SETTINGS_INDEX` in
`components/settings/settingsIndex.ts`: a setting added to a page needs a line there.

The sidebar lists the account's pages first and then the general ones, the two groups set apart by
a gap rather than headings. Language and Region has a page of its own, before Appearance, with the
language and the decimal separator for inline calculations, and so does Board Background, after
Appearance. The bookmarklet is a section of Features, Save from Browser.

## Opening links in the browser

On a phone, the installed app opens a link in a view of its own over the app, without the reader's
tabs, bookmarks or sign-ins. "Open Links in Browser" (Features, shown only in the app installed on
iOS, iPadOS or Android, off by default) hands web links to the system's browser instead: every link
that would open in a new tab (a note's links, preview cards, the editor's "Open link") goes through
an address that asks the system to open it, `x-safari-https:` on iOS and iPadOS 17 and later, and an
`intent:` with no package on Android, which falls back to the plain link where nothing takes it. A
link with a modifier key held, and any that is not `http:` or `https:` (a mail address), opens as it
always has. The code is `utils/systemBrowser.ts` and `state/externalLinks.ts`.

## What follows the account

In connected mode every preference follows the account except the ones that belong to the device:

| Stays on the device | Why |
|---|---|
| `stickyTopBar` | A phone's setting; wider screens always keep the top bar. |
| `noteScale` | How big the cards are suits the size of this screen. |
| `animations` | Starts from this device's reduced-motion setting. |
| `boardUsePicture`, `boardImageStamp` | The board picture is kept in this browser's IndexedDB and never uploaded. |
| `openLinksInBrowser` | Does anything only in the app installed on a phone. |

The list is `DEVICE_PREFS` in `state/prefParsers.ts`; a new preference follows the account unless it is
added there. Open mode has no account and keeps everything on the device.

## How they move

- **Signing in** reads the account's copy (`GET /api/auth/me/prefs`). For every key it has, the
  account's value replaces this device's; for every key it lacks, the server's default for it is taken
  if the host set one ([below](#defaults-from-the-server)), and this device's own value if not, and
  sent. So an account with nothing stored starts from the host's defaults and the settings of the
  first device that signs in, and a device signing in later takes the account's.
- **A change here** is sent a moment later as a patch of just the keys it touched
  (`PATCH /api/auth/me/prefs`). Two devices changing different settings at once keep both.
- **A change elsewhere** arrives on the app socket as `prefs:updated`, with the whole copy, and is
  adopted at once. The socket reconnecting reads the copy again, for what changed while it was away.
- **A change here not yet sent wins** over one that arrives, including the copy read at sign-in, since
  it is the newer one to the person making it.
- **Offline**, changes stay on the device and are sent on the next change or reconnect.
- **The export** carries them as `preferences.json` ([Export / Import](export-import.md)); importing
  an archive does not apply them, so restoring notes never changes the settings under them.
- **Signing out** leaves this device's copy in `localStorage` as it was; see [Privacy](privacy.md).

What the server sends is read the way a hand-edited `localStorage` blob is: each key through its
parser, a value it does not recognise falling back to the default. So a preference a newer client
wrote cannot break an older one, and an older client ignores a key it does not know.

## Defaults from the server

A host can choose the preferences new accounts start from with `DEFAULT_PREFS`
([Deployment](../server/deployment.md#environment-variables)): one JSON object, keyed by the names
below, which `/api/capabilities` hands to every client as `defaultPrefs`. The server checks only that it
is a JSON object within `MAX_ACCOUNT_PREFS_BYTES`; the client reads each value through its parser, as
it reads the account's, so one it does not recognise falls back to the client's own default.

- **Signing in**, a key the account has never stored takes the default, and is stored as the account's
  own from then on. A default never replaces a value the account has, so changing `DEFAULT_PREFS` later
  reaches only the keys accounts still lack (a preference added in a later release, say). A change made
  on this device and not yet sent wins over it, as over the account's copy.
- **A first visit**, a browser with no preferences of its own and nobody signed in, takes every
  default at once, the device's own included, so the sign-in screen already looks as the host chose.
  On a device that has preferences, a device's own preference (the table above) never takes one.

The names are the keys of `PREF_PARSERS` in `state/prefParsers.ts`. The ones a host is most likely to
set:

| Key | Values |
|---|---|
| `theme` | `system` (default), `light`, `dark` |
| `lightHue` | `white` (default), or a board colour: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink` |
| `darkHue` | `neutral` (default), `midnight`, `mauve`, `lavender`, `indigo`, `slate`, `steel`, `ocean`, `black`, or a board colour |
| `locale` | `en`, `fi`; the browser's language by default |
| `viewMode` | `grid` (default), `list` |
| `noteSize` | `fit` (default), `square` |
| `noteCorners` | `straight` (default), `rounded` |
| `noteTilt` | `tidy` (default), `messy` |
| `defaultNoteColor` | `default` (default), `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `gray`, `random` |
| `defaultEditMode` | `normal` (default), `raw` |
| `confirmBeforeDelete`, `inlineCalculations`, `noteQuips`, `formattingToolbar`, `checkedItemsLast` | `true` or `false` |
| `boardColor`, `boardGradient` | `none` (default), `white`, `gray`, `black`, a board colour, `custom`, `random` |
| `boardCustomColor`, `boardGradientCustomColor`, `boardInkColor` | a `#rrggbb` colour |
| `boardGradientDirection` | `top`, `top-right`, `right`, `bottom-right` (default), `bottom`, `bottom-left`, `left`, `top-left`, `random` |
| `boardTexture` | `none` (default), `paper`, `dots`, `grid`, `lines`, `confetti`, `waves`, `stars`, `hearts`, `bubbles`, `stripes`, `sawtooth`, `random` |
| `boardInk` | `auto` (default), `white`, `black`, a board colour, `custom`, `random` |
| `boardTextureOpacity` | a whole percentage from 0 to 100 (default 10) |
| `noteScale`, `animations`, `stickyTopBar`, `openLinksInBrowser` | the device's own: `big` or `small`, and `true` or `false`; taken only on a first visit |

## On the server

The copy is one JSON object per account in `user_prefs`, which goes with the account. The server
stores what clients send and reads none of it: it checks only that a patch has at most 100 keys of up
to 64 characters, and that the result stays within `MAX_ACCOUNT_PREFS_BYTES` (16 KB) as JSON,
answering `413` past it. A key set to `null` is removed. Merging is atomic in both drivers, so
patches from two devices at once both land.
