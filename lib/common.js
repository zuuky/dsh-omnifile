const NAMESPACE = "omnifile";
const SOURCE = "文件";
const KIND_IMAGE = "image";
const KIND_DOC = "doc";
const KIND_TEXT = "text";
const KIND_MEDIA = "media";
const KIND_OTHER = "other";
const MARKER_PREFIX = "解析后保存路径：";
const MARKER_STATUS_OK = "完整内容见上方文件卡片，可点击展开";
const MARKER_STATUS_UNREADABLE = "无法按文本读取";
const MARKER_STATUS_FAILED = "解析失败";
const MARKER_UNKNOWN = "未知原因";
const MARKER_SOURCE_TAG = "源文件：";
function markerText(path, options = {}) {
  const p = String(path || "");
  const isOk = options.ok === true || options.ok === MARKER_STATUS_OK;
  if (isOk) {
    const sourceTail = typeof options.source === "string" && options.source !== "" && options.source !== p ? "；" + MARKER_SOURCE_TAG + options.source : "";
    return MARKER_PREFIX + p + "（" + MARKER_STATUS_OK + sourceTail + "）";
  }
  const status = options.ok === false ? MARKER_STATUS_FAILED : typeof options.ok === "string" && options.ok !== "" ? options.ok : MARKER_STATUS_UNREADABLE;
  const noteText = typeof options.note === "string" && options.note !== "" ? "：" + options.note : "";
  return MARKER_PREFIX + p + "（" + status + noteText + "）";
}
function sourcePathOf(statusTail) {
  const at = String(statusTail || "").indexOf(MARKER_SOURCE_TAG);
  if (at < 0) return void 0;
  const value = String(statusTail).slice(at + MARKER_SOURCE_TAG.length).trim();
  return value === "" ? void 0 : value;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
export {
  KIND_DOC,
  KIND_IMAGE,
  KIND_MEDIA,
  KIND_OTHER,
  KIND_TEXT,
  MARKER_PREFIX,
  MARKER_SOURCE_TAG,
  MARKER_STATUS_FAILED,
  MARKER_STATUS_OK,
  MARKER_STATUS_UNREADABLE,
  MARKER_UNKNOWN,
  NAMESPACE,
  SOURCE,
  markerText,
  messageOf,
  sourcePathOf
};
