# Attachments

A note can have up to `MAX_IMAGES_PER_NOTE` images of up to 5 MB each. In both modes, the note
contains **references**, never the bytes:

- **Connected mode:** `attachment:<id>`, an image in the attachment store of the server (below).
- **Open mode:** `local:<sha256>`, an image in the IndexedDB of this browser
  (`storage/localImages.ts`).

The thumbnail and the favicon of a link preview are kept in the same way, and all of the rules below
also apply to them. They are sealed, claimed for the owner of the note, served to its recipients,
swept when no preview or image refers to them, and inlined again on export. On export, the app does
not include one that it cannot read, but keeps its card, because it is a picture of the linked page,
not a file that the user attached.

`data:` URLs show only in export and import files. If images were inline, each note write, each
conflict retry and each `GET /api/v1/notes/:id` carries the bytes of all images on the note. In open
mode, some photos filled the approximately 5 MB of `localStorage`, and after that all saves failed,
also for text. With references, a note carries some dozen bytes for each image. `StoredImage` draws
both types through a `blob:` URL.

## Drawings

**Draw**, the pen adjacent to the add-image button in the toolbar of an open note, opens a drawing
pad: a sheet of white paper. You draw on it with a finger, a pen or a mouse. Done puts the drawing on
the note as a PNG image, through the same path as an attached picture. Thus, the app stores, shows,
shares and exports it as a picture, and it uses one of the image slots of the note.

- **Inks**: there are two inks, a foreground ink and a background ink. Each one shows as a color
  field that takes any other ink. A press on one of the twelve colors sets the foreground ink, and a
  right click sets the background ink. **Swap inks** exchanges them. Lines, outlines and fills use
  the foreground ink. The inside of a shape uses the background ink.
- **Tools**, in this order: Move, Selection (a menu of Select and Lasso), Eyedropper, Pen, Eraser,
  Fill, Shapes and Hand.
  - **Pen** draws a free line. A tap makes a dot.
  - **Eraser** takes ink away from the current layer only. The layers under it, and the image under
    the drawing, stay. It has the tip of the pen, and is four times the size of the pen.
  - **Fill** fills the area around the press that has the color there, as the drawing shows it,
    with the foreground ink, on the current layer. It stops at a line, and covers the soft edge of
    the line. Hidden layers do not count. A fill is a picture of its area. Thus, a large resize of
    it is less sharp than a line.
  - **Eyedropper** takes the foreground ink from where you press on the drawing, as it shows with
    all layers and the image. Then the tool from before comes back.
  - **Shapes** opens a menu of four tools, which a press outside it closes: **Line**, **Rectangle**, **Ellipse** and **Polygon**. A drag
    draws a line, or a box or an ellipse in the box of the drag. With Shift, a line goes in steps
    of 15 degrees, and a box or an ellipse has equal sides. A polygon gets a corner at each press.
    A press on the first corner, or a double click, closes it. Escape or Undo discards it, and so
    does a change from the other controls of the top bar or the layer list. A shape with no size
    draws nothing.
  - **Select**, **Lasso** and **Move** are described below. **Hand** drags the view of a zoomed drawing.
- On a wide screen, the tools and the two inks are a rail at the left of the paper, the options of
  the current tool a bar over the paper, and the colors and the layers panels at the right. On a
  phone, the inks and the colors are one row under the paper, and the tools a row under that. The
  options and the layers are panels that a button of the tools row opens.
- **Pen settings** shows only the options of the current tool. It sets the tip (round, square, or a tilted oval as a broad nib), the size (three
  sizes or a field from 1 to 200), the opacity of the ink (5 to 100 percent), and what a shape draws
  (its outline, its inside, or both). The size and the opacity apply to all tools. The tip applies
  to the pen, the line and the eraser. A square or oval tip presses its shape along the line. The shapes make
  one area, so a transparent ink does not become darker where they overlap.
- A shape in the size and tip of the pen, the line or the eraser follows the pointer, and a finger
  while it touches. Thus, you see where a stroke will apply before you draw it.
