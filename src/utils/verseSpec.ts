/** Expand a verse spec like `1-3` or `9, 10` into individual verse numbers. */
export function expandVerseSpec(verseSpec: string): number[] {
  const output: number[] = [];
  const segments = verseSpec.split(',').map((part) => part.trim()).filter(Boolean);

  for (const segment of segments) {
    if (segment.includes('-') || segment.includes('–')) {
      const [startRaw, endRaw] = segment.split(/[-–]/).map((part) => part.trim());
      const start = Number.parseInt(startRaw ?? '', 10);
      const end = Number.parseInt(endRaw ?? '', 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
        continue;
      }
      for (let verse = start; verse <= end; verse += 1) {
        output.push(verse);
      }
      continue;
    }

    const verse = Number.parseInt(segment, 10);
    if (!Number.isInteger(verse) || verse <= 0) {
      continue;
    }
    output.push(verse);
  }

  return Array.from(new Set(output)).sort((left, right) => left - right);
}
