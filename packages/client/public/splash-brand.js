/**
 * Puts the brand of the deployment on the loading screen before the first
 * paint.
 *
 * The splash shows the same brand as the top bar. When `header-brand` gives
 * the bar to the instance, that is the logo and name of the instance. If not,
 * it is the mark and name of the app, with the name of the instance (if there
 * is one) under them. The markup in index.html is the usual app brand. This
 * script draws it again from the meta tags that config.ts reads (HEADER_BRAND,
 * APP_LOGO, INSTANCE_LOGO). Thus, it follows a release bundle that a person
 * edited, and also a build. The bundle cannot do it, because the splash is on
 * the screen while the bundle loads.
 *
 * It is a separate file, not an inline script, because the CSP of the page
 * permits scripts only from 'self'. It blocks, and it is immediately after the
 * splash. Thus, it runs before the splash is first drawn. If it does not run,
 * the usual markup stays, and it still shows the correct app.
 */
(() => {
  const splash = document.getElementById("splash");
  const stockLogo = splash?.querySelector("img");
  const bar = splash?.querySelector("div");
  if (!splash || !stockLogo || !bar) return;

  // As `metaValue` in config.ts: an empty value, or a placeholder without
  // substitution, is not set.
  const meta = (name) => {
    const content = document
      .querySelector(`meta[name="${name}"]`)
      ?.content?.trim();
    return !content || /^%[A-Z_]+%$/.test(content) ? null : content;
  };
  // As `resolveLogoUrl`: a bare file name is a file next to index.html. The
  // address of the usual logo already has the base prefix, and tells where
  // that is.
  const logoUrl = (value) =>
    !value || /^(\/|[a-z][a-z0-9+.-]*:)/i.test(value)
      ? value
      : new URL(value, stockLogo.src).href;

  const appName = meta("application-name");
  const instanceName = meta("instance-name");
  const instanceBrand =
    instanceName !== null && meta("header-brand")?.toLowerCase() === "instance";

  const image = (src, attrs) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    for (const name of attrs) img.setAttribute(name, "");
    return img;
  };
  // As `BrandLogo`: in the dark theme, the dark variant if there is one. If
  // not, the light one, which is inverted there only if it is the logo of the
  // app.
  const logo = (light, dark, isApp) => {
    if (!light) return [];
    const shape = isApp ? [] : ["data-wide"];
    if (!dark) return [image(light, isApp ? ["data-invert"] : shape)];
    return [
      image(light, [...shape, "data-light"]),
      image(dark, [...shape, "data-dark"]),
    ];
  };
  const line = (text, attrs) => {
    const p = document.createElement("p");
    p.textContent = text;
    for (const name of attrs) p.setAttribute(name, "");
    return p;
  };

  const parts = instanceBrand
    ? [
        ...logo(
          logoUrl(meta("instance-logo")),
          logoUrl(meta("instance-logo-dark")),
          false,
        ),
        line(instanceName, []),
      ]
    : [
        ...logo(
          logoUrl(meta("app-logo")) ?? stockLogo.src,
          logoUrl(meta("app-logo-dark")),
          true,
        ),
        line(appName ?? splash.querySelector("p")?.textContent ?? "", []),
        ...(instanceName ? [line(instanceName, ["data-secondary"])] : []),
      ];
  splash.replaceChildren(...parts, bar);
})();
