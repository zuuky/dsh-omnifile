/**
 * dsh-omnifile 回归测试共享工具。
 * 所有功能测试都针对 lib/ 构建产物（README 已注明测试读取 lib/）：
 *  - clientSrc / indexSrc：lib/client.js / lib/index.js 源码文本；
 *  - extractFn：从 bundle 中按函数名锚点提取函数源码（供 eval 直接调；
 *    构建保持 minify:false，函数名/结构原样保留）；
 *  - bootClient / bootNav：以 vm + DOM/React 桩加载 client bundle 并 apply。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { KIND_IMAGE, KIND_DOC, KIND_TEXT, KIND_MEDIA, KIND_OTHER } from '../lib/common.js'

const ROOT = path.resolve(import.meta.dirname, '..')

/** lib/client.js（DSH ModuleLoader 单文件 bundle）源码文本。 */
const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
/** lib/index.js（宿主 bundle）源码文本。 */
const indexSrc = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

/** 用括号配对从源码提取以 anchor 开头的完整函数定义。 */
function extractFn(src, anchor) {
  const start = src.indexOf(anchor)
  if (start < 0) return null
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return null
}

function el(elements, cls) { return elements.find((e) => e.props && e.props.className === cls) }
function els(elements, cls) { return elements.filter((e) => e.props && e.props.className === cls) }
function textOf(node) {
  if (!node) return ''
  const kids = Array.isArray(node.kids) ? node.kids : [node.kids]
  return kids.map((k) => (k && typeof k === 'object' && Array.isArray(k.kids) ? k.kids.join('') : k === null || k === undefined ? '' : String(k))).join('')
}

/**
 * 加载 client.js（react/DOM/ModuleLoader 桩）并返回可操作的 controller / slots / elements。
 * occurrence 与 notices 均为可变桩，方便驱动「发送/移除/提交」场景。
 */
