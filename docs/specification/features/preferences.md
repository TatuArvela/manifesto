# Preferences

Preferences are all items under Settings that are not about the account itself: the theme, the
language, the board, note defaults, hidden tags and the other items. Each client keeps them in
`localStorage` under `manifesto:prefs`. In connected mode, most of them also go with the account.
Thus, a tag that you hide on the laptop is also hidden on the phone.

## Finding a setting

The search field at the top of the Settings sidebar finds a setting by its label, and a page by its
name. It uses the language of the app, and ignores case and accents. Each word that you type must
match.

- While the field has text, the results show in place of the page list. Each setting shows with the
  name of its page.
- When you select one (or push Enter for the first), that page opens, scrolls to the setting, and
  highlights it for a short time.
- `SETTINGS_INDEX` in `components/settings/settingsIndex.ts` tells what the search can find. If you
  add a setting to a page, add a line there.

The sidebar lists the pages of the account first, and then the general pages. A gap separates the
two groups. There are no headings. Language and Region has its own page, before Appearance. It has
the language and the decimal separator for inline calculations. Board Background also has its own
page, after Appearance. The bookmarklet is a section of Features, Save from Browser.

## Opening links in the browser

On a phone, the installed app opens a link in its own view over the app. That view does not have
the tabs, bookmarks or sign-ins of the reader. "Open Links in Browser" (Features) sends web links to
the browser of the system. It shows only in the app installed on iOS, iPadOS or Android, and it is
off by default.

- Each link that opens in a new tab (the links of a note, preview cards, "Open link" in the editor)
  goes through an address that asks the system to open it.
- On iOS and iPadOS 17 and later, the address is `x-safari-https:`.
- On Android, the address is an `intent:` with no package. If nothing accepts it, the plain link
  opens.
- A link with a modifier key held, and a link that is not `http:` or `https:` (for example a mail
  address), opens as usual.

The code is `utils/systemBrowser.ts` and `state/externalLinks.ts`.

## What follows the account

In connected mode, all preferences go with the account, except the preferences that belong to the
device:

| Stays on the device | Why |
|---|---|
| `stickyTopBar` | It is a phone setting. Wider screens always keep the top bar. |
| `noteScale` | The size of the cards must agree with the size of this screen. |
| `animations` | It starts from the reduced-motion setting of this device. |
| `boardUsePicture`, `boardImageStamp` | The board picture is in the IndexedDB of this browser. The app never uploads it. |
| `openLinksInBrowser` | It has an effect only in the app installed on a phone. |

The list is `DEVICE_PREFS` in `state/prefParsers.ts`. A new preference goes with the account, unless
you add it there. Open mode has no account, and keeps all preferences on the device.

## How they move

