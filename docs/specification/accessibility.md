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
- **Seeing**: the app's own text is set for 4.5:1 contrast and its controls for 3:1 in both themes,
  keyboard focus shows one ring everywhere, the page can be zoomed, and motion follows the system's reduced-motion setting unless the
  animations preference says otherwise.
- **Time**: apart from what security needs (a sign-in link or code that expires, a session that ends),
  nothing the app asks of a person has a time limit. An error message stays until it is
  dismissed, and a success message does not leave while it is pointed at or focused.
- **Language**: the page's `lang` follows the chosen language, English or Finnish.

## Known gaps

These are open, and a deployment that publishes a statement should list them:

- **Images have no text alternative.** Images attached to a note, and drawings, are shown with an empty
  `alt`, and there is nowhere yet to write a description for one (WCAG 1.1.1, EN 301 549 11.8.2). Giving
  them one is a change to the note's data model, and its sealed contents, still to be designed.
- **Drawing needs a pointer.** The drawing pad follows the pointer's path, which WCAG exempts from the
  keyboard requirement, but a drawing then has no description either (above).
- **Not yet tested with assistive technology.** The app has been reviewed against WCAG 2.1 AA from its
  code, and its browser tests check names, roles and focus, but it has not been tested end to end with
  screen readers (NVDA, JAWS, VoiceOver, TalkBack) or with speech input.
- **WCAG 2.2 not yet assessed.** Its new criteria, target size (2.5.8) and focus not obscured (2.4.11)
  among them, have not been checked. Dragging (2.5.7) has its alternative above.
- **Contrast on every note colour not measured.** Text on each of the eleven note colours, in both
  themes and with a board background behind the cards, has not been measured against 4.5:1.
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
