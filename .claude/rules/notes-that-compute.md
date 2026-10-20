---
paths:
  - "packages/client/src/utils/evaluateExpression.ts"
  - "packages/client/src/extensions/inlineCalculations.ts"
  - "packages/client/src/utils/linkPreview.ts"
---

# Notes That Compute

Two features make a note more than text. The features are not related. Both run each time a card
renders:

- `utils/evaluateExpression.ts` is a tokenizer and shunting-yard parser for arithmetic at the end of
  a line (`200+300`). `extensions/inlineCalculations.ts` connects it to the editor. We wrote the
  parser by hand on purpose, so that it does not operate like `eval`. It accepts a comma as the
  decimal separator.
- `utils/linkPreview.ts` finds the URLs for the preview cards. Its regex for punctuation at the end
  of a URL uses a *bounded* quantifier. An unbounded quantifier backtracks quadratically on a long
  note, and the tab stops during the render. Keep quantifiers bounded in all code that a card
  render can reach.
