# Link Previews

A link in a note gets a card below the text. In open mode, the card shows the URL and its domain. In
connected mode, the server reads the linked page. The card then shows the title, description, image
and icon of the page.

## Behavior

- The app adds a card when you paste a URL into the body of the note, or insert it with the link
  button of the toolbar. A URL in the title, the link box or a tag field adds no card.
- "Link Previews" (Settings, Features; the `linkPreviewCards` preference, on by default) turns this
  off. A link then stays in the text and gets no card. The cards that a note already has stay,
  because they belong to the note and to its other readers too. You can still remove each one.
- One paste can contain many links. The app adds them together, in one write.
- A note can have a maximum of 20 cards. If a paste has more, the app adds the cards that fit, and
  tells you.
- The app does not add a URL that is already on the note. You can remove a card from the editor.
  This does not change the link in the text.
- The app never makes the cards again when it saves. If you edit the link in the text, its card does
  not change.
- If a note has no title and no images, and its text is only the links of its cards, its grid card
  shows the first card as a full-width image.

## Open Mode

The card stays plain: the URL is its title, and the card shows its domain. To read a page, the
browser must contact a third party. The Content Security Policy of an open-mode build does not
permit this, on purpose (`connect-src 'self'`). The contact also tells that party what the user
pasted.

## Connected Mode

The card shows plain immediately. Then the client asks the server for the page with
`GET /api/v1/link-preview` (see [API](../api.md#link-previews)). The client fills the card when the
answer comes back, also if the editor is closed. If the server cannot read a page, the card stays
plain, and no message shows. A link to a site that is not available is not an error.

The server returns the image and the favicon of the page as it got them. The client draws each one
again through a canvas, into a small copy of a maximum of 64 KB: a thumbnail of a maximum of 640px,
or a 64px favicon. It uploads that copy as an [attachment](attachments.md), and the preview keeps
the reference. This has three results:

- **When you look at a note, the app contacts only its server.** The images stay with the note.
  Thus, a card keeps its picture when the site changes, and the linked site never sees who reads.
- **The stored data is pixels that the client encoded**, not the bytes that the site sent.
- **A preview adds only text to a note.** Previews go with each listing and each write. Twenty
  inline thumbnails make a note larger than the 1 MiB request limit of the server.

### What the server fetches

The server gets URLs that its users typed. Thus, it makes sure that a URL does not point to the
server itself or to its network:

- Only `http` and `https`, on the default port of the scheme, with no credentials in the URL.
- The server resolves the hostname first. Each address of the name must be publicly routable. The
  server refuses loopback, private ranges, link-local (this includes cloud metadata endpoints at
  `169.254.169.254`), carrier-grade NAT, multicast, and the IPv6 and IPv4-mapped equivalents. The
  connection then goes to the checked address. Thus, a hostname cannot pass the check with one
  address and then connect to a different address.
- The server checks each redirect in the same way, to a maximum of five.
- The page must be HTML. The server reads a maximum of 512 KB of it, after decompression. The
  metadata is in the head.
- The maximum size of the image is 1.5 MB, and of the favicon 256 KB. The server identifies each
  one from its first bytes, not from its `Content-Type`. It accepts only PNG, JPEG, GIF, WebP, AVIF
  and ICO. It does not accept SVG.
- The full exchange for one page has a timeout of 8 seconds.
- A user can ask for a maximum of 40 previews each minute.

The title comes from `og:title`, then `twitter:title`, then `<title>`. If none of these is present,
the title is the URL. The description comes from `og:description`, `twitter:description` or
`<meta name="description">`. The image comes from `og:image` or `twitter:image`. The favicon comes
from `<link rel="icon">`, then `apple-touch-icon`, then `/favicon.ico`.

### Turning it off

`LINK_PREVIEWS=off` stops all fetches by the server. Use it for a deployment without outbound
internet access, or with an egress policy that the server must not test. The endpoint then sends
`404`, and the client keeps all cards plain. See
[Server Deployment](../server/deployment.md#environment-variables).
