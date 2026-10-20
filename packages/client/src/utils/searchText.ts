/**
 * Text as search compares it: lower case, with accents and other combining
 * marks removed. Thus, "cafe" finds "Café", and "saa" finds "sää". Lower case
 * comes first, because "İ" in lower case gives "i" plus a combining dot that
 * the second step then removes.
 */
export function foldForSearch(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * The words of a query, folded. A note matches when it contains each of them,
 * in any order and anywhere in its title or text. Thus, "milk eggs" finds
 * "eggs, bread and milk", and a word inside Markdown ("**milk**") still counts.
 */
export function searchTerms(query: string): string[] {
  return foldForSearch(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

export function containsTerms(folded: string, terms: string[]): boolean {
  return terms.every((term) => folded.includes(term));
}
