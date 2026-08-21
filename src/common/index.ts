/**
 * dsh-omnifile 双端共用元素（常量 / 标记 / 工具）——唯一来源。
 * 宿主（Node ESM）与浏览器端（构建期内联进 client bundle）均从本 barrel 导入。
 */
export * from './constants.js'
export * from './markers.js'
export * from './util.js'
