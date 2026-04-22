import { describe, expect, it } from "vitest";
import { evaluateExpression, formatResult } from "./evaluateExpression.js";

describe("evaluateExpression — dot decimal", () => {
  const ev = (s: string) => evaluateExpression(s, ".");

  it("evaluates simple binary addition", () => {
    expect(ev("200+300=")).toEqual({ expression: "200+300", result: 500 });
  });

  it("evaluates with surrounding whitespace", () => {
    expect(ev("  200 + 300 =")?.result).toBe(500);
  });

  it("handles decimal numbers", () => {
    expect(ev("1.5*2=")?.result).toBe(3);
    expect(ev("0.1+0.2=")?.result).toBeCloseTo(0.3, 10);
  });

  it("respects operator precedence", () => {
    expect(ev("2+3*4=")?.result).toBe(14);
  });

  it("handles parentheses", () => {
    expect(ev("(2+3)*4=")?.result).toBe(20);
  });

  it("supports unary minus at start", () => {
    expect(ev("-5+10=")?.result).toBe(5);
  });

  it("supports unary minus after operator", () => {
    expect(ev("10*-2=")?.result).toBe(-20);
  });

  it("strips commas as grouping separators", () => {
    expect(ev("1,000+500=")?.result).toBe(1500);
    expect(ev("1,5+1=")?.result).toBe(16);
  });

  it("rejects division by zero", () => {
    expect(ev("10/0=")).toBeNull();
  });

  it("rejects invalid input", () => {
    expect(ev("foo=bar")).toBeNull();
    expect(ev("hello=")).toBeNull();
    expect(ev("200+=")).toBeNull();
    expect(ev("200++300=")).toBeNull();
    expect(ev("(2+3=")).toBeNull();
    expect(ev("2+3)=")).toBeNull();
  });

  it("rejects missing trailing equals", () => {
    expect(ev("200+300")).toBeNull();
  });

  it("rejects double decimal separator in one number", () => {
    expect(ev("1.2.3+1=")).toBeNull();
  });

  it("only matches the tail — prose before is fine if separated by whitespace", () => {
    expect(ev("note: 2+2=")?.result).toBe(4);
  });

  it("rejects when expression is glued to prose without whitespace", () => {
    expect(ev("foo200+300=")).toBeNull();
  });

  it("rejects empty / whitespace-only expression", () => {
    expect(ev("=")).toBeNull();
    expect(ev("   =")).toBeNull();
  });
});

describe("evaluateExpression — comma decimal", () => {
  const ev = (s: string) => evaluateExpression(s, ",");

  it("evaluates with comma decimals", () => {
    expect(ev("1,5*2=")?.result).toBe(3);
  });

  it("strips dots as grouping separators", () => {
    expect(ev("1.000+500=")?.result).toBe(1500);
  });

  it("respects operator precedence with commas", () => {
    expect(ev("2,5+1,5*2=")?.result).toBe(5.5);
  });

  it("rejects double comma in one number", () => {
    expect(ev("1,2,3+1=")).toBeNull();
  });
});

describe("formatResult", () => {
  it("renders integers as integers", () => {
    expect(formatResult(500, ".")).toBe("500");
    expect(formatResult(-7, ".")).toBe("-7");
  });

  it("renders decimals with dot", () => {
    expect(formatResult(1.5, ".")).toBe("1.5");
    expect(formatResult(0.3, ".")).toBe("0.3");
  });

  it("renders decimals with comma when requested", () => {
    expect(formatResult(1.5, ",")).toBe("1,5");
    expect(formatResult(500, ",")).toBe("500");
  });

  it("trims trailing zeros", () => {
    expect(formatResult(1.1, ".")).toBe("1.1");
    expect(formatResult(2.5, ".")).toBe("2.5");
  });
});
