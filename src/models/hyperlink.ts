export interface HyperlinkEntry {
  label: string;
  url: string;
}

export interface HyperlinkSet {
  sourceUrl: string;
  modifiedOn?: string;
  entries: HyperlinkEntry[];
}

export interface ResolvedHyperlink {
  label: string;
  href: string;
  sourceUrl: string;
}
