# Accessibility

Manifesto aims to meet [WCAG 2.1](https://www.w3.org/TR/WCAG21/) at level AA. That is the level EN 301 549,
the European standard for accessible ICT, requires of web content (its clause 9), and so the level the
European Accessibility Act and the Web Accessibility Directive point to. Manifesto is also an authoring
tool, since people write their notes in it, so EN 301 549 clause 11.8 (what a tool owes the content made
with it) applies as well.

This page says what the app does, what it does not do yet, and what a deployment may need to publish. The
client's own conventions (one focus ring, named layers, the Escape stack) are in
[Client](client/index.md#accessibility).

## What the app does

- **Keyboard**: everything a pointer can do, a keyboard can. Cards are reached with Tab or `j` / `k`,
  opened with Enter, and reordered with `Shift j` / `Shift k` or the card menu, which is the alternative
  to dragging ([Keyboard Shortcuts](features/keyboard-shortcuts.md)). Menus and pickers take focus when
  they open and give it back when they close. Modal sheets keep Tab inside them, and Escape closes the
  newest layer.
- **Screen readers**: controls are named in the reader's language, and buttons that open something say
  whether it is open (`aria-expanded`); pickers say which option is current (`aria-pressed`). A note card
  is an `<article>` whose open button is named by the note's title or first line. Toasts, the connection
  status, an inline calculation's result and where a moved card landed are announced through live
  regions.
- **Seeing**: the app's own text is set for 4.5:1 contrast and its controls for 3:1 in both themes.
  On a note this is measured, not only intended: text and icons on each of the eleven note colours,
  as a card and as an auto-note, in every light and dark shade, are checked by a test. A ticked
  checklist item or a past reminder is told apart by a line through it or its tone, never by
  fading under that contrast. Anything that sits on the board (the "Pinned" and "Others" headings,
  the empty board's message, the search filters) is drawn on a solid surface of its own, so no board
  colour, texture or picture behind it can lower it. Keyboard focus shows one ring everywhere, the
  page can be zoomed, and motion follows the system's reduced-motion setting unless the
  animations preference says otherwise.
- **Time**: apart from what security needs (a sign-in link or code that expires, a session that ends),
  nothing the app asks of a person has a time limit. An error message stays until it is
  dismissed, and a success message does not leave while it is pointed at or focused.
- **Images**: an image or a drawing in a note can be given a description, from its "Describe image"
  button or the field under it in the image viewer, and every view of the note, a public link's page
  included, shows it as the image's `alt`. It is kept with the note, sealed with the image, exported
  and imported, and follows a drawing made over the image.
- **Language**: the page's `lang` follows the chosen language, English or Finnish.

## Known gaps

These are open, and a deployment that publishes a statement should list them:

- **An image is described only if someone describes it.** An image without a description is shown
  with an empty `alt`, and its button is named "Open image" alone; nothing asks for one when an image
  is added (WCAG 1.1.1, EN 301 549 11.8.2). A token or an assistant can keep descriptions but not
  write them, and a link preview's thumbnail has none.
- **Drawing needs a pointer.** The drawing pad follows the pointer's path, which WCAG exempts from the
  keyboard requirement; a drawing can be described like any image.
- **Not yet tested with assistive technology.** The app has been reviewed against WCAG 2.1 AA from its
  code, and its browser tests check names, roles and focus, but it has not been tested end to end with
  screen readers (NVDA, JAWS, VoiceOver, TalkBack) or with speech input.
- **WCAG 2.2 not yet assessed.** Its new criteria, target size (2.5.8) and focus not obscured (2.4.11)
  among them, have not been checked. Dragging (2.5.7) has its alternative above.
- **Placeholders are not measured.** The hint in an empty field is drawn paler than text, and may be
  under 4.5:1.
- **Auto-notes are their plugin's.** A card an auto-note plugin draws is accessible only as far as the
  plugin's content is.

## For a deployment

Whether the European Accessibility Act applies to a deployment depends on who runs it and for whom, not
on the software. The Act covers a fixed list of consumer products and services (e-commerce, consumer
banking, e-books, passenger transport services, electronic communications, access to audiovisual media),
and exempts microenterprises providing services. A note-taking app on its own is not on that list, but
one that is part of such a service may be. A public-sector body in the EU deploying Manifesto falls under
the Web Accessibility Directive instead, which asks for the same WCAG 2.1 AA and an accessibility
statement with a way to report problems. This is a summary to start from, not legal advice.

A statement for a deployment can be built from this page:

- the standard aimed for: WCAG 2.1 AA, through EN 301 549;
- how far the deployment meets it: "partially", with the known gaps above;
- how to report a problem, and how soon a report is answered;
- the date the statement was written and last reviewed, and the version of Manifesto it describes
  (shown at the foot of Settings).

The deployment's own changes count too: a logo, an instance name or an organisation name set through
[Custom Instances](custom-instances.md) is shown as the deployment gives it, and a logo with no name beside
it is treated as decoration.
