import { readFileSync } from "node:fs";
import { SERVER_FEATURES } from "@manifesto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import {
  FEATURES,
  featureStates,
  isFeatureOn,
  loadFeatureToggles,
} from "./features.js";
import { TEST_CONFIG } from "./test/setup.js";

/** The same reading of a boolean `loadConfig` uses, over a given env. */
function parserFor(env: NodeJS.ProcessEnv) {
  return (name: string, fallback: boolean) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    return /^(1|true|yes|on)$/i.test(raw);
  };
}

const load = (env: NodeJS.ProcessEnv, webhooksOn = true) =>
  loadFeatureToggles(env, parserFor(env), webhooksOn);

describe("feature registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("describes every feature the capabilities report", () => {
    expect(Object.keys(FEATURES).sort()).toEqual([...SERVER_FEATURES].sort());
    const vars = Object.values(FEATURES).map((spec) => spec.env);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("keeps each default when nothing is set", () => {
    const toggles = load({});
    for (const [feature, spec] of Object.entries(FEATURES)) {
      if (feature === "webhooks") continue;
      expect(toggles[feature as keyof typeof toggles], feature).toBe(
        spec.default === "on",
      );
    }
    expect(toggles.adminExport).toBe(false);
  });

  it("reads each variable", () => {
    const toggles = load({ SHARING: "off", CALENDAR: "0", ADMIN_EXPORT: "on" });
    expect(toggles).toMatchObject({
      sharing: false,
      calendar: false,
      adminExport: true,
    });
  });

  it("turns a feature off with its requirement when its own variable is unset", () => {
    expect(load({ SHARING: "off" }).teams).toBe(false);
  });

  it("refuses to start when a feature is asked for without its requirement", () => {
    expect(() => load({ SHARING: "off", TEAMS: "on" })).toThrow(
      /TEAMS is on, but it needs SHARING/,
    );
  });

  it("asks requirements at run time too", () => {
    const cfg = { ...TEST_CONFIG, sharing: false, teams: true };
    expect(cfg.teams).toBe(true);
    expect(isFeatureOn(cfg, "teams")).toBe(false);
    expect(featureStates(cfg)).toMatchObject({ sharing: false, teams: false });
    expect(
      isFeatureOn({ ...TEST_CONFIG, webhooks: "private" }, "webhooks"),
    ).toBe(true);
  });

  it("is what loadConfig reads, existing variables unchanged", () => {
    vi.stubEnv("PUBLIC_LINKS", "off");
    vi.stubEnv("WEBHOOKS", "private");
    vi.stubEnv("PASSKEYS", "off");
    const cfg = loadConfig();
    expect(cfg.publicLinks).toBe(false);
    expect(cfg.webhooks).toBe("private");
    expect(cfg.passkeys).toBe(false);
    expect(cfg.linkPreviews).toBe(true);
    expect(cfg.mcp).toBe(true);
    expect(cfg.adminExport).toBe(false);
  });

  it("is listed where a host looks for it", () => {
    const deployment = readFileSync(
      new URL(
        "../../../docs/specification/server/deployment.md",
        import.meta.url,
      ),
      "utf8",
    );
    const section = deployment.split("### Turning features off")[1] ?? "";
    for (const spec of Object.values(FEATURES)) {
      expect(section, spec.env).toContain(`\`${spec.env}\``);
    }
  });
});
