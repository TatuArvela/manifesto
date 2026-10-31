# Drawing pad

**Draw**, the pen adjacent to the add-image button in the toolbar of an open note, opens a drawing
pad: a sheet of white paper. You draw on it with a finger, a pen or a mouse. Done puts the drawing on
the note as a PNG image, through the same path as an attached picture
([Attachments](attachments.md)). Thus, the app stores, shows, shares and exports it as a picture,
and it uses one of the image slots of the note.

- **Inks**: there are two inks, a foreground ink and a background ink. Each one shows as a color
  field that takes any other ink. At the top of the colors, a hex field takes the foreground ink as
  `#rrggbb` or `#rgb` (the `#` is optional). A complete color applies as you type it. The colors are
  ten families (gray, brown, red, pink, orange, yellow, green, teal, blue, purple), each in a dark,
  a base, a light and a pale shade. The gray family goes from black to white. A wide screen shows
  all forty, two families on each row. A phone shows the base shades, and all of the grays. A press
  on a color sets the foreground ink, and a right click sets the background ink. **Swap inks**
  exchanges them. Lines, outlines and fills use the foreground ink. The inside of a shape uses the
  background ink.
- **Tools**, in this order: Move, Selection (a menu of Rectangle select, Ellipse select, Lasso and
  Polygonal lasso), Crop, Eyedropper, Pen, Eraser, Fill, Shapes, Hand and Zoom.
  - **Pen** draws a free line. A tap makes a dot.
  - **Eraser** takes ink away from the current layer only. The layers under it, and the image under
    the drawing, stay. It has the tip of the pen, and is four times the size of the pen.
  - **Fill** fills the area around the press that has the color there, as the drawing shows it,
    with the foreground ink, on the current layer. It stops at a line, and covers the soft edge of
    the line. Hidden layers do not count.
  - **Eyedropper** takes the foreground ink from where you press on the drawing, as it shows with
    all layers and the image. Then the tool from before comes back.
  - **Shapes** opens a menu of four tools, which a press outside it closes: **Line**, **Rectangle**, **Ellipse** and **Polygon**. A drag
    draws a line, or a box or an ellipse in the box of the drag. With Shift, a line goes in steps
    of 15 degrees, and a box or an ellipse has equal sides. A polygon gets a corner at each press.
    A press on the first corner, or a double click, closes it. Escape or Undo discards it, and so
    does a change from the other controls of the top bar or the layer list. A shape with no size
    draws nothing.
  - The selection tools and **Move** are described below. **Hand** drags the view.
  - **Zoom** (Z) zooms in at the place of a click, and out with Alt and a click.
- On a wide screen, the tools and the two inks are a rail at the left of the paper, the options of
  the current tool a bar over the paper, and the colors, the layers, the history and the picture
  size panels at the right. The heading of each panel at the right collapses it, and opens it
  again. On a phone, the inks and the colors are one row under the paper, and
  the tools a row under that. The options, the layers, the history and the picture size are panels
  that a button of the tools row opens. The names and labels of the pad cannot be selected as text;
  the fields can.
- **History** lists each step of the drawing (Pen, Fill, New layer, Canvas size and so on), from
  Open at the top. A press on a step shows the drawing as it was after that step, as that many
  undos or redos. The steps after it stay, paler, until a new change replaces them.
- **Picture size** changes the size of the picture in pixels, or in percent of the size now. It
  shows the megapixels and the shape (for example `16 : 9`). The link keeps the shape. Each edge
  is from 1 to 2560 pixels. **Apply** is one step for undo, and removes the selected area.
  Canvas and Image keep their own fields, unit and link. The undo button next to Apply puts the
  fields of the open tab back to the size now. A field takes arithmetic (`1920 / 2`), and shows
  the result on Enter or when focus leaves it. Up and Down step the value by 1, or by 10 with
  Shift.
  - **Canvas** gives the picture a new size, and the drawing keeps its size. A larger canvas adds
    paper, and a smaller one crops. The anchor (one of nine places) is where the picture stays.
  - **Image** stretches the drawing, and the image under it, to the new size. A line becomes as much
    wider as the area that it covers.
