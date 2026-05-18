import React from 'react';

interface VerseDisplayProps {
  verses: any[];
  selectedBook: string | null;
  currentChapter: any;
  focusVerse: number | null;
  verseDomId: (book: string, chapter: number, verse: number) => string;
}

const VerseDisplay: React.FC<VerseDisplayProps> = ({
  verses,
  selectedBook,
  currentChapter,
  focusVerse,
  verseDomId,
}) => (
  <ol className="list-group list-group-flush verses">
    {verses.map((verse) => (
      <li
        key={verse.verse}
        id={verseDomId(selectedBook ?? '', currentChapter.chapter, verse.verse)}
        className={`list-group-item verse-item ${
          focusVerse === verse.verse
            ? 'bg-primary-subtle border-primary text-primary-emphasis'
            : ''
        }`}
      >
        <span className="verse-number">{verse.verse}</span>
        <span className="verse-text">{verse.text}</span>
      </li>
    ))}
  </ol>
);

export default VerseDisplay;