- **Zoom**: the buttons in the top bar zoom out and in, from a quarter to 16 times the size that
  fits the screen. Ctrl or Cmd with the mouse wheel zooms at the pointer. The number between the
  buttons is the size of the paper on the screen, and a press on it fits the paper to the screen
  again. A zoom keeps the point at the middle, or under the pointer, in place. A zoom changes the
  view only, not the picture.
- Undo, redo, and clear are in the top bar. Ctrl or Cmd with Z undoes, and with Y, or with Shift
  and Z, redoes. In a text field, the keys undo the typing.
- The drawing has layers. The **Layers** panel lists them, the top layer first. At the top, a slider
  with an eye icon sets the opacity of the current layer. One slide is one step for undo. Each row
  has an eye that hides or shows the layer, a small picture of its ink, and its name. Press a row
  to draw on that layer. The buttons at the bottom add a layer over the current one (to a maximum
  of eight), move the current layer up or down, and delete it (not the last layer). A line that
  you draw on a hidden layer shows that layer again.
- **Move** shows a dashed box around the ink of the current layer. A drag moves the ink. A drag of
  one of the handles at its four corners makes it larger or smaller, from the opposite corner, with
  the same scale on both axes (from 0.05 to 20 times). The strokes move as lines, not as a picture.
  A hidden layer shows no box and does not move.
  Thus, they stay sharp at any size, and a pen width grows with them. A drag is one step.
- **Selection** opens a menu of two tools. **Select** marks a rectangle with a drag, and **Lasso** a
  freehand area along the path of the drag. The options choose what a new shape does: a new area,
  added to the area, subtracted from it, or only the part that both share. For one drag, Shift
  adds, Alt subtracts, and Shift and Alt together keep the shared part. Thus, the area can have any
  shape, and holes. Its edge shows as black and white dashes.
- A drag that starts inside the area moves it. The options choose what it moves: the area alone, or
  the ink of the current layer in it. A move of the ink is one step for undo.
- With an area, two buttons show. **Crop layer** cuts the ink
  of the current layer to the area: the rest no longer shows, but lines that you draw after it are
  not cut. **Crop image** makes the picture the area, and Done saves only that part. A second crop
  stays inside the first. Escape, a tap with Select, or the close button removes the area. Each
  crop is one step for undo.
- The area stays when you change the tool, and limits where the pen, the eraser, the shapes and the
  fill apply. A line that crosses its edge stops there. The line keeps that limit after the area is
  removed.
- Clear empties the current layer.
- Each stroke, shape, fill, clear, and change to a layer is one step that undo takes back and redo does again.
  The choice of the layer to draw on is not a step. A new change after an undo removes the steps to
  redo.
- The layers and the steps are only for the open pad. Done flattens the layers that show into one
  picture. Hidden layers are not in it.
- The paper is 1600 by 1200 and opaque. Thus, a drawing looks the same on a note of any color and in
  both themes. At the zoom that fits, it shows as large as possible, and keeps its shape.
- Only one pointer draws at a time, the first one down. The pad ignores a second finger or a palm
  that rests on the screen.
  - No gesture of the page takes a stroke away (only the paper has `touch-action: none`).
  - The stroke follows the pointer past the edge of the paper.
  - When the system cancels a touch, the pad keeps what you drew.
- If the pad has a drawing, it asks before it closes, from the close button, Escape or Back. If you
  do not discard, Back stays with the pad. Done with no ink that shows adds nothing. An eraser
  alone, or a layer at no opacity, shows no ink. Done, or a close while the pen is still down,
  includes the line that you draw, and a polygon in progress.
- If the app cannot make the picture, the pad tells you, and stays open with the drawing on it.
- The pad is not available on a note that you cannot change (shared to view, or an auto-note).
- The pad and all of its drawing code load the first time that it opens. The board does not load
  them.

### Drawing over an image

Each image in an open note has a **Draw on image** button adjacent to its delete button. Both show
when the pointer is on the image, and always on a touch screen. The button opens that image on the
pad as the paper. Done puts the result in the position of the image (at the end, if you removed the
image in the meantime). Use this to change a drawing after you save it, and to add notes on a photo.

- After a drawing is on the note, it is a picture. Thus, its old lines and layers are part of the
  paper. Undo, clear and the eraser apply only to the lines of this session, and the eraser does not
  remove the picture. To keep the strokes, the app needs a place to store them with the image.
