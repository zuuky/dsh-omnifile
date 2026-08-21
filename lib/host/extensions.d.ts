declare const IMAGE_EXTENSIONS: Set<string>;
declare const TEXT_EXTENSIONS: Set<string>;
declare const MEDIA_EXTENSIONS: Set<string>;
declare const MIME_BY_EXT: Record<string, string>;
declare const DOC_EXTENSIONS_FALLBACK: Set<string>;
declare function fileKind(name: string): string;
declare function mimeFor(path: string): string;
export { IMAGE_EXTENSIONS, TEXT_EXTENSIONS, MEDIA_EXTENSIONS, DOC_EXTENSIONS_FALLBACK, MIME_BY_EXT, fileKind, mimeFor };