- **Pen settings** shows only the options of the current tool. It sets the tip (round, square, or a tilted oval as a broad nib), the size (three
  sizes or a field from 1 to 200), the opacity of the ink (5 to 100 percent), and what a shape draws
  (its outline, its inside, or both). The size and the opacity apply to all tools. The tip applies
  to the pen, the line and the eraser. A square or oval tip presses its shape along the line. The shapes make
  one area, so a transparent ink does not become darker where they overlap.
- A shape in the size and tip of the pen, the line or the eraser follows the pointer, and a finger
  while it touches. Thus, you see where a stroke will apply before you draw it.
- **Zoom**: the buttons in the top bar zoom out and in, from a quarter to 16 times the size that
  fits the screen. Ctrl or Cmd with the mouse wheel zooms at the pointer, and the wheel alone moves
  the view. The field between the buttons is the size of the paper on the screen, in percent.
  You can type a new size in it: Enter sets it, and Escape gives back the old one. **Fit to
  screen**, after the buttons, fits the paper to the screen again. A zoom keeps the point at the middle, or under the pointer,
  in place. A zoom changes the view only, not the picture. From twice the size, each pixel of the
  picture shows as a square.
- The screen and the picture are separate. The screen shows the paper at the zoom and the place of
  the view, with a margin around it, also at the zoom that fits. The tools work in the margin: a
  line can start there, and a handle at the edge of the paper is in reach. The middle of the view
  stays over the paper.
- Undo, redo, and clear are in the top bar. Ctrl or Cmd with Z undoes, and with Y, or with Shift
  and Z, redoes. In a text field, the keys undo the typing.
- The drawing has layers. The **Layers** panel lists them, the top layer first. At the top, a slider
  with an eye icon sets the opacity of the current layer. One slide is one step for undo. Each row
  has an eye that hides or shows the layer, a small picture of its ink, and its name. Press a row
  to draw on that layer. The buttons at the bottom add a layer over the current one (to a maximum
  of eight), rename the current layer, move it up or down, and delete it (not the last layer). A
  double press on a row also renames the layer. Enter or a press outside keeps the name, and Escape
  keeps the old one. A name has a maximum of 40 characters, and an empty name gives the layer its
  numbered name again. Each rename is one step for undo. A line that you draw on a hidden layer
  shows that layer again.
- **Move** shows a dashed box around the ink of the current layer. A drag moves the ink. A drag of
  one of the handles at its four corners makes it larger or smaller, from the opposite corner, with
  the same scale on both axes (from 0.05 to 20 times). A hidden layer shows no box and does not
  move. A drag is one step.
- **Selection** opens a menu of four tools. **Rectangle select** marks a rectangle with a drag,
  **Ellipse select** an ellipse, and **Lasso** a freehand area along the path of the drag.
  **Polygonal lasso** adds a corner with each tap. A tap on the first corner or a double click
  closes the area, and Escape cancels it. M picks Rectangle select, and again Ellipse select. L
  picks Lasso, and again Polygonal lasso. The tooltip of each tool shows its key.
- **Crop** (C) marks the part of the picture to keep with a drag, and darkens the rest. A new drag
  marks it again. **Crop image** under the paper, or Enter, keeps only that part, as one step for
  undo. Escape, the close button or another tool removes the box.
- Ctrl or Cmd with A selects all of the paper that shows, with D removes the area, and with Shift and
  I inverts the area. Delete or Backspace removes the ink of the current layer inside the area, as one
  step for undo. The options choose what a new shape does: a new area,
  added to the area, subtracted from it, or only the part that both share. For one drag, Shift
  adds, Alt subtracts, and Shift and Alt together keep the shared part. Thus, the area can have any
  shape, and holes. Its edge shows as black and white dashes.
