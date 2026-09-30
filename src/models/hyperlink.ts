export interface HyperlinkEntry {
  label: string;
  url: string;
}

export interface HyperlinkSet {
  sourceUrl: string;
  /** Saved source URL (or the built-in hyperlinks file) this set was reached from. */
  librarySourceUrl?: string;
  modifiedOn?: string;
  entries: HyperlinkEntry[];
}

export interface ResolvedHyperlink {
  label: string;
  href: string;
  sourceUrl: string;
}
