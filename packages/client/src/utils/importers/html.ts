import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { checkImportSize, type Importer, importedNote } from "./importer.js";

/**
 * A web page or an exported note as HTML: one note, titled by the page's
 * `<title>` or its first heading, its body as Markdown. This is also the way
 * in for Apple Notes, which has no export of its own; the tools that export
 * it write HTML (or Markdown, which imports as it is).
 */
export const htmlImporter: Importer = {
  format: "HTML",
  extensions: [".html", ".htm"],
  async fromFile(file) {
    checkImportSize(file);
    const html = await file.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const heading = doc.querySelector("h1");
    const title =
      doc.title.trim() ||
      heading?.textContent?.trim() ||
      file.name.replace(/\.html?$/i, "");
    // The heading that became the title is not repeated as the first line.
    if (heading && heading.textContent?.trim() === title) heading.remove();
    const modified = file.lastModified
      ? new Date(file.lastModified).toISOString()
      : null;
    return [
      importedNote({
        title,
        content: htmlToMarkdown(doc.body.innerHTML),
        updatedAt: modified,
      }),
    ];
  },
};
