/** The SVG of a mask, from its CSS `url("data:image/svg+xml,...")`. */
export function svgOf(url: string): string {
  const match = /^url\("data:image\/svg\+xml,(.*)"\)$/.exec(url);
  return decodeURIComponent(match?.[1] ?? "");
}
