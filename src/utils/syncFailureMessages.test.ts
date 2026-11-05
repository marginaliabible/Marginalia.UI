import { describeSyncFailure, softenUnhandledSyncError } from './syncFailureMessages';

const COPY_PROTECTED = 'pdf2htmlEX failed with exit code 1: Error: Copying of text from this document is not allowed.';

describe('describeSyncFailure', () => {
  it('maps copy-protection to a friendly sentence', () => {
    expect(describeSyncFailure('Protected.pdf', COPY_PROTECTED)).toBe(
      "'Protected.pdf' is copy protected and couldn't be added to your library."
    );
    expect(describeSyncFailure(null, COPY_PROTECTED)).toBe(
      "This file is copy protected and couldn't be added to your library."
    );
  });

  it('maps password / encrypted PDFs', () => {
    expect(describeSyncFailure('Secret.pdf', 'pdf2htmlEX failed with exit code 1: Error: Document is encrypted')).toBe(
      "'Secret.pdf' is password protected and couldn't be added to your library."
    );
  });

  it('softens unhandled converter errors without naming the component', () => {
    expect(describeSyncFailure('Notes.pdf', 'pdf2htmlEX failed with exit code 1: Error: Cannot load font /tmp/pdf2htmlEX-AbCdEf/f5.ttf')).toBe(
      "'Notes.pdf' couldn't be added to your library: PDF to web converter failed: Cannot load font /tmp/pdf2htmlEX-AbCdEf/f5.ttf"
    );
    expect(describeSyncFailure('scan.docx', 'Gotenberg conversion failed (500): LibreOffice failed')).toBe(
      "'scan.docx' couldn't be added to your library: Document extractor failed: LibreOffice failed"
    );
    expect(describeSyncFailure('a.pdf', 'MarkupServer rejected doc-a: conversion failed')).toBe(
      "'a.pdf' couldn't be added to your library: conversion failed"
    );
    expect(
      describeSyncFailure(
        'scan.pdf',
        'Azure Document Intelligence analyze failed (HTTP 400): InvalidRequest: Invalid request.'
      )
    ).toBe(
      "'scan.pdf' couldn't be added to your library: AI OCR engine analyze failed (HTTP 400): InvalidRequest: Invalid request."
    );
  });

  it('falls back when there is no error text', () => {
    expect(describeSyncFailure('notes.pdf')).toBe("'notes.pdf' couldn't be added to your library.");
    expect(describeSyncFailure(undefined, '   ')).toBe("This file couldn't be added to your library.");
  });
});

describe('softenUnhandledSyncError', () => {
  it('replaces exit-code jargon and tool names', () => {
    expect(softenUnhandledSyncError('pdf2htmlEX failed with exit code 1: Error: Cannot read the file')).toBe(
      'PDF to web converter failed: Cannot read the file'
    );
    expect(softenUnhandledSyncError('ocrmypdf failed with exit code 2: InputFileError')).toBe(
      'OCR engine failed: InputFileError'
    );
    expect(
      softenUnhandledSyncError('Azure Document Intelligence searchable PDF download failed with status 500')
    ).toBe('AI OCR engine searchable PDF download failed with status 500');
  });

  it('skips preprocessing chatter and timeout labels', () => {
    expect(
      softenUnhandledSyncError(
        'pdf2htmlEX failed with exit code 255: Preprocessing: 0/2\nPreprocessing: 2/2\nCannot load font /tmp/f5.ttf'
      )
    ).toBe('Cannot load font /tmp/f5.ttf');
    expect(
      softenUnhandledSyncError('pdf2htmlEX timed out after 6h (MARKUP_RENDER_TIMEOUT_BASE_MS/_PER_PAGE_MS/_MAX_MS); process tree killed')
    ).toBe('PDF to web converter timed out after 6h');
  });
});
