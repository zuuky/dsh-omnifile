export interface MarkerOptions {
    /** true=成功；false=解析失败；字符串或缺省=该状态词（传 '无法按文本读取' 或略过 → 不可读）。 */
    ok?: boolean | string;
    /** 状态后的原因说明（失败/不可读时）。 */
    note?: string;
    /** 成功时附带的「源文件」绝对路径回指（与 path 不同才附加）。 */
    source?: string;
}
/**
 * 组装「解析后保存路径」标记（两端共用）。
 * @param path - 保存路径（成功为 <uploads>/<源文件名>.md，失败/不可读为源路径）。
 * @param options - 见 {@link MarkerOptions}。
 * @returns 一行可读标记。
 */
export declare function markerText(path: string, options?: MarkerOptions): string;
/**
 * 从状态尾巴（如「完整内容见上方文件卡片，可点击展开；源文件：D:\x」）提取源文件绝对路径。
 * 没有「源文件：」则返回 undefined（客户端卡片/📂 按钮据此回指原始文件）。
 * @param statusTail - 括号内状态文本。
 * @returns 源文件绝对路径，未找到返回 undefined。
 */
export declare function sourcePathOf(statusTail: string | undefined): string | undefined;
