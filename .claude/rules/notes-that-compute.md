---
paths:
  - "packages/client/src/utils/evaluateExpression.ts"
  - "packages/client/src/extensions/inlineCalculations.ts"
  - "packages/client/src/utils/linkPreview.ts"
---

# Notes That Compute

Two unrelated features make a note more than text, and both run on every render of a card:

- `utils/evaluateExpression.ts` is a hand-written tokenizer and shunting-yard parser for trailing
  arithmetic (`200+300` at the end of a line), wired in by `extensions/inlineCalculations.ts`. It
  is hand-written rather than `eval`-shaped on purpose, and it accepts the comma decimal separator.
- `utils/linkPreview.ts` extracts URLs for the preview cards. Its trailing-punctuation regex uses a
  *bounded* quantifier, since an unbounded one backtracks quadratically on a long note and freezes
  the tab during render. Keep quantifiers bounded in anything reachable from a card render.
