import type { Logo } from "../config.js";

/**
 * One of the branding logos, as the current theme wants it: its dark variant
 * in the dark theme if it has one, else the light one, inverted there if it
 * asks to be. Both variants are in the page and CSS picks, so a theme switch
 * shows the other at once rather than after a render. Decorative: every place
 * that draws a logo names what it is beside it.
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
