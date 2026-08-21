/**
 * dsh-omnifile 双端共用元素（常量 / 字符串 / 工具函数）——唯一来源。
 *
 * 两端如何拿到这份共用元素：
 *  - 宿主端 src/index.ts（Node ESM）：静态 import { ... } from './common.js'；
 *  - 浏览器端 src/client.ts：DSH 只把一个客户端 bundle（lib/client.js）交给浏览器，
 *    其中 require() 只能解析已注册模块、无法加载本文件的兄弟模块，所以由宿主在
 *    /api/omnifile/common.js 挂一个路由把本文件编译产物（lib/common.js）原文按 ESM 返回，
 *    client.ts 再 dynamic import('/api/omnifile/common.js') 拿到同一份导出。
 *
 * 约定：改动消息标记（MARKER_*）或 markerText 组装规则时，只改本文件，两端自动一致。
 */
/** 设置命名空间（宿主 settings 与客户端 /api 路径共用）。 */
export declare const NAMESPACE = "omnifile";
/** 输入引用源名称（@ 文件选择器 / 序列化的 source 名）。 */
export declare const SOURCE = "\u6587\u4EF6";
/** 文件类别（宿主 fileKind 与客户端卡片/kinds 共用）。 */
export declare const KIND_IMAGE = "image";
export declare const KIND_DOC = "doc";
export declare const KIND_TEXT = "text";
export declare const KIND_MEDIA = "media";
export declare const KIND_OTHER = "other";
export declare const MARKER_PREFIX = "\u89E3\u6790\u540E\u4FDD\u5B58\u8DEF\u5F84\uFF1A";
export declare const MARKER_STATUS_OK = "\u5B8C\u6574\u5185\u5BB9\u89C1\u4E0A\u65B9\u6587\u4EF6\u5361\u7247\uFF0C\u53EF\u70B9\u51FB\u5C55\u5F00";
export declare const MARKER_STATUS_UNREADABLE = "\u65E0\u6CD5\u6309\u6587\u672C\u8BFB\u53D6";
export declare const MARKER_STATUS_FAILED = "\u89E3\u6790\u5931\u8D25";
export declare const MARKER_UNKNOWN = "\u672A\u77E5\u539F\u56E0";
export declare const MARKER_SOURCE_TAG = "\u6E90\u6587\u4EF6\uFF1A";
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
/** 提取错误的可读消息（Promise reject / try-catch 通用）。 */
export declare function messageOf(error: unknown): string;
