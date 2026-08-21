/**
 * 客户端常量：UI 文案 / 默认限额 / 锚点偏移。
 */

/* UI 文案（集中收拢，避免改不全）。 */
const LBL_OPEN_SOURCE = '用本地默认程序打开源文件'
const LBL_CHIP_OPEN = '（点击预览）'
const LBL_ADD_FILES = '添加本地文件（可多选，支持拖拽/粘贴）'
const LBL_EXPAND = '展开解析结果'
const LBL_COLLAPSE = '收起解析结果'
/* 客户端限额缺省值（启动时由 /api/omnifile/config 覆盖）。 */
const DEFAULT_LIMITS = {
    maxFileBytes: 50 * 1024 * 1024,
    maxBatchImages: 20,
    progressPollMs: 400,
}
/* @ 候选菜单最多返回条数 */
const CANDIDATE_LIMIT = 200
/* 卡片锚点偏移：排到用户消息上方 */
const FILES_ANCHOR_OFFSET = -0.5

export { LBL_OPEN_SOURCE, LBL_CHIP_OPEN, LBL_ADD_FILES, LBL_EXPAND, LBL_COLLAPSE, DEFAULT_LIMITS, CANDIDATE_LIMIT, FILES_ANCHOR_OFFSET }