- A drag that starts inside the area moves it. The options choose what it moves: the area alone, or
  the ink of the current layer in it. A move of the ink is one step for undo.
- With an area, two buttons show. **Crop layer** removes the ink of the current layer outside the
  area. **Crop image** makes the picture the area, and Done saves only that part. A second crop
  stays inside the first. Escape, a tap with a selection tool, Ctrl or Cmd with D, or the close button removes the area. Each
  crop is one step for undo.
- The area stays when you change the tool, and limits where the pen, the eraser, the shapes and the
  fill apply. A line that crosses its edge stops there. The line keeps that limit after the area is
  removed.
- The pad is a bitmap tool. Ink, once drawn, is pixels. A move, a resize, a move of the ink in an
  area, and Crop layer first make the ink of the layer one picture. Thus, a resize makes the ink
  less sharp. An undo of the change brings back the ink from before it.
- A layer goes past the edge of the paper. Ink that you move off the paper stays, and comes back
  when you move it back. The picture keeps only the paper. The layer keeps a margin of half the
  paper on each side, less on a large image (a canvas has a limit of pixels). Ink past the margin
  is gone at the next move.
- Clear empties the current layer.
- Each stroke, shape, fill, clear, and change to a layer is one step that undo takes back and redo does again.
  The choice of the layer to draw on is not a step. A new change after an undo removes the steps to
  redo.
- The layers and the steps are only for the open pad. Done flattens the layers that show into one
  picture. Hidden layers are not in it.
- The paper is 1600 by 1200 and opaque. Thus, a drawing looks the same on a note of any color and in
  both themes. At the zoom that fits, it shows as large as possible inside the margin, and keeps its
  shape.
- Only one pointer draws at a time, the first one down. The pad ignores a second finger or a palm
  that rests on the screen.
  - No gesture of the page takes a stroke away (only the screen has `touch-action: none`).
  - The stroke follows the pointer past the edge of the paper, onto the layer there.
  - When the system cancels a touch, the pad keeps what you drew.
- If the pad has a drawing, it asks before it closes, from the close button, Escape or Back. If you
  do not discard, Back stays with the pad. Done with no ink that shows adds nothing. An eraser
  alone, or a layer at no opacity, shows no ink. Done, or a close while the pen is still down,
  includes the line that you draw, and a polygon in progress.
- If the app cannot make the picture, the pad tells you, and stays open with the drawing on it.
- The pad is not available on a note that you cannot change (shared to view, or an auto-note).
- The pad and all of its drawing code load the first time that it opens. The board does not load
  them.

## Drawing over an image

Each image in an open note has a **Draw on image** button adjacent to its delete button. Both show
when the pointer is on the image, and always on a touch screen. The button opens that image on the
pad as the paper. Done puts the result in the position of the image (at the end, if you removed the
image in the meantime). Use this to change a drawing after you save it, and to add notes on a photo.

- The image is the bottom layer, named Picture, under an empty layer for the pen. You can erase,
  move, select, hide, delete and change the opacity of it as of any other layer.
- After a drawing is on the note, it is a picture. Thus, its old lines and layers are part of the
  Picture layer when it opens again. To keep the strokes, the app needs a place to store them with
  the image.
- The paper is the own size of the image. Thus, the image keeps its pixels, and is not stretched.
  A pen width is in pixels of the paper, on paper of any size. Thus, the same width looks wider
  on a small image than on a large one.
- The result is a PNG, which keeps lines sharp each time you open a drawing again. If the PNG is more
  than one megabyte, as over a photo, the result is a JPEG. An animated GIF becomes a still image.
- Done with no step since the pad opened does not change the image. The drawing replaces the
  original in the note. The version of the edit keeps the original, and a restore of it brings the
  original back. The drawing gets its description, which still tells what is under the
  lines.