- The paper gets the shape of the image. Its long edge is a minimum of 1600, the size of a new
  drawing (a line drawn on a thumbnail looks like blocks), and a maximum of `MAX_IMAGE_EDGE`. The app
  scales the pens, so that they look the same width on the screen.
- The result is a PNG, which keeps lines sharp each time you open a drawing again. If the PNG is more
  than one megabyte, as over a photo, the result is a JPEG. An animated GIF becomes a still image.
- Done with nothing drawn does not change the image. The drawing replaces the original in the note. The
  version of the edit keeps the original, and a restore of it brings the original back. The drawing gets its description, which still tells what is under the
  lines.

### Describing an image

Each image in an open note also has a **Describe image** button. It opens the image viewer with the
focus on a description field under the image. The viewer has the field when you can change the note.
A screen reader reads the description in place of the image. Each view of the note shows it as the
`alt` of the image, and uses it as the name of the open button of the image. The app saves it when
the field loses focus, or the viewer goes to a different image or closes, and only if it changed. See
[Images](../data-model.md#images) for how the app keeps it, and [Accessibility](../accessibility.md).

## Shrinking on attach

In both modes, before the app stores an image, the client gives it a correct size
(`utils/shrinkImage.ts`):

- If an image is larger than 2560 pixels on its long edge, the client draws it again at 2560 and
  encodes it again. It uses WebP (JPEG where the browser cannot encode WebP), or PNG if it was a PNG.
  Thus, screenshots stay sharp.
- If an image is within that edge but is more than one megabyte, the client encodes it again only if
  that makes it smaller.
- The client keeps smaller images and GIFs byte for byte. A new draw of a GIF stops its animation.

A phone photo usually becomes a few hundred kilobytes. The new draw removes its EXIF data (camera,
location). The 5 MB limit is the maximum for images that the client does not make smaller.

## Sealed in the browser

In connected mode, the client encrypts an image before it uploads it. The server stores bytes that it
cannot read ([Encryption](encryption.md#images)):

- **Its key** comes from the account key of the uploader and the bytes of the image (an HMAC). The
  client seals the image under it with AES-256-GCM.
- **Its address** is a second HMAC of the bytes, under a different key of the account. The server
  finds an attachment by it. Thus, if the same image comes again (a conflict retry, a stale tab, a
  duplicate note), it resolves to the existing attachment. The address tells nothing to a person
  without the key.
- **The key goes in the note.** The sealed list of images of the note contains the id, the key and
  the type of each image. Thus, all devices of the account, and all persons who share the note, can
  open them. The sealed previews contain the thumbnail and icon of a preview in the same way. In the
  app, a note names its images only by reference. The keys wait adjacent to it (`Sealer` in
  `storage/sealing.ts`), until the app seals them back in.
- **The client tells and checks the type.** The sealing client reads it from the first bytes of the
  image (PNG, JPEG, GIF, WebP, AVIF), whatever the stated type of the file, and refuses all other
  types. The opening client accepts only those five types, and checks the first bytes again after it
  decrypts, because the person who attached the image wrote the type in the note. The client does not
  show an image that fails.

## How an image gets there

The client uploads each image when you attach it: `POST /api/v1/attachments` with the sealed bytes
(no base64) and the address of the image in `X-Attachment-Address`. The answer is
`{ ref: "attachment:<id>" }`.

- The editor draws the image immediately from the local file, and shows the progress of the upload.
  It puts the reference in the note when the upload is stored.
- A failed upload stays in the editor, with a mark, **Try again** and **Remove**. The editor does not
  save a note that refers to nothing.
- When the editor closes, it cancels the uploads that are not complete.
- The REST adapter also uploads each image that is still inline in a note write (an import, a share
  to the app). Thus, it sends only references.

The server stores what it gets as bytes with no stated type. A sealed image looks the same as all
other data. Thus, the server does not read its first bytes now.

- An upload without an address, or with no content, gets 422.
- An upload that is larger than the image limit (plus the 28 bytes that the seal adds) gets 413.
- The server stores an upload under the uploader, one time for each address.

## Reading

`GET /api/v1/attachments/:id` returns the sealed bytes as `application/octet-stream`. It returns them
to the owner, and to each person with an accepted share of a note of the owner that refers to it,
while the owner did not trash that note. All other persons get a 404.

- The response has `Cache-Control: private, immutable` (an id always names the same bytes),
  `nosniff`, and a sandboxing CSP.
- It has its own rate limit for each user, which is higher than that of the notes API, because a grid
  asks for one image for each card.

The client gets each attachment one time in each session. It opens the attachment with the key that
its note has, and shows it through a `blob:` URL of its real type (`state/attachments.ts`,
`components/StoredImage.tsx`). The CSP of the page already permits this.

## Leaving the session

All data that goes out of the session contains the bytes, never a reference that only this server
can read. The export zip and the JSON download of one note inline each attachment again. If they
cannot, they stop with an error, and do not write a file without a picture. When you import such a
file into a server, the server stores the images again.

## Sweeping

`attachments.sweep` runs each hour on `startPeriodicJob` (`jobs/attachmentCleanup.ts`):

- It marks an attachment to which no note and no version refers, with the time when it found it.
- It clears the mark when a note or a version refers to it again.
- It deletes it after it is unreferenced for 90 days.

A version names the images of the note from before an edit (`image_refs` on `note_versions`).
Thus, a version that you restore within its life finds its images, also a picture that the drawing
pad replaced. A recipient of a shared note can read the images of its versions too.

## Note writes

A note names its images inside ciphertext. Thus, a write that contains the sealed list also contains
the references that it names (`imageRefs`, and `previewRefs` for link previews). These are the record
of the server of which attachments a note uses, to serve them to its recipients and for the sweep.
Each must be an `attachment:<id>` reference. The server refuses all other values with 422. Note
writes have the same 1 MiB body limit as the remaining API. Only uploads (one sealed image, up to the
image limit) can be larger.

Each attachment to which a note refers belongs to the owner of the note. The server sweeps it with
the notes of the owner, and deletes it with the account of the owner. A person can change a reference
under a readable note, but not under a sealed note. Thus, the image must belong to the owner before
the note is sealed:

- **`POST /api/v1/attachments/claim`** takes `{ noteId?, refs }`, and answers `{ refs }`: the own
  reference of the owner for each one, in order.
  - A reference that the owner already has comes back as it is.
  - A reference that a different account has (the own upload of an editor, or an image copied out of
    a note shared with them) is stored again for the owner, under a new id, if the caller can read it.
    The sealed bytes are the same. Thus, the key in the note still opens them.
  - `noteId` is the note that the caller writes next. It is absent for a new note, whose owner is the
    caller.
  - The server refuses a viewer (403), and a reference that the caller cannot read (422).
  - A token that contains keys does not call it. When the server seals a write from a token, it gives
    the images to the owner. The key kept with the upload of the token goes into the note, under the
    reference of the owner.
- **The write** then names the references that it got. If one does not belong to the owner by then,
  the server refuses it with 422 (`attachments/store.ts`). If not, a crafted reference could give a
  note the image of a different person.

Before this design, only development databases had inline images. Migration
`0013-drop-inline-images` removed them, and did not move them.

## Open mode

Images go into an IndexedDB store, with the SHA-256 of their bytes as the key. Thus, an image that you
attach two times is stored one time.

- IndexedDB holds binary data, and gets a part of the disk, not only the few megabytes of
  `localStorage`.
- The first stored image asks the browser to keep the storage of the site persistent
  (`navigator.storage.persist()`), because in open mode it is the only copy.
- A refusal because there is no space gets the same report as for `localStorage`
  (`storage/quota.ts`). The attachment stays in the editor, with a retry.
- On load, the app sweeps images to which no note and no kept version refers now (a note deleted
  permanently, a removed image), after one day. This protects an image that you just attached to an unsaved draft.
- Images from before this design, inline in notes, move into IndexedDB on the first load.
- As open-mode notes, they belong to one browser profile. Export and import move them, as `data:`
  URLs.

## Storage

Attachments are in the database (`attachments`: `BLOB` in SQLite, `BYTEA` in Postgres). Thus, a
database backup is a complete backup. Later, a disk backend or an S3-compatible backend behind the
same `AttachmentsRepo` is possible. That also lets users attach files that are not images.
