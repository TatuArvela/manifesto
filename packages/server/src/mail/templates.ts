/**
 * The mail this server sends, in the languages the client speaks. The server
 * has no catalogue of its own, so the few messages it writes live here, and
 * the client says which language it wants when it asks for one to be sent.
 */

export const MAIL_LOCALES = ["en", "fi"] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

export function mailLocale(raw: string | undefined): MailLocale {
  return (MAIL_LOCALES as readonly string[]).includes(raw ?? "")
    ? (raw as MailLocale)
    : "en";
}

export function passwordResetMail(
  locale: MailLocale,
  {
    username,
    link,
    minutes,
  }: { username: string; link: string; minutes: number },
) {
  if (locale === "fi") {
    return {
      subject: "Salasanan vaihtaminen",
      text: [
        `Hei ${username},`,
        "",
        "Joku (toivottavasti sinä) pyysi linkin salasanasi vaihtamiseen. Vaihda se täällä:",
        "",
        link,
        "",
        `Linkki toimii ${minutes} minuuttia ja kerran. Jos et pyytänyt sitä, voit jättää tämän viestin huomiotta; salasanasi pysyy ennallaan.`,
      ].join("\n"),
    };
  }
  return {
    subject: "Reset your password",
    text: [
      `Hello ${username},`,
      "",
      "Someone (hopefully you) asked for a link to reset your password. Set a new one here:",
      "",
      link,
      "",
      `The link works once, for ${minutes} minutes. If you did not ask for it, you can ignore this message; your password stays as it is.`,
    ].join("\n"),
  };
}

export function shareInvitationMail(
  locale: MailLocale,
  { owner, title, link }: { owner: string; title: string; link: string },
) {
  const named =
    title.trim() ||
    (locale === "fi" ? "nimetön muistiinpano" : "an untitled note");
  if (locale === "fi") {
    return {
      subject: `${owner} jakoi kanssasi muistiinpanon`,
      text: [
        `${owner} jakoi kanssasi muistiinpanon: ${named}.`,
        "",
        "Hyväksy tai hylkää kutsu täällä:",
        "",
        link,
      ].join("\n"),
    };
  }
  return {
    subject: `${owner} shared a note with you`,
    text: [
      `${owner} shared a note with you: ${named}.`,
      "",
      "Accept or decline the invitation here:",
      "",
      link,
    ].join("\n"),
  };
}
