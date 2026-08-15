// Mirrors the extension map in Marginalia.MarkupServer/packages/markup-converter/src/index.ts (detectDocumentType).
const SUPPORTED_MARKUP_EXTENSION_ICONS: Record<string, string> = {
  bmp: 'fa-file-image',
  csv: 'fa-file-lines',
  doc: 'fa-file-word',
  docx: 'fa-file-word',
  gif: 'fa-file-image',
  htm: 'fa-file-lines',
  html: 'fa-file-lines',
  jpg: 'fa-file-image',
  jpeg: 'fa-file-image',
  odg: 'fa-file-image',
  odp: 'fa-file-powerpoint',
  ods: 'fa-file-excel',
  odt: 'fa-file-word',
  pdf: 'fa-file-pdf',
  png: 'fa-file-image',
  ppt: 'fa-file-powerpoint',
  pptx: 'fa-file-powerpoint',
  rtf: 'fa-file-word',
  tif: 'fa-file-image',
  tiff: 'fa-file-image',
  txt: 'fa-file-lines',
  xls: 'fa-file-excel',
  xlsx: 'fa-file-excel',
};

const UNSUPPORTED_FILE_ICON = 'fa-file-circle-question';

function extractExtension(name: string): string {
  const trimmed = name.trim();
  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex < 0 || lastDotIndex === trimmed.length - 1) {
    return '';
  }

  return trimmed.slice(lastDotIndex + 1).toLowerCase();
}

export function isSupportedMarkupFileName(name: string): boolean {
  return extractExtension(name) in SUPPORTED_MARKUP_EXTENSION_ICONS;
}

export function getMarkupFileIcon(name: string): { icon: string; supported: boolean } {
  const extension = extractExtension(name);
  const icon = SUPPORTED_MARKUP_EXTENSION_ICONS[extension];
  if (icon) {
    return { icon, supported: true };
  }

  return { icon: UNSUPPORTED_FILE_ICON, supported: false };
}
