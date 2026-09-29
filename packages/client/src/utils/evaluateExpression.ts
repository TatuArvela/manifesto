type Operator = "+" | "-" | "*" | "/";
type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: Operator }
  | { kind: "unary-minus" }
  | { kind: "lparen" }
  | { kind: "rparen" };

const PRECEDENCE: Record<Operator, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
};
const UNARY_PRECEDENCE = 3;

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/** Whether `top`, on the operator stack, is applied before `op` is pushed. */
function popsBefore(top: Token | undefined, op: Operator): boolean {
  if (top?.kind === "unary-minus") return UNARY_PRECEDENCE > PRECEDENCE[op];
  if (top?.kind === "op") return PRECEDENCE[top.value] >= PRECEDENCE[op];
  return false;
}

/**
 * Tokenize a tail expression like "200+300" or "(1,5 + 2) * 3" using the
 * provided decimal separator. The other of "." / "," is treated as an
 * in-number grouping char and stripped. Returns null on any invalid input.
 */
function tokenize(text: string, decimal: "." | ","): Token[] | null {
  const grouping = decimal === "." ? "," : ".";
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    if (isDigit(c) || c === decimal) {
      let raw = "";
      let seenDecimal = false;
      while (i < text.length) {
        const d = text[i];
        if (isDigit(d)) {
          raw += d;
          i++;
        } else if (d === grouping) {
          // Strip grouping separator silently
          i++;
        } else if (d === decimal) {
          if (seenDecimal) return null;
          seenDecimal = true;
          raw += ".";
          i++;
        } else {
          break;
        }
      }
      if (raw === "" || raw === ".") return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      tokens.push({ kind: "number", value: n });
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * Shunting-yard: convert infix tokens to RPN.
 *
 * Unary minus (`-x`, `*-x`, `(-x`) is promoted to a dedicated unary-minus
 * token with the highest precedence and right-associativity. Unary plus is
 * not supported; constructs like `200++300` are rejected as invalid.
 */
function toRpn(tokens: Token[]): Token[] | null {
  const output: Token[] = [];
  const stack: Token[] = [];
  let prev: Token | null = null;
  const normalized: Token[] = [];

  for (const tok of tokens) {
    if (tok.kind === "op") {
      const inUnaryPosition =
        prev === null || prev.kind === "op" || prev.kind === "lparen";
      if (inUnaryPosition) {
        if (tok.value === "-") {
          const unary: Token = { kind: "unary-minus" };
          normalized.push(unary);
          prev = unary;
          continue;
        }
        // Unary + or any binary op in a unary slot is invalid.
        return null;
      }
    }
    normalized.push(tok);
    prev = tok;
  }

  // A trailing operator (binary or unary) is invalid.
  const last = normalized.at(-1);
  if (!last || last.kind === "op" || last.kind === "unary-minus") return null;

  for (const tok of normalized) {
    if (tok.kind === "number") {
      output.push(tok);
    } else if (tok.kind === "unary-minus") {
      // Right-associative, highest precedence: don't pop anything.
      stack.push(tok);
    } else if (tok.kind === "op") {
      while (popsBefore(stack.at(-1), tok.value)) {
        output.push(stack.pop() as Token);
      }
      stack.push(tok);
    } else if (tok.kind === "lparen") {
      stack.push(tok);
    } else if (tok.kind === "rparen") {
      let matched = false;
      while (stack.length) {
        const top = stack.pop() as Token;
        if (top.kind === "lparen") {
          matched = true;
          break;
        }
        output.push(top);
      }
      if (!matched) return null;
    }
  }
  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.kind === "lparen" || top.kind === "rparen") return null;
    output.push(top);
  }
  return output;
}

function evalRpn(rpn: Token[]): number | null {
  const stack: number[] = [];
  for (const tok of rpn) {
    if (tok.kind === "number") {
      stack.push(tok.value);
    } else if (tok.kind === "unary-minus") {
      const a = stack.pop();
      if (a === undefined) return null;
      stack.push(-a);
    } else if (tok.kind === "op") {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return null;
      let r: number;
      switch (tok.value) {
        case "+":
          r = a + b;
          break;
        case "-":
          r = a - b;
          break;
        case "*":
          r = a * b;
          break;
        case "/":
          if (b === 0) return null;
          r = a / b;
          break;
      }
      stack.push(r);
    } else {
      return null;
    }
  }
  const [result] = stack;
  if (stack.length !== 1 || result === undefined) return null;
  return Number.isFinite(result) ? result : null;
}

/**
 * Evaluate the arithmetic expression found at the end of `text`, ending
 * immediately before an `=` sign. Returns `{ expression, result }` where
 * `expression` is the matched tail (without the trailing `=`) or `null`
 * if the tail is not a valid expression.
 *
 * The match only succeeds when the expression is either the whole line or
 * preceded by whitespace, so prose like `foo=bar=` does not light up.
 */
export function evaluateExpression(
  text: string,
  decimal: "." | ",",
): { expression: string; result: number } | null {
  if (!text.endsWith("=")) return null;
  const body = text.slice(0, -1);
  if (body.length === 0) return null;

  // Walk backwards to find the start of an allowed-char run.
  const grouping = decimal === "." ? "," : ".";
  let start = body.length;
  while (start > 0) {
    const c = body[start - 1];
    if (
      isDigit(c) ||
      c === decimal ||
      c === grouping ||
      c === "+" ||
      c === "-" ||
      c === "*" ||
      c === "/" ||
      c === "(" ||
      c === ")" ||
      c === " " ||
      c === "\t"
    ) {
      start--;
    } else {
      break;
    }
  }
  // Require a separator between prose and the expression: either the char
  // immediately before the matched region is whitespace, or the matched
  // region itself starts with whitespace.
  if (start > 0) {
    const prev = body[start - 1];
    const startsWithWs = body[start] === " " || body[start] === "\t";
    const prevIsWs = prev === " " || prev === "\t" || prev === "\n";
    if (!startsWithWs && !prevIsWs) return null;
  }

  const expression = body.slice(start);
  if (expression.trim() === "") return null;
  // Must contain at least one digit and one operator for a useful calc.
  if (!/\d/.test(expression)) return null;

  const tokens = tokenize(expression, decimal);
  if (!tokens || tokens.length === 0) return null;
  const rpn = toRpn(tokens);
  if (!rpn) return null;
  const result = evalRpn(rpn);
  if (result === null) return null;
  return { expression, result };
}

/**
 * Format a calculated result using the given decimal separator. Integers are
 * rendered without a fractional part; non-integers use up to 10 significant
 * digits with trailing zeros trimmed. No thousand separators.
 */
export function formatResult(n: number, decimal: "." | ","): string {
  if (!Number.isFinite(n)) return "";
  let s: string;
  if (Number.isInteger(n)) {
    s = String(n);
  } else {
    s = n.toPrecision(10);
    // Strip trailing zeros after decimal point (and the point itself if bare).
    if (s.includes(".") && !s.includes("e")) {
      s = s.replace(/\.?0+$/, "");
    } else if (s.includes("e")) {
      // Fallback for very large/small: just use default toString.
      s = String(n);
    }
  }
  return decimal === "," ? s.replace(".", ",") : s;
}
