/**
 * What the changelog timeline needs that is not a word: which version each release is.
 *
 * Everything else about a release — its date, title, summary, highlights, and tagged entries — is in
 * `lib/i18n/locales/changelog`, because a date written as "June 28, 2026" has to read as
 * "28 يونيو 2026" in Arabic. The two lists are read side by side in the page: the English dictionary
 * is the one that fixes the order, and each entry is matched to the release with the same version.
 */
export interface Release {
  version: string;
}

/** Newest first — the page renders this list top-down as a timeline. */
export const releases: Release[] = [
  { version: '1.4' },
  { version: '1.3' },
  { version: '1.2' },
  { version: '1.1' },
  { version: '1.0' },
];