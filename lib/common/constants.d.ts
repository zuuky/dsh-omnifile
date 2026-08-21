/**
 * dsh-omnifile 双端共用常量——唯一来源。
 * 改动消息标记（MARKER_*）/ 类别（KIND_*）时只改本文件，宿主与客户端自动一致。
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
