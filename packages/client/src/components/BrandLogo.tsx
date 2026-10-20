import type { Logo } from "#/config.ts";

/**
 * One of the branding logos, as the current theme needs it: its dark variant in
 * the dark theme if it has one, or the light variant, inverted there if it asks
 * for that. Both variants are in the page, and CSS selects. Thus, a theme
 * change shows the other variant immediately, not after a render. Decorative:
 * each place that draws a logo names it next to it.
 */
export function BrandLogo({ logo, class: cls }: { logo: Logo; class: string }) {
  if (!logo.dark) {
    return (
      <img
        src={logo.light}
        alt=""
        class={`${cls} ${logo.invertInDark ? "dark:invert" : ""}`}
      />
    );
  }
  return (
    <>
      <img src={logo.light} alt="" class={`${cls} dark:hidden`} />
      <img src={logo.dark} alt="" class={`${cls} hidden dark:block`} />
    </>
  );
}
