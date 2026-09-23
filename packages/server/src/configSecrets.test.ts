import { describe, expect, it } from "vitest";
import { resolveFileSecrets } from "./config.js";

describe("resolveFileSecrets", () => {
  const files: Record<string, string> = {
    "/run/secrets/db": "postgres://u:p@db/manifesto\n",
    "/run/secrets/oidc": "s3cret",
  };
  const read = (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error("ENOENT");
    return content;
  };

  it("reads FOO from FOO_FILE, without the trailing newline", () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL_FILE: "/run/secrets/db",
      OIDC_CLIENT_SECRET_FILE: "/run/secrets/oidc",
      PORT: "3001",
      COMPOSE_FILE: "/not/ours.yaml",
    };
    resolveFileSecrets(env, read);
    expect(env.DATABASE_URL).toBe("postgres://u:p@db/manifesto");
    expect(env.OIDC_CLIENT_SECRET).toBe("s3cret");
    expect(env.PORT).toBe("3001");
    expect(env.COMPOSE).toBeUndefined();
  });

  it("refuses both, and a file it cannot read", () => {
    expect(() =>
      resolveFileSecrets(
        { DATABASE_URL: "x", DATABASE_URL_FILE: "/run/secrets/db" },
        read,
      ),
    ).toThrow(/not both/);
    expect(() =>
      resolveFileSecrets({ SMTP_URL_FILE: "/missing" }, read),
    ).toThrow(/Cannot read SMTP_URL_FILE/);
  });
});
