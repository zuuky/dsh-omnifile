/** 用 Python(PyMuPDF) 把 PDF 每页渲染为 PNG——当 anydoc 转不出文本时的兜底。 */
declare function renderPdfPagesWithPymupdf(filePath: string): Promise<Array<{
    data: Buffer;
    mediaType: string;
    page: number;
}>>;
/**
 * 纯扫描/纯图片 PDF 的多模态兜底：anydoc 转不出文本时，用 PyMuPDF 把每页渲染为 PNG，
 * 交给多模态模型逐页识别（不依赖任何 PDF 解析库的图片提取，PyMuPDF 是唯一兜底通道）。
 */
declare function describePdfFallback(cfg: Record<string, any>, filePath: string): Promise<{
    images: Array<{
        data: Buffer;
        mediaType: string;
        page: number;
    }>;
    errors: string[];
    source?: string;
}>;
/**
 * 用 @firecrawl/anydoc 解析文档。要点（对照 anydoc 0.1.9 API）：
 * - toMarkdownBytes(bytes, format) 对所有格式（含 PDF）都能转 Markdown；
 * - toDocument(bytes, format) 返回 Document.assets（内嵌图片字节），但 PDF 不支持（仅 Markdown 直出）；
 * - formatFromPath 识别格式并显式传给上面两个函数（CSV 等无签名的格式必须显式命名）；
 * - 任一步失败都容错降级，绝不因"含图片/无法转换"而整体报错：文本拿不到就只描述内嵌图片，
 *   图片描述失败只记录该图片错误，都不会中断整份文档的解析。
 */
declare function processDocument(ctx: any, cfg: Record<string, any>, cwd: string, filePath: string, fileName: string, limitImages?: number, onProgress?: (patch: {
    stage: string;
    detail: string;
    done: number;
    total: number;
}) => void): Promise<{
    markdown: string;
    images: Array<Record<string, any>>;
    truncated: boolean;
    textError?: string;
}>;
export { renderPdfPagesWithPymupdf, describePdfFallback, processDocument };