function bootClient(overrides = {}) {
  const stateBoxes = {}; let currentComp = null; let hookIdx = 0; const elements = []
  const timers = new Map(); let timerSeq = 0
  const setInterval = (fn) => { const id = ++timerSeq; timers.set(id, fn); return id }
  const clearInterval = (id) => { timers.delete(id) }
  const react = {
    createElement: (type, props, ...kids) => { const el = { type, props, kids }; elements.push(el); return el },
    useState: (init) => { const key = (currentComp || 'x') + '|' + (hookIdx++); if (!stateBoxes[key]) stateBoxes[key] = { val: init }; const box = stateBoxes[key]; return [box.val, (v) => { box.val = typeof v === 'function' ? v(box.val) : v }] },
    useRef: (init) => ({ current: init }),
    useSyncExternalStore: (sub, read) => read(),
    useEffect: () => {},
  }
  globalThis.window = globalThis
  window.__ModuleLoader__ = {
    load(entry) { const module = { exports: {} }; const exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' }); const req = (name) => name === 'react' ? react : { __dshModule: name }; const ret = entry.factory(req); window.__EX__ = ret ?? module.exports; return window.__EX__ },
  }
  const noopEl = () => ({ style: {}, dataset: {}, className: '', textContent: '', appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, removeChild() {} })
  const document = { createElement: () => noopEl(), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: null, head: noopEl(), documentElement: { appendChild() {} }, createDocumentFragment: () => ({ appendChild() {} }), createTreeWalker: () => ({ nextNode: () => null }) }
  const MutationObserver = class { observe() {} disconnect() {} }
  let occurrences = []
  let noticeValue = null
  const fakeInput = {
    notify() {},
    notices: { set: (v) => { noticeValue = v } },
    state: { getSnapshot: () => ({ occurrences, phase: 'plain' }) },
  }
  const registered = {}
  const slotsStub = { register(opts, Component) { registered[opts.name] = { opts, Component }; return {} }, inject(name, factory) { const c2 = { slots: slotsStub }; factory.call(c2) } }
  const ctx = { effect(fn) { return typeof fn === 'function' ? fn() : undefined }, slots: slotsStub, inject() {}, get: (k) => { if (k === 'sessions') return { scope: () => ({}) }; if (k === 'conversation') return { input: { for: () => fakeInput } }; return undefined }, ...(overrides.ctx || {}) }
  const fetchStub = overrides.fetch || (() => Promise.resolve({ json: async () => ({ ok: false }) }))
  const sandbox = { window, document, MutationObserver, NodeFilter: { SHOW_TEXT: 4 }, console, Promise, Set, Map, Array, Object, String, Date, Math, JSON, RegExp, Number, encodeURIComponent, Symbol, Error, Uint8Array, FileReader: class {}, fetch: fetchStub, setInterval, clearInterval, setTimeout, clearTimeout, ...(overrides.sandbox || {}) }
  vm.runInNewContext(clientSrc, sandbox, { filename: 'client.js' })
  const ex = window.__EX__; ex.apply(ctx)
  const { controller } = registered['conversation.input.dock'].opts.inject('s1')
  return {
    controller,
    dock: registered['conversation.input.dock'].Component,
    chat: registered['conversation.chat.node'].Component,
    elements,
    get occurrences() { return occurrences },
    set occurrences(v) { occurrences = v },
    get noticeValue() { return noticeValue },
    setNotice(v) { noticeValue = v },
    renderComp(fn, props) { currentComp = fn.name || 'Comp'; hookIdx = 0; const out = fn(props); currentComp = null; return out },
  }
}

/** 提取 decodeText/isBinaryish 及其依赖的辅助函数，一并 eval 供用例调用。 */
function loadTextUtils() {
  const anchors = ['function countReplacement', 'function decodeWith', 'function utf32Decode',
    'function tryUtf16NoBom', 'function decodeText', 'function isBinaryish']
  let scope = '(function(){'
  for (const anchor of anchors) {
    const fn = extractFn(indexSrc, anchor)
    if (!fn) throw new Error('可提取 ' + anchor)
    scope += '\n' + fn
  }
  scope += '\nreturn { decodeText, isBinaryish };\n})'
  return eval('(' + scope + ')')()
}

/** 提取文件类别判定（fileKind/mimeFor）及其扩展名集合常量，一并 eval。
 * 区域提取：从 const IMAGE_EXTENSIONS 起到 mimeFor 函数结束（宿主 bundle 内联且顺序稳定）。
 * fileKind 内部用到了外部化（未内联）的 node:path.extname 与 core 的 KIND_* 常量，
 * 故在 eval 作用域注入真实的 node:path.extname 与来自 lib/common.js 的 KIND_* 常量
 * （均等价于源文件的 import，非伪造桩）。 */
function loadExtensionUtils() {
  const start = indexSrc.indexOf('const IMAGE_EXTENSIONS')
  const mimeFn = extractFn(indexSrc, 'function mimeFor')
  if (start < 0 || mimeFn === null) throw new Error('无法定位文件类别模块')
  const end = indexSrc.indexOf(mimeFn) + mimeFn.length
  const chunk = indexSrc.slice(start, end)
  const extname = path.posix.extname
  const factory = eval('(function(extname, KIND_IMAGE, KIND_DOC, KIND_TEXT, KIND_MEDIA, KIND_OTHER){ ' + chunk + '\nreturn { IMAGE_EXTENSIONS, TEXT_EXTENSIONS, MEDIA_EXTENSIONS, MIME_BY_EXT, DOC_EXTENSIONS_FALLBACK, fileKind, mimeFor };\n})')
  return factory(extname, KIND_IMAGE, KIND_DOC, KIND_TEXT, KIND_MEDIA, KIND_OTHER)
}

/** 提取宿主模型枚举/解析相关函数（enumerateModels、resolveConfiguredProvider 等）。 */
function loadModelUtils() {
  const anchors = ['const VISION_HINT_RE', 'function builtinProviderDefaults', 'function inferModelImage',
    'async function enumerateModels', 'async function resolveConfiguredProvider']
  let scope = '(function(){'
  for (const anchor of anchors) {
    let fn = extractFn(indexSrc, anchor)
    if (fn === null) {
      const lineStart = indexSrc.indexOf(anchor)
      if (lineStart >= 0) {
        const semi = indexSrc.indexOf(';', lineStart)
        if (semi > lineStart) fn = indexSrc.slice(lineStart, semi + 1)
      }
    }
    if (fn === null) throw new Error('可提取 ' + anchor)
    scope += '\n' + fn
  }
  scope += '\nreturn { builtinProviderDefaults, inferModelImage, enumerateModels, resolveConfiguredProvider };\n})'
  return eval('(' + scope + ')')()
}

/** 构造极简 fake ctx：settings.get 按 namespace 返回配置，llm 提供 provider 与模型目录。 */
function makeModelCtx({ settings, llm }) {
  const settingsMap = settings || {}
  const providerModels = llm?.providerModels || {}
  const providers = llm?.providers || []
  const directory = llm?.directory || []
  return {
    settings: {
      get: (ns) => settingsMap[ns],
    },
    get: (k) => {
      if (k !== 'llm') return undefined
      return {
        listConfigurableProviders: () => directory,
        listProviders: () => providers,
        listModels: async (provider) => providerModels[provider] || [],
      }
    },
  }
}

export { ROOT, clientSrc, indexSrc, extractFn, el, els, textOf, bootClient, loadTextUtils, loadExtensionUtils, loadModelUtils, makeModelCtx }
