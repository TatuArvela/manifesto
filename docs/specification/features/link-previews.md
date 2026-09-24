# Link Previews

A link in a note gets a card below the text. In open mode the card shows the URL and its domain. In
connected mode the server reads the linked page, and the card fills in with the page's title,
description, image and icon.

## Behavior

- A card is added when a URL is pasted into the note's body, or inserted with the toolbar's link
  button. A URL pasted into the title, the link box or a tag field adds none.
- One paste can carry many links. They are added together, in one write.
- A note holds at most 20 cards. A paste that would go past that adds what fits and says so.
- A URL already on the note is not added again. A card can be removed from the editor, and removing
  it does not touch the link in the text.
- Cards are never regenerated on save. Editing the link in the text leaves its card as it was.
- A note with no title and no images, whose text is only the links it has cards for, shows the
  first card as a full-width image on its grid card.

## Open Mode

The card stays plain: the URL as its title, and its domain. Reading a page would mean the browser
contacting a third party, which an open-mode build's Content Security Policy deliberately forbids
(`connect-src 'self'`), and which would tell that party what the user was pasting.

## Connected Mode

The card appears plain at once, then the client asks the server for the page with
`GET /api/link-preview` (see [API](../api.md#link-previews)) and fills the card in when the answer
comes back, whether or not the editor is still open. A page that cannot be read leaves the card
plain, silently: a link to a site that is down is not an error.

The server returns the page's image and favicon as it fetched them. The client redraws each one
through a canvas into a small copy of at most 64 KB: a thumbnail of at most 640px, or a 64px
favicon. It uploads that copy as an [attachment](attachments.md), and the preview holds the
reference. Three things follow:

- **Viewing a note contacts no one but its server.** The images are kept with the note, so a card
  keeps its picture when the site changes and never lets the linked site see who is reading.
- **What is stored is pixels the client encoded itself**, whatever bytes the site served.
- **A preview costs a note only its text.** Previews travel in every listing and every write, and
  twenty inline thumbnails would put a note over the server's 1 MiB limit on a request.

### What the server fetches

The server fetches URLs its users typed, so it takes care not to be pointed at itself or its
network:

- Only `http` and `https`, on the scheme's default port, with no credentials in the URL.
- The hostname is resolved first, and every address it resolves to must be publicly routable.
  Loopback, private ranges, link-local (including cloud metadata endpoints at `169.254.169.254`),
  carrier-grade NAT, multicast, and their IPv6 and IPv4-mapped equivalents are refused. The
  connection then goes to the address that was checked, so a hostname cannot pass the check with
  one address and connect to another.
- Every redirect is checked the same way, up to five of them.
- The page must be HTML. At most 512 KB of it is read, after decompression; the metadata is in the
  head.
- The image is at most 1.5 MB and the favicon 256 KB. Each is identified by its leading bytes rather
  than its `Content-Type`, and only PNG, JPEG, GIF, WebP, AVIF and ICO are accepted. SVG is not.
- The whole exchange for one page times out after 8 seconds.
- A user may ask for 40 previews a minute.

The title comes from `og:title`, then `twitter:title`, then `<title>`, and falls back to the URL.
The description comes from `og:description`, `twitter:description` or `<meta name="description">`.
The image comes from `og:image` or `twitter:image`. The favicon comes from `<link rel="icon">`, then
`apple-touch-icon`, then `/favicon.ico`.

### Turning it off

`LINK_PREVIEWS=off` stops the server from fetching anything, for deployments with no outbound
internet access or an egress policy it should not test. The endpoint then answers `404`, and the
client keeps every card plain. See [Server Deployment](../server/deployment.md#environment-variables).