- **Signing in** reads the copy of the account (`GET /api/v1/auth/me/prefs`).
  - For each key that the copy has, the value of the account replaces the value of this device.
  - For each key that it does not have, the app uses the default of the server for that key, if the
    host set one ([below](#defaults-from-the-server)). If not, it uses the value of this device. It
    then sends that value.
  - Thus, an account with no stored preferences starts from the defaults of the host and the
    settings of the first device that signs in. A device that signs in later gets the preferences of
    the account.
- **A change here** goes to the server a short time later, as a patch of only the changed keys
  (`PATCH /api/v1/auth/me/prefs`). If two devices change different settings at the same time, both
  changes stay.
- **A change elsewhere** arrives on the app socket as `prefs:updated`, with the full copy. The app
  adopts it immediately. When the socket reconnects, the app reads the copy again, to get the changes
  that occurred while it was away.
- **A change here that the app did not send yet wins** over a change that arrives, and over the copy
  read at sign-in. For the person who makes it, it is the newer change.
- **Offline**, changes stay on the device. The app sends them on the next change or reconnect.
- **The export** contains them as `preferences.json` ([Export / Import](export-import.md)). An import
  of an archive does not apply them. Thus, a restore of notes never changes the settings.
- **Signing out** does not change the copy of this device in `localStorage`. See
  [Privacy](privacy.md).

The app reads the data from the server in the same way as a `localStorage` blob that a person
edited: each key goes through its parser. If the parser does not know a value, the app uses the
default. Thus, a preference that a newer client wrote cannot break an older client. An older client
ignores a key that it does not know.

## Defaults from the server

A host can select the preferences of new accounts with `DEFAULT_PREFS`
([Deployment](../server/deployment.md#environment-variables)). It is one JSON object, with the names
below as keys. `/api/v1/capabilities` gives it to each client as `defaultPrefs`. The server only
checks that it is a JSON object within `MAX_ACCOUNT_PREFS_BYTES`. The client reads each value through
its parser, as it reads the values of the account. Thus, if the client does not know a value, it uses
its own default.

- **Signing in**: a key that the account never stored gets the default. From then on, the account
  stores it as its own value. A default never replaces a value that the account has. Thus, a later
  change to `DEFAULT_PREFS` applies only to the keys that accounts do not have yet (for example, a
  preference from a later release). A change on this device that the app did not send yet wins over
  it, as over the copy of the account.
- **A first visit** (a browser with no preferences of its own, and no user signed in) gets all
  defaults at the same time. This includes the device preferences. Thus, the sign-in screen already
  looks as the host selected. On a device that has preferences, a device preference (in the table
  above) never gets a default.

The names are the keys of `PREF_PARSERS` in `state/prefParsers.ts`. These are the keys that a host
sets most frequently:

| Key | Values |
|---|---|
| `theme` | `system` (default), `light`, `dark` |
| `lightHue` | `white` (default), or a board color: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink` |
| `darkHue` | `neutral` (default), `midnight`, `mauve`, `lavender`, `indigo`, `slate`, `steel`, `ocean`, `black`, or a board color |
| `locale` | `en`, `fi`. The default is the language of the browser |
| `viewMode` | `grid` (default), `list` |
| `noteSize` | `fit` (default), `square` |
| `noteCorners` | `straight` (default), `rounded` |
| `noteTilt` | `tidy` (default), `messy` |
| `defaultNoteColor` | `default` (default), `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `gray`, `random` |
| `defaultEditMode` | `normal` (default), `raw` |
| `confirmBeforeDelete`, `complexShadows`, `inlineCalculations`, `noteQuips`, `formattingToolbar`, `checkedItemsLast`, `checklistProgress`, `linkPreviewCards` | `true` or `false` |
| `boardColor`, `boardGradient` | `none` (default), `white`, `gray`, `black`, a board color, `custom`, `random` |
| `boardCustomColor`, `boardGradientCustomColor`, `boardInkColor` | a `#rrggbb` color |
| `boardGradientDirection` | `top`, `top-right`, `right`, `bottom-right` (default), `bottom`, `bottom-left`, `left`, `top-left`, `random` |
| `boardTexture` | `none` (default), `paper`, `dots`, `grid`, `lines`, `waves`, `confetti`, `stars`, `hearts`, `bubbles`, `stripes`, `sawtooth`, `random` |
| `boardInk` | `auto` (default), `white`, `black`, a board color, `custom`, `random` |
| `boardTextureOpacity` | a whole percentage from 0 to 100 (default 10) |
| `noteScale`, `animations`, `stickyTopBar`, `openLinksInBrowser` | the device preferences: `big` or `small`, and `true` or `false`. They apply only on a first visit |

## On the server

The copy is one JSON object for each account, in `user_prefs`. It is deleted with the account. The
server stores what clients send, and reads none of it. It checks only these limits:

- A patch has a maximum of 100 keys.
- Each key has a maximum of 64 characters.
- The result as JSON stays within `MAX_ACCOUNT_PREFS_BYTES` (16 KB). If it is larger, the server
  sends `413`.

A key set to `null` is removed. The merge is atomic in both drivers. Thus, if two devices send
patches at the same time, both patches apply.
