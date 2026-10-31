# Accessibility

The target of Manifesto is [WCAG 2.1](https://www.w3.org/TR/WCAG21/) at level AA. EN 301 549, the
European standard for accessible ICT, requires that level for web content (its clause 9). Thus, the
European Accessibility Act and the Web Accessibility Directive refer to that level. Manifesto is also
an authoring tool, because people write their notes in it. Thus, EN 301 549 clause 11.8 (the
requirements for a tool about the content that it makes) also applies.

This page tells what the app does, what it does not do yet, and what a deployment possibly must
publish. [Client](client/index.md#accessibility) gives the conventions of the client (one focus ring,
named layers, the Escape stack).

## What the app does

- **Keyboard**: you can do with a keyboard all that you can do with a pointer.
  - To go to a card, use Tab or `j` / `k`. To open it, use Enter.
  - To move a card, use `Shift j` / `Shift k`, or the card menu. This is the alternative to a drag
    ([Keyboard Shortcuts](features/keyboard-shortcuts.md)).
  - Menus and pickers take focus when they open, and give it back when they close.
  - Modal sheets keep Tab inside them. Escape closes the newest layer.
- **Screen readers**:
  - Controls have names in the language of the reader.
  - Buttons that open something tell if it is open (`aria-expanded`). Pickers tell which option is
    current (`aria-pressed`).
  - A note card is an `<article>`. The title or the first line of the note gives the name of its
    open button.
  - Live regions announce toasts, the connection status, the result of an inline calculation, and
    the new position of a moved card.
- **Seeing**:
  - The text of the app has a contrast of 4.5:1, and its controls have 3:1, in both themes.
  - On a note, a test measures this. It checks text and icons on each of the eleven note colors, as a
    card and as an auto-note, in all light and dark shades.
  - A ticked checklist item or a past reminder shows a line through it or a different tone. It never
    fades below that contrast.
  - All items on the board (the "Pinned" and "Others" headings, the message of the empty board, the
    search filters) have their own solid surface. Thus, no board color, texture or picture behind
    them can make the contrast lower.
  - Keyboard focus shows one ring in all places. You can zoom the page. Motion follows the
    reduced-motion setting of the system, unless the animations preference sets a different value.
- **Pointer targets**: controls are 24 by 24 px or larger, or have that size for a press when they
  look smaller (WCAG 2.2, 2.5.8). The exceptions are below.
- **Focus in view**: the phone top bar and the sticky bars of an open note never hide a control that
  has keyboard focus (WCAG 2.2, 2.4.11).
- **Time**: nothing that the app asks of a person has a time limit, other than the security
  requirements (a sign-in link or code that expires, a session that ends). An error message stays
  until you dismiss it. A success message stays while the pointer is on it or while it has focus.
- **Images**: you can give a description to an image or a drawing in a note. Use its "Describe
  image" button, or the field under it in the image viewer. Each view of the note shows the
  description as the `alt` of the image. This includes the page of a public link. The description is
  kept with the note, sealed with the image, exported and imported. It stays with a drawing that you
  make over the image.
- **Language**: the `lang` of the page follows the selected language, English or Finnish.

## Known gaps

These gaps are open. A deployment that publishes a statement must list them:

- **An image has a description only if a person writes one.** An image without a description shows
  with an empty `alt`, and its button has only the name "Open image". Nothing asks for a description
  when you add an image (WCAG 1.1.1, EN 301 549 11.8.2). A token or an assistant can keep
  descriptions, but cannot write them. The thumbnail of a link preview has no description.
- **Drawing needs a pointer.** The [drawing pad](features/drawing-pad.md) follows the path of the
  pointer. WCAG gives an exemption from the keyboard requirement for this. You can describe a
  drawing, as any image.
- **No tests with assistive technology yet.** We reviewed the app against WCAG 2.1 AA from its code.
  Its browser tests check names, roles and focus. But we did not test it fully with screen readers
  (NVDA, JAWS, VoiceOver, TalkBack) or with speech input.
- **WCAG 2.2 is checked from the code, not formally assessed.** We examined target size (2.5.8),
  focus not obscured (2.4.11) and dragging (2.5.7). We did not examine the other new criteria of 2.2.
  The target stays 2.1 AA, which is what EN 301 549 requires.
- **The gutter of a checklist row in the editor.** On a screen with a mouse, the drag handle
  (approximately 14 by 24 px) and the delete button (approximately 17 px) adjacent to each item are
  smaller than 24 px. They are too near the checkbox to become larger without a move of the text. On a
  touch screen, they have the full size. You can delete the text of an item from the keyboard. But to
  move an item without a drag, you must cut its line and paste it in a different position. There is
  no key for it (WCAG 2.5.7).
- **A toast can cover a focused control.** A message shows in a corner, and it can be on top of the
  control that has focus there. You can dismiss it. A success message goes away automatically.
- **Placeholders are not measured.** The hint in an empty field is paler than text. Its contrast can
  be less than 4.5:1.
- **Auto-notes belong to their plugin.** A card that an auto-note plugin draws is only as accessible
  as the content of the plugin.

## For a deployment

The European Accessibility Act applies to a deployment because of who operates it and for whom, not
because of the software. The Act applies to a fixed list of consumer products and services
(e-commerce, consumer banking, e-books, passenger transport services, electronic communications,
access to audiovisual media). It gives an exemption to microenterprises that provide services. A note
app alone is not on that list. But a note app that is part of such a service can be. If a
public-sector body in the EU deploys Manifesto, the Web Accessibility Directive applies. It requires
the same WCAG 2.1 AA, and an accessibility statement with a method to report problems. This is a
summary to start from. It is not legal advice.

You can make a statement for a deployment from this page:

- The target standard: WCAG 2.1 AA, through EN 301 549.
- How much the deployment agrees with it: "partially", with the known gaps above.
- How to report a problem, and how quickly the operator answers a report.
- The date of the statement and of its last review, and the version of Manifesto that it describes
  (shown at the bottom of Settings).

The changes of the deployment also count. The app shows a logo, an instance name or an organization
name from [Custom Instances](custom-instances.md) as the deployment gives it. A logo without an
adjacent name is decoration.
