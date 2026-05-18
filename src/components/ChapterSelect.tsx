import React from 'react';

interface ChapterSelectProps {
  books: any[];
  chapters: any[];
  selectedBook: string | null;
  selectedChapter: number;
  handleBookChange: (bookName: string) => void;
  handleChapterChange: (value: string) => void;
}

const ChapterSelect: React.FC<ChapterSelectProps> = ({
  books,
  chapters,
  selectedBook,
  selectedChapter,
  handleBookChange,
  handleChapterChange,
}) => (
  <div className="card border-0 shadow-sm h-100">
    <div className="card-body">
      <h2 className="h6 text-uppercase text-body-secondary mb-3">Navigate</h2>
      <div className="mb-3">
        <label className="form-label small fw-semibold" htmlFor="bookSelect">
          Book
        </label>
        <select
          id="bookSelect"
          className="form-select"
          value={selectedBook ?? ''}
          onChange={(e) => handleBookChange(e.target.value)}
        >
          {books.map((book) => (
            <option key={book.name} value={book.name}>
              {book.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="form-label small fw-semibold" htmlFor="chapterSelect">
          Chapter
        </label>
        <select
          id="chapterSelect"
          className="form-select"
          value={selectedChapter}
          onChange={(e) => handleChapterChange(e.target.value)}
        >
          {chapters.map((chapter) => (
            <option key={chapter.chapter} value={chapter.chapter}>
              {chapter.chapter}
            </option>
          ))}
        </select>
      </div>
    </div>
  </div>
);

export default ChapterSelect;
