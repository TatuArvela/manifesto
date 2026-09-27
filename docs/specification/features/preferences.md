# Preferences

Everything under Settings that is not about the account itself: the theme, the language, the board,
note defaults, hidden tags and the rest. Each client keeps them in `localStorage` under
`manifesto:prefs`; in connected mode most of them also follow the account, so a tag hidden on the
laptop is hidden on the phone.

## What follows the account

In connected mode every preference follows the account except the ones that belong to the device:

| Stays on the device | Why |
|---|---|
| `stickyTopBar` | A phone's setting; wider screens always keep the top bar. |
| `noteScale` | How big the cards are suits the size of this screen. |
| `animations` | Starts from this device's reduced-motion setting. |
| `boardUsePicture`, `boardImageStamp` | The board picture is kept in this browser's IndexedDB and never uploaded. |

The list is `DEVICE_PREFS` in `state/prefs.ts`; a new preference follows the account unless it is
added there. Open mode has no account and keeps everything on the device.

## How they move

- **Signing in** reads the account's copy (`GET /api/auth/me/prefs`). For every key it has, the
  account's value replaces this device's; for every key it lacks, this device sends its own. So an
  account with nothing stored takes the settings of the first device that signs in after the upgrade,
  and a device signing in later takes the account's.
- **A change here** is sent a moment later as a patch of just the keys it touched
  (`PATCH /api/auth/me/prefs`). Two devices changing different settings at once keep both.
- **A change elsewhere** arrives on the app socket as `prefs:updated`, with the whole copy, and is
  adopted at once. The socket reconnecting reads the copy again, for what changed while it was away.
- **A change here not yet sent wins** over one that arrives, including the copy read at sign-in, since
  it is the newer one to the person making it.
- **Offline**, changes stay on the device and are sent on the next change or reconnect.
- **Signing out** leaves this device's copy in `localStorage` as it was; see [Privacy](privacy.md).

What the server sends is read the way a hand-edited `localStorage` blob is: each key through its
parser, a value it does not recognise falling back to the default. So a preference a newer client
wrote cannot break an older one, and an older client ignores a key it does not know.

## On the server

The copy is one JSON object per account in `user_prefs`, which goes with the account. The server
stores what clients send and reads none of it: it checks only that a patch has at most 100 keys of up
to 64 characters, and that the result stays within `MAX_ACCOUNT_PREFS_BYTES` (16 KB) as JSON,
answering `413` past it. A key set to `null` is removed. Merging is atomic in both drivers, so
patches from two devices at once both land.
