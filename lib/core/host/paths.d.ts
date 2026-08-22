/** 无会话工作目录的错误文案（sessionCwd / agentCwd 共用）。 */
declare const ERR_NO_CWD = "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u4F5C\u76EE\u5F55";
/** 会话工作区 uploads 目录（文件落盘/图片落盘共用）。 */
declare function uploadsDir(cwd: string): string;
/** 会话工作区 uploads/images 目录（文档内嵌图片/PDF 扫描页落盘共用）。 */
declare function uploadsImagesDir(cwd: string): string;
declare function sessionCwd(ctx: any, sessionId: string): Promise<string>;
/**
 * 从工具执行上下文解析当前会话工作目录。
 * DSH 的工具运行时把所属 agent 放在 exec.agent（ToolRunContext），
 * 会话 cwd 位于 exec.agent.session.header.cwd —— 这是官方推荐的获取方式；
 * 较旧的运行时可能把 session 直接挂在 exec 上，这里做兼容兜底。
 * 取不到时抛「当前会话没有工作目录」（与 sessionCwd 一致）。
 */
declare function agentCwd(exec: any): string;
declare function assertWorkspacePath(cwd: string, rawPath: unknown): string;
/** 文件名清洗（与 /api/omnifile/save 落盘名一致）。 */
declare function sanitizeName(name: string): string;
/**
 * 由源文件路径推导解析结果路径（<workspace>/uploads/<源文件名>.md）。
 * 源文件名默认取源文件 basename，也可显式传入原始文件名（./process 收到 body.name 时）。
 * 形态统一为「{源文件名}.md」，便于大模型直接对保存路径触发 read 工具。
 */
declare function parsedMarkdownPath(cwd: string, sourcePath: string, sourceName?: string): string;
/** 把解析出的 Markdown 落盘到 <uploads>/<源文件名>.md，供折叠卡片懒加载与大模型 read。 */
declare function writeParsedMarkdown(cwd: string, sourcePath: string, markdown: string, sourceName?: string): Promise<string | undefined>;
export { ERR_NO_CWD, uploadsDir, uploadsImagesDir, sessionCwd, agentCwd, assertWorkspacePath, sanitizeName, parsedMarkdownPath, writeParsedMarkdown };
