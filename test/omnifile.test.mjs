/**
 * dsh-omnifile 回归测试（node:test）
 * 运行：node --test test/
 *
 * 覆盖：CSS 静态断言、宿主 lastUserQuestion 与识图提示词、
 *       client 渲染（dock chip / sendwait 进度行 / ParseBlock 展开收缩）、
 *       serialize 流程（等待、防重复、移除解耦、锁释放、composer 提示清理）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');

/** 用括号配对从源码提取以 anchor 开头的完整函数定义。 */
function extractFn(src, anchor) {
  const start = src.indexOf(anchor);
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

/**
 * 加载 client.js（react/DOM/ModuleLoader 桩）并返回可操作的 controller / slots / elements。
 * occurrence 与 notices 均为可变桩，方便驱动「发送/移除/提交」场景。
 */
function bootClient(overrides = {}) {
  const stateBoxes = {}; let currentComp = null; let hookIdx = 0; const elements = [];
  const timers = new Map(); let timerSeq = 0;
  const setInterval = (fn) => { const id = ++timerSeq; timers.set(id, fn); return id; };
  const clearInterval = (id) => { timers.delete(id); };
  const react = {
    createElement: (type, props, ...kids) => { const el = { type, props, kids }; elements.push(el); return el; },
    useState: (init) => { const key = (currentComp || 'x') + '|' + (hookIdx++); if (!stateBoxes[key]) stateBoxes[key] = { val: init }; const box = stateBoxes[key]; return [box.val, (v) => { box.val = typeof v === 'function' ? v(box.val) : v; }]; },
    useRef: (init) => ({ current: init }),
    useSyncExternalStore: (sub, read) => read(),
    useEffect: () => {},
  };
  globalThis.window = globalThis;
  window.__ModuleLoader__ = {
    load(entry) { const module = { exports: {} }; const exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' }); const req = (name) => name === 'react' ? react : { __dshModule: name }; const ret = entry.factory(req); window.__EX__ = ret ?? module.exports; return window.__EX__; },
  };
  const noopEl = () => ({ style: {}, dataset: {}, className: '', textContent: '', appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, removeChild() {} });
  const document = { createElement: () => noopEl(), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: null, head: noopEl(), documentElement: { appendChild() {} }, createDocumentFragment: () => ({ appendChild() {} }), createTreeWalker: () => ({ nextNode: () => null }) };
  const MutationObserver = class { observe() {} disconnect() {} };
  let occurrences = [];
  let noticeValue = null;
  const fakeInput = {
    notify() {},
    notices: { set: (v) => { noticeValue = v; } },
    state: { getSnapshot: () => ({ occurrences, phase: 'plain' }) },
  };
  const registered = {};
  const slotsStub = { register(opts, Component) { registered[opts.name] = { opts, Component }; return {}; }, inject(name, factory) { const c2 = { slots: slotsStub }; factory.call(c2); } };
  const ctx = { effect(fn) { return typeof fn === 'function' ? fn() : undefined; }, slots: slotsStub, inject() {}, get: (k) => { if (k === 'sessions') return { scope: () => ({}) }; if (k === 'conversation') return { input: { for: () => fakeInput } }; return undefined; }, ...(overrides.ctx || {}) };
  const fetchStub = overrides.fetch || (() => Promise.resolve({ json: async () => ({ ok: false }) }));
  const sandbox = { window, document, MutationObserver, NodeFilter: { SHOW_TEXT: 4 }, console, Promise, Set, Map, Array, Object, String, Date, Math, JSON, RegExp, Number, encodeURIComponent, Symbol, Error, Uint8Array, FileReader: class {}, fetch: fetchStub, setInterval, clearInterval, setTimeout, clearTimeout, ...(overrides.sandbox || {}) };
  vm.runInNewContext(clientSrc, sandbox, { filename: 'client.js' });
  const ex = window.__EX__; ex.apply(ctx);
  const { controller } = registered['conversation.input.dock'].opts.inject('s1');
  return {
    controller,
    dock: registered['conversation.input.dock'].Component,
    chat: registered['conversation.chat.node'].Component,
    elements,
    get occurrences() { return occurrences; },
    set occurrences(v) { occurrences = v; },
    get noticeValue() { return noticeValue; },
    setNotice(v) { noticeValue = v; },
    renderComp(fn, props) { currentComp = fn.name || 'Comp'; hookIdx = 0; const out = fn(props); currentComp = null; return out; },
  };
}

function el(elements, cls) { return elements.find((e) => e.props && e.props.className === cls); }
function els(elements, cls) { return elements.filter((e) => e.props && e.props.className === cls); }
function textOf(node) {
  if (!node) return '';
  const kids = Array.isArray(node.kids) ? node.kids : [node.kids];
  return kids.map((k) => (k && typeof k === 'object' && Array.isArray(k.kids) ? k.kids.join('') : k === null || k === undefined ? '' : String(k))).join('');
}


/* ============ 1. CSS / 常量静态断言 ============ */
test('CSS: 卡片全宽 + 展开限高滚动 + pre 强制换行', () => {
  assert.ok(clientSrc.indexOf('.omnifile-parse-block{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;}') >= 0, 'parse-block 全宽 width:100%');
  assert.ok(clientSrc.indexOf('.omnifile-chat-group{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;}') >= 0, 'chat-group 全宽');
  assert.ok(clientSrc.indexOf('.omnifile-parse-body{box-sizing:border-box;width:100%;min-width:0;max-height:360px;overflow-y:auto;overflow-x:hidden;') >= 0, 'parse-body 限高360+纵向滚动');
  assert.ok(clientSrc.indexOf('.omnifile-parse-pre{margin:0;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;') >= 0, 'pre 强制换行');
  assert.ok(!/omnifile-parse-block\{[^}]*fit-content/.test(clientSrc), 'parse-block 无 fit-content');
  assert.ok(clientSrc.indexOf('.omnifile-sendwait{') >= 0, 'sendwait 进度行样式存在');
});

/* ============ 2. 宿主 lastUserQuestion ============ */
test('宿主 lastUserQuestion：取最新用户文本问题', () => {
  const src = extractFn(indexSrc, 'function lastUserQuestion');
  assert.ok(src, '提取到函数源码');
  const f = eval('(' + src + ')');
  assert.equal(f([{ role: 'assistant', content: 'x' }, { role: 'user', content: [{ type: 'image_url' }, { type: 'text', text: ' 图里增长率？ ' }] }]), '图里增长率？', 'block 结构取文本');
  assert.equal(f([{ role: 'user', content: '直接问题' }]), '直接问题', '字符串内容');
  assert.equal(f([{ role: 'user', content: [{ type: 'image_url' }] }, { role: 'user', content: '更早问题' }]), '更早问题', '跳过无文本 user');
  assert.equal(f([{ role: 'assistant', content: 'x' }]), '', '无问题返回空');
});

test('识图提示词拼接：带问题/无问题', () => {
  const pStart = indexSrc.indexOf('const basePrompt = cfg.describePrompt');
  const pEnd = indexSrc.indexOf('const description', pStart);
  let chunk = indexSrc.slice(pStart, pEnd).replace(/\r/g, '').replace('const describePrompt', 'result');
  const make = eval('(function (cfg, question, DEFAULT_DESCRIBE_PROMPT) { let result; ' + chunk + '; return result; })');
  const base = '请按要求描述这张图片。';
  const wq = make({ describePrompt: base }, '  图里增长率？  ', base);
  assert.ok(wq.includes('用户的问题是：「图里增长率？」'), '带问题包含用户问题');
  assert.equal(make({ describePrompt: base }, '', base), base, '无问题仅基础提示');
});


/* ============ 3. 渲染：dock chip + sendwait 进度行 ============ */
test('渲染：草稿态 chip + 发送中 sendwait 进度行', async () => {
  const b = bootClient();
  b.controller.records.set('r1', { ref: 'r1', sessionId: 's1', name: '报告.docx', path: 'C:/x/1.docx', kind: 'doc', size: 12, status: 'processing', progressDetail: '识别内嵌图片 2/5' });
  b.occurrences = [{ source: '文件', occurrenceId: 'o1', ref: 'r1' }];
  b.elements.length = 0;
  b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => {} });
  assert.equal(els(b.elements, 'omnifile-chip').length, 1, 'chip 渲染');
  assert.equal(els(b.elements, 'omnifile-sendwait').length, 0, '未发送 → 无进度行');
  assert.equal(textOf(el(b.elements, 'omnifile-chip-name')), '报告.docx', 'chip 文件名');

  /* 点发送 → awaitingSend → 对话区进度行实时显示 */
  const rec = b.controller.records.get('r1'); rec.awaitingSend = true; rec._waitNotified = true; rec.progressDetail = '识别内嵌图片 3/5';
  b.elements.length = 0;
  b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => {} });
  const sw = els(b.elements, 'omnifile-sendwait');
  assert.equal(sw.length, 1, '发送中显示进度行');
  assert.ok(/正在解析文件 0\/1/.test(textOf(sw[0])) && /识别内嵌图片 3\/5/.test(textOf(sw[0])), '进度行内容实时');

  /* 全部完成 → 进度行消失 */
  rec.status = 'done'; rec.awaitingSend = false;
  b.elements.length = 0;
  b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => {} });
  assert.equal(els(b.elements, 'omnifile-sendwait').length, 0, '完成后进度行消失');
});

/* ============ 4. 渲染：处理中 × 可用（单个文件取消） ============ */
test('渲染：处理中文件 × 可用，点击触发 remove', () => {
  const b = bootClient();
  b.controller.records.set('r1', { ref: 'r1', sessionId: 's1', name: 'x.docx', path: 'C:/x/x.docx', kind: 'doc', size: 1, status: 'processing' });
  b.occurrences = [{ source: '文件', occurrenceId: 'o1', ref: 'r1' }];
  b.elements.length = 0;
  let removed = false;
  b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => { removed = true; } });
  const rm = el(b.elements, 'omnifile-chip-remove');
  assert.ok(rm && rm.props.disabled === false, '处理中 × 可用');
  rm.props.onClick({ stopPropagation() {} });
  assert.ok(removed, '点击 × 触发 remove');
});

/* ============ 5. 渲染：ParseBlock 单行 + 展开滚动容器 ============ */
test('渲染：ParseBlock 单行展开（滚动容器包裹 pre）', async () => {
  const b = bootClient({ fetch: () => Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 }, parsedPath: 'C:/x/p.md' }) }) });
  const file = { name: '报告', kind: 'doc', path: 'C:/x/p.md', sourcePath: 'C:/x/p.docx' };
  let loaded = 0;
  const loadParsed = () => { loaded++; return Promise.resolve('# 报告内容'); };
  const before = b.elements.length;
  b.chat({ sessionId: 's1', openPath: () => {}, loadParsed, node: { data: { files: [file] } } });
  const group = b.elements.slice(before).find((e) => e.props && e.props.className === 'omnifile-chat-group');
  const kids = Array.isArray(group.kids) && group.kids.length === 1 && Array.isArray(group.kids[0]) ? group.kids[0] : (group.kids || []);
  const pbEl = kids.find((k) => k && typeof k.type === 'function');
  assert.ok(pbEl, '找到 ParseBlock 函数组件');

  /* 收缩：单行卡片，无 parse-body */
  const f1 = b.elements.length;
  b.renderComp(pbEl.type, pbEl.props);
  const r1 = b.elements.slice(f1);
  assert.equal(els(r1, 'omnifile-parse-row').length, 1, '单行');
  assert.equal(els(r1, 'omnifile-parse-body').length, 0, '收缩无内容区');

  /* 点击 → 展开 + 懒加载；flush 后出现滚动容器 */
  el(r1, 'omnifile-parse-row').props.onClick({ stopPropagation() {} });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const f2 = b.elements.length;
  b.renderComp(pbEl.type, pbEl.props);
  const r2 = b.elements.slice(f2);
  const bodies = els(r2, 'omnifile-parse-body');
  assert.equal(bodies.length, 1, '展开出现 parse-body（限高滚动容器）');
  assert.ok(bodies[0].kids.some((k) => k && k.props && k.props.className === 'omnifile-parse-pre'), 'body 内包裹 pre');
  assert.equal(loaded, 1, '内容只加载一次');
});


/* ============ 6. serialize：等待解析完成后发送 ============ */
test('serialize：等待解析完成后返回成功标记、解除等待态', async () => {
  let gates = [];
  const b = bootClient({
    fetch: (url) => {
      const u = String(url || '');
      if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) });
      if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) });
      if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r; }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })); }
      return Promise.resolve({ json: async () => ({ ok: false }) });
    },
  });
  b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' });
  b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }];
  const ctl = new AbortController();
  const p = Promise.all([b.controller.serialize('rA', ctl.signal)]);
  await new Promise((r) => setTimeout(r, 5)); // ensureCommon 微任务 + fetch 入队
  gates.forEach((g) => g());
  const parts0 = await p;
  assert.ok(parts0.length === 1 && /解析后保存路径：/.test(parts0[0]), '返回成功 marker');
  assert.equal(b.controller.records.get('rA').awaitingSend, false, '解析后解除等待态');
});

/* ============ 7. 防重复发送 ============ */
test('防重复：等待期再次点发送被拒，首周期照常完成', async () => {
  let gates = [];
  const b = bootClient({
    fetch: (url) => {
      const u = String(url || '');
      if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) });
      if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) });
      if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r; }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })); }
      return Promise.resolve({ json: async () => ({ ok: false }) });
    },
  });
  b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' });
  b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }];

  const c1 = new AbortController();
  const cyc1 = Promise.all([b.controller.serialize('rA', c1.signal)]);
  const c2 = new AbortController();
  let dupErr = null;
  try { await Promise.all([b.controller.serialize('rA', c2.signal), b.controller.serialize('rA', c2.signal)]); } catch (e) { dupErr = e && e.message || String(e); }
  assert.ok(dupErr && dupErr.indexOf('请勿重复点击') >= 0, '重复点击被拒：' + (dupErr || ''));

  gates.forEach((g) => g());
  const parts0 = await cyc1;
  assert.ok(parts0.length === 1 && /解析后保存路径：/.test(parts0[0]), '首周期正常完成');
});

/* ============ 8. 移除与发送解耦 ============ */
test('移除文件不取消发送：被移除引用返回空、剩余照发', async () => {
  let gates = [];
  const b = bootClient({
    fetch: (url) => {
      const u = String(url || '');
      if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) });
      if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) });
      if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r; }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })); }
      return Promise.resolve({ json: async () => ({ ok: false }) });
    },
  });
  b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' });
  b.controller.records.set('rB', { ref: 'rB', sessionId: 's1', name: 'b.pdf', path: 'C:/x/b.pdf', kind: 'doc', size: 1, status: 'processing' });
  b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }, { source: '文件', occurrenceId: 'oB', ref: 'rB' }];

  const ctl = new AbortController();
  const cycA = b.controller.serialize('rA', ctl.signal);
  const cycB = b.controller.serialize('rB', ctl.signal);
  await new Promise((r) => setTimeout(r, 5)); // 让两个 serialize 进入 /process

  /* 模拟用户移除 rA：记录删除 + 从草稿去掉 */
  b.controller.records.delete('rA');
  b.occurrences = b.occurrences.filter((o) => o.ref !== 'rA');

  gates.forEach((g) => g());
  const markerA = await cycA;
  const markerB = await cycB;
  assert.equal(markerA, '', '被移除引用返回空（丢弃）');
  assert.ok(/解析后保存路径：/.test(markerB), '剩余文件 marker 正常');
  await new Promise((r) => setTimeout(r, 6)); // 等 setTimeout 宏任务释放锁
  assert.ok(!b.controller._sendSignal.has('s1'), '发送锁未卡死');
  b.occurrences = [];
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(!b.controller._sendSignal.has('s1'), '提交后锁释放');
});

/* ============ 9. composer 提示清理 ============ */
test('发送提交后清理由“请勿重复点击”残留的提示', async () => {
  let gates = [];
  const b = bootClient({
    fetch: (url) => {
      const u = String(url || '');
      if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) });
      if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) });
      if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r; }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })); }
      return Promise.resolve({ json: async () => ({ ok: false }) });
    },
  });
  b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' });
  b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }];
  const cth = new AbortController();
  const p = Promise.all([b.controller.serialize('rA', cth.signal)]);
  await new Promise((r) => setTimeout(r, 5));
  /* 重复点击产生的提示（模拟 composer notices 已有值） */
  b.setNotice('请勿重复点击');
  gates.forEach((g) => g());
  await p;
  /* 发送提交（草稿清空）→ setTimeout 触发 clearNotice */
  b.occurrences = [];
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(b.noticeValue, null, '发送提交后提示被清理');
});

/* ============ 10. 二进制检测修复（#2）：文本不误判、二进制不放过 ============ */
/** 提取 decodeText/isBinaryish 及其依赖的辅助函数（countReplacement/decodeWith/utf32Decode/tryUtf16NoBom），一并 eval 供用例调用。 */
function loadTextUtils() {
  const anchors = ['function countReplacement', 'function decodeWith', 'function utf32Decode',
    'function tryUtf16NoBom', 'function decodeText', 'function isBinaryish'];
  let scope = '(function(){';
  for (const anchor of anchors) {
    const fn = extractFn(indexSrc, anchor);
    assert.ok(fn, '可提取 ' + anchor);
    scope += '\n' + fn;
  }
  scope += '\nreturn { decodeText, isBinaryish };\n})';
  /* eval 函数表达式取其返回值；直接 eval let/var 声明语句的完成值是 undefined */
  const factory = eval('(' + scope + ')');
  return factory();
}

test('二进制检测：中文 UTF-8 / GBK / UTF-16 文本不再被误判为二进制', () => {
  const { decodeText, isBinaryish } = loadTextUtils();
  /* UTF-8 中文（旧逻辑会因连续字节落在 0x80-0x9F 被误判） */
  const utf8 = Buffer.from('这是一个中文字符串测试，包含标点符号！Hello 123。', 'utf8');
  assert.equal(isBinaryish(utf8, decodeText(utf8)), false, 'UTF-8 中文不判二进制');
  /* GBK 中文 */
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xce, 0xc4, 0xbc, 0xfe, 0xc4, 0xda, 0xc8, 0xdd, 0xb2, 0xe2, 0xca, 0xd4, 0xa3, 0xac, 0xba, 0xac, 0xb1, 0xea, 0xb5, 0xe3, 0xb7, 0xfb, 0xba, 0xc5, 0xa3, 0xa1, 0x31, 0x32, 0x33, 0x41, 0x42, 0x43]);
  assert.ok(new TextDecoder('gb18030').decode(gbk).includes('中文文件内容测试'), 'GBK 样本可解');
  assert.equal(isBinaryish(gbk, decodeText(gbk)), false, 'GBK 中文不判二进制');
  /* UTF-16 LE（Windows 记事本「Unicode」）：BOM FF FE */
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Unicode 中文文本测试 file.', 'utf16le')]);
  assert.ok(decodeText(utf16le).includes('Unicode 中文文本测试'), 'UTF-16 LE 解码成功');
  assert.equal(isBinaryish(utf16le, decodeText(utf16le)), false, 'UTF-16 LE 文本不判二进制');
  /* UTF-16 BE：BOM FE FF */
  const beBody = [];
  for (const c of 'Unicode BE test 文本。') { const n = c.codePointAt(0); beBody.push(n >> 8, n & 0xff); }
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(beBody)]);
  assert.ok(decodeText(utf16be).includes('Unicode BE test'), 'UTF-16 BE 解码成功');
  assert.equal(isBinaryish(utf16be, decodeText(utf16be)), false, 'UTF-16 BE 文本不判二进制');
  /* 纯 ASCII 文本 */
  assert.equal(isBinaryish(Buffer.from('pure ascii text 12345', 'ascii'), decodeText(Buffer.from('pure ascii text 12345', 'ascii'))), false, '纯 ASCII 不判二进制');
  /* 单个 NUL 不再一票否决（打磨/填充数据） */
  const withNul = Buffer.concat([Buffer.from('hello world', 'ascii'), Buffer.from([0x00]), Buffer.from(' tail', 'ascii')]);
  assert.equal(isBinaryish(withNul, decodeText(withNul)), false, '单个 NUL 不判二进制');
});

test('二进制检测：#2 修复——无 BOM 的 UTF-16 文本不再误判为二进制', () => {
  const { decodeText, isBinaryish } = loadTextUtils();
  /* UTF-16 LE 无 BOM（英文/数字为主）：旧/现逻辑会把每两个字符出现一次的 NUL 当控制字符 → 误判二进制 */
  const en = 'Hello world, this is a UTF-16LE file without BOM. Line 2 here. Numbers 12345.';
  const utf16leNoBom = Buffer.from(en, 'utf16le');
  const dec1 = decodeText(utf16leNoBom);
  assert.equal(dec1, en, 'UTF-16LE 无 BOM 正确解码');
  assert.equal(isBinaryish(utf16leNoBom, dec1), false, 'UTF-16LE 无 BOM 不判二进制');

  /* UTF-16 BE 无 BOM */
  const beText = 'UTF-16BE no BOM sample text 2024';
  const beNoBom = [];
  for (const c of beText) { const n = c.codePointAt(0); beNoBom.push(n >> 8, n & 0xff); }
  const utf16beNoBom = Buffer.from(beNoBom);
  const dec2 = decodeText(utf16beNoBom);
  assert.equal(dec2, beText, 'UTF-16BE 无 BOM 正确解码');
  assert.equal(isBinaryish(utf16beNoBom, dec2), false, 'UTF-16BE 无 BOM 不判二进制');
});

test('二进制检测：UTF-32 BOM 文本正确解码且不判二进制', () => {
  const { decodeText, isBinaryish } = loadTextUtils();
  const utf32leText = 'Test UTF-32 文本 sample。';
  const leBytes = [];
  for (const c of utf32leText) { const n = c.codePointAt(0); leBytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff); }
  const utf32le = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), Buffer.from(leBytes)]);
  assert.ok(decodeText(utf32le).includes('Test UTF-32'), 'UTF-32LE BOM 解码成功');
  assert.equal(isBinaryish(utf32le, decodeText(utf32le)), false, 'UTF-32LE BOM 不判二进制');

  const be32 = [];
  for (const c of 'UTF32BE sample') { const n = c.codePointAt(0); be32.push((n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff); }
  const utf32be = Buffer.concat([Buffer.from([0x00, 0x00, 0xfe, 0xff]), Buffer.from(be32)]);
  assert.ok(decodeText(utf32be).includes('UTF32BE'), 'UTF-32BE BOM 解码成功');
  assert.equal(isBinaryish(utf32be, decodeText(utf32be)), false, 'UTF-32BE BOM 不判二进制');
});

test('二进制检测：真实二进制仍被正确识别', () => {
  const { decodeText, isBinaryish } = loadTextUtils();
  /* 随机字节（含控制/替换字符） */
  const rand = Buffer.alloc(1024);
  for (let i = 0; i < 1024; i++) rand[i] = (i * 37 + 11) % 256;
  assert.equal(isBinaryish(rand, decodeText(rand)), true, '随机字节判二进制');
  /* PNG 签名文件 */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
    Buffer.from([0x08, 0x06, 0x00]),
  ]);
  assert.equal(isBinaryish(png, decodeText(png)), true, 'PNG 判二进制');
  /* 全零填充 */
  assert.equal(isBinaryish(Buffer.alloc(2048, 0), decodeText(Buffer.alloc(2048, 0))), true, '全零判二进制');
  /* 空文件 */
  assert.equal(isBinaryish(Buffer.alloc(0), decodeText(Buffer.alloc(0))), false, '空文件不算二进制');
});

/* ============ 11. 文件 chip 置顶（#3）：无论输入框有无文字，chip 都在最前 ============ */
test('chip 位置：frontInsertSpan 始终返回正文之前的位置', () => {
  const b = bootClient();
  /* 输入框已有正文、无 chip → 插到最前（start=0） */
  const s1 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [], draft: '你好 world', draftRev: 1 }) } });
  assert.equal(s1.start, 0, '无 chip 时插到正文最前');
  /* 已有 chip @0 + 正文（"￼ hello"）→ 紧跟 chip 之后、正文之前 */
  const s2 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [{ source: '文件', offset: 0 }], draft: '￼ hello', draftRev: 2 }) } });
  assert.equal(s2.start, 2, '已有 chip 时紧跟其后再插（正文之前）');
  /* 多个 chip（"￼ ￼ hello"）→ 紧跟最后一个 chip */
  const s3 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [{ source: '文件', offset: 0 }, { source: '文件', offset: 2 }], draft: '￼ ￼ hello', draftRev: 3 }) } });
  assert.equal(s3.start, 4, '紧跟最后一个 chip 之后');
  /* 其它来源（非本插件）不参与：仍插最前 */
  const s4 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [{ source: '其它', offset: 0 }], draft: '￼ hello', draftRev: 4 }) } });
  assert.equal(s4.start, 0, '只看本插件 chip');
});

test('chip 位置：addNonImage 在输入框已有文字时调用 insertReference 于最前位置', async () => {
  const calls = [];
  const b = bootClient({
    sandbox: {
      FileReader: class {
        onerror = null;
        onload = null;
        readAsDataURL(file) {
          /* 模拟 readAsDataURL：'x' → data:application/octet-stream;base64,eA== */
          if (this.onload) this.onload({ target: { result: 'data:application/octet-stream;base64,' + Buffer.from('x').toString('base64') } });
          else this.onerror({ message: 'no onload' });
        }
      },
    },
    fetch: (url) => {
      const u = String(url || '');
      if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) });
      if (u.indexOf('/api/omnifile/save') >= 0) return Promise.resolve({ json: async () => ({ ok: true, path: 'C:/u/1.save', kind: 'doc', size: 12 }) });
      if (u.indexOf('/api/omnifile/process') >= 0) return Promise.resolve({ json: async () => ({ ok: true, kind: 'doc', parsedPath: 'C:/u/1.md' }) });
      if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) });
      return Promise.resolve({ json: async () => ({ ok: false }) });
    },
  });
  let snap = { occurrences: [{ ref: 'old', source: '文件', occurrenceId: 'o0', offset: 0 }], draft: '￼ 已有正文', draftRev: 9, phase: 'plain' };
  const customInput = {
    notify() {},
    notices: { set() {} },
    state: { getSnapshot: () => snap },
    insertReference(ref, span) {
      calls.push({ ref: ref.ref, start: span.start, end: span.end });
      snap = { ...snap, draft: '￼ ￼ 已有正文', draftRev: snap.draftRev + 1, occurrences: [...snap.occurrences, { ref: ref.ref, source: '文件', occurrenceId: 'o' + snap.occurrences.length, offset: span.start }] };
      return true;
    },
    addImages() {},
  };
  b.controller.ctx.get = (k) => {
    if (k === 'conversation') return { input: { for: () => customInput } };
    if (k === 'sessions') return { scope: () => ({}) };
    return undefined;
  };
  await b.controller.addNonImage('s1', customInput, new File(['x'], '报告.txt', { type: 'text/plain' }));
  assert.equal(calls.length, 1, 'insertReference 被调用一次');
  /* 已有 chip @0（offset=0），正文从第 2 字符开始 → 新 chip 插在 offset=2（紧跟 chip、正文之前） */
  assert.equal(calls[0].start, 2, '输入框已有文字时 chip 插到最前（正文之前）');
});

test('chip 位置：输入框只有文字（无 chip）时上传 → insertReference 于 start=0（最前）', async () => {
  const calls = [];
  const b = bootClient({
    sandbox: {
      FileReader: class {
        onerror = null;
        onload = null;
        readAsDataURL() { if (this.onload) this.onload({ target: { result: 'data:application/octet-stream;base64,eA==' } }); else this.onerror({ message: 'no onload' }); }
      },
    },
    fetch: (url) => {
      const u = String(url || '');
      if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) });
      if (u.indexOf('/api/omnifile/save') >= 0) return Promise.resolve({ json: async () => ({ ok: true, path: 'C:/u/9.save', kind: 'text', size: 5 }) });
      if (u.indexOf('/api/omnifile/process') >= 0) return Promise.resolve({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/u/9.md' }) });
      if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) });
      return Promise.resolve({ json: async () => ({ ok: false }) });
    },
  });
  let snap = { occurrences: [], draft: '我已经输入了一些文字内容', draftRev: 3, phase: 'plain' };
  const customInput = {
    notify() {},
    notices: { set() {} },
    state: { getSnapshot: () => snap },
    insertReference(ref, span) {
      calls.push({ ref: ref.ref, start: span.start, end: span.end, draftRev: span.draftRev });
      snap = { ...snap, draft: '￼ ' + snap.draft, draftRev: snap.draftRev + 1, occurrences: [{ ref: ref.ref, source: '文件', occurrenceId: 'o1', offset: span.start }] };
      return true;
    },
    addImages() {},
  };
  b.controller.ctx.get = (k) => {
    if (k === 'conversation') return { input: { for: () => customInput } };
    if (k === 'sessions') return { scope: () => ({}) };
    return undefined;
  };
  await b.controller.addNonImage('s1', customInput, new File(['y'], '说明.txt', { type: 'text/plain' }));
  assert.equal(calls.length, 1, 'insertReference 被调用一次');
  assert.equal(calls[0].start, 0, '输入框只有文字时 chip 插到最前（start=0）');
  assert.equal(calls[0].end, 0, 'end=start');
  assert.equal(calls[0].draftRev, 3, '使用读取时的 draftRev 做 CAS');
});

/* ============ 12. 多模态模型枚举（#4）：全面列出已注册 provider 的模型（含 DSH 内置 DeepSeek） ============ */
/** 提取宿主模型枚举/解析相关函数（enumerateModels、resolveConfiguredProvider、builtinProviderDefaults 及视觉推断依赖）。 */
function loadModelUtils() {
  const anchors = ['const VISION_HINT_RE', 'function builtinProviderDefaults', 'function inferModelImage',
    'async function enumerateModels', 'async function resolveConfiguredProvider'];
  let scope = '(function(){';
  for (const anchor of anchors) {
    let fn = extractFn(indexSrc, anchor);
    if (fn === null) {
      /* 常量声明（const VISION_HINT_RE = ...;）用行提取 */
      const lineStart = indexSrc.indexOf(anchor);
      if (lineStart >= 0) {
        const semi = indexSrc.indexOf(';', lineStart);
        if (semi > lineStart) fn = indexSrc.slice(lineStart, semi + 1);
      }
    }
    assert.ok(fn, '可提取 ' + anchor);
    scope += '\n' + fn;
  }
  scope += '\nreturn { builtinProviderDefaults, inferModelImage, enumerateModels, resolveConfiguredProvider };\n})';
  return eval('(' + scope + ')')();
}

/** 构造极简 fake ctx：settings.get 按 namespace 返回配置，llm 提供 provider 与模型目录。 */
function makeModelCtx({ settings, llm }) {
  const settingsMap = settings || {};
  const providerModels = llm?.providerModels || {};
  const providers = llm?.providers || [];
  const directory = llm?.directory || [];
  return {
    settings: {
      get: (ns) => settingsMap[ns],
    },
    get: (k) => {
      if (k !== 'llm') return undefined;
      return {
        listConfigurableProviders: () => directory,
        listProviders: () => providers,
        listModels: async (provider) => providerModels[provider] || [],
      };
    },
  };
}

test('模型枚举：全面列出已注册 provider 的模型（DSH 内置 DeepSeek + 自定义 pi-ai，含 image 标注）', async () => {
  const { enumerateModels } = loadModelUtils();
  const ctx = makeModelCtx({
    settings: {
      'llm-deepseek': {
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1000000 },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1000000 },
          { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Vision', contextWindow: 1000000 },
        ],
      },
      'llm-pi-ai': {
        providers: {
          vllm: { displayName: 'local-ds-v4', apiKeyEnv: 'VLLM_API_KEY', baseURL: 'http://a/v1', defaultInput: ['text'], models: [{ id: 'general-model', name: 'local-ds-v4' }] },
          vision: { displayName: 'local-vision', apiKeyEnv: 'VISION_API_KEY', baseURL: 'http://b/v1', defaultInput: ['text', 'image'], models: [{ id: 'general-model', name: 'local-vision' }] },
        },
      },
    },
    llm: {
      directory: [
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
        { provider: 'vllm', displayName: 'local-ds-v4', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vllm'] },
        { provider: 'vision', displayName: 'local-vision', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] },
      ],
      providers: [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'vllm', name: 'local-ds-v4' },
        { id: 'vision', name: 'local-vision' },
        { id: 'omnifile-vllm', name: 'local-ds-v4 (Omnifile)' }, /* 本插件变体，应被跳过 */
      ],
      providerModels: {
        'deepseek-official': [
          { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text'] },
          { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', inputModalities: ['text'] },
          { provider: 'deepseek-official', id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Vision', inputModalities: ['text'] },
        ],
        vllm: [{ provider: 'vllm', id: 'general-model', name: 'local-ds-v4', inputModalities: ['text'] }],
        vision: [{ provider: 'vision', id: 'general-model', name: 'local-vision', inputModalities: ['text', 'image'] }],
        'omnifile-vllm': [{ provider: 'omnifile-vllm', id: 'general-model', name: 'local-ds-v4 (Omnifile)', inputModalities: ['text', 'image'] }],
      },
    },
  });
  const list = await enumerateModels(ctx);
  const ids = list.map((m) => m.ref);
  const byRef = Object.fromEntries(list.map((m) => [m.ref, m]));

  /* DSH 内置 DeepSeek 模型必须出现 */
  assert.ok(ids.includes('llm-deepseek/deepseek-official/deepseek-v4-flash'), 'DeepSeek v4-flash 出现');
  assert.ok(ids.includes('llm-deepseek/deepseek-official/deepseek-v4-pro'), 'DeepSeek v4-pro 出现');
  assert.ok(ids.includes('llm-deepseek/deepseek-official/deepseek-v4-flash-vision-exp'), 'DeepSeek v4-flash-vision-exp 出现');
  assert.equal(byRef['llm-deepseek/deepseek-official/deepseek-v4-flash'].image, false, 'DeepSeek 纯文本 → image=false');
  assert.equal(byRef['llm-deepseek/deepseek-official/deepseek-v4-flash'].providerDisplay, 'DeepSeek', 'DeepSeek 显示名');
  /* 用户在设置里显式声明的视觉模型（adapter 报 text-only）→ 按名称/ID 视觉关键字推断为 image=true */
  assert.equal(byRef['llm-deepseek/deepseek-official/deepseek-v4-flash-vision-exp'].image, true, 'deepseek-v4-flash-vision-exp 推断为视觉模型');

  /* 自定义 pi-ai 的 vllm（文本）与 vision（图片）都出现 */
  assert.ok(ids.includes('llm-pi-ai/vllm/general-model'), 'pi-ai vllm 出现');
  assert.ok(ids.includes('llm-pi-ai/vision/general-model'), 'pi-ai vision 出现');
  assert.equal(byRef['llm-pi-ai/vllm/general-model'].image, false, 'vllm 纯文本 → image=false');
  assert.equal(byRef['llm-pi-ai/vision/general-model'].image, true, 'vision 支持图片 → image=true');
  assert.equal(byRef['llm-pi-ai/vision/general-model'].baseURL, 'http://b/v1', 'baseURL 从 profile 关联');

  /* 本插件 omnifile-* 变体必须被跳过 */
  assert.ok(!ids.some((ref) => ref.includes('/omnifile-')), 'omnifile-* 变体不出现');
});

test('模型枚举：adapter 未公布时回退 settings profile 显式模型；provider 目录为空时不崩溃', async () => {
  const { enumerateModels } = loadModelUtils();
  /* 只有 settings profile 显式声明模型、adapter 目录不可用（llm 服务缺失） */
  const ctxNoLlm = {
    settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { vision: { displayName: 'v', baseURL: 'http://x', defaultInput: ['text', 'image'], models: [{ id: 'm1', name: 'M1' }] } } } : undefined) },
    get: () => undefined,
  };
  const list1 = await enumerateModels(ctxNoLlm);
  assert.equal(list1.length, 0, 'llm 服务缺失时返回空（不崩溃）');

  /* adapter 有目录但某个 provider 的 listModels 抛错 → 回退 profile 显式模型 */
  const ctx = makeModelCtx({
    settings: {
      'llm-pi-ai': { providers: { vision: { displayName: 'v', baseURL: 'http://x', defaultInput: ['text', 'image'], models: [{ id: 'm1', name: 'M1' }] } } },
    },
    llm: {
      directory: [{ provider: 'vision', displayName: 'v', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] }],
      providers: [],
      providerModels: {},
    },
  });
  /* 让 listProviders 返回空，但 settings profile 里有显式模型（profile 回退仍应列出、去重） */
  const list2 = await enumerateModels(ctx);
  assert.ok(list2.some((m) => m.ref === 'llm-pi-ai/vision/m1'), 'profile 显式模型被枚举');
  assert.equal(list2.find((m) => m.ref === 'llm-pi-ai/vision/m1').image, true, 'profile 模型 image 标注来自 defaultInput');
});

test('providerRef 解析：DSH 内置 DeepSeek 无 settings profile 时回退默认端点/凭据；自定义 provider 正常解析', async () => {
  const { resolveConfiguredProvider } = loadModelUtils();
  /* 内置 DeepSeek：settings 无 llm-deepseek 小节 → 回退官方默认 */
  const ctxDeep = makeModelCtx({
    settings: {},
    llm: { directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }] },
  });
  const r1 = await resolveConfiguredProvider(ctxDeep, 'llm-deepseek/deepseek-official/deepseek-v4-flash');
  assert.ok(r1, '内置 provider 可解析');
  assert.equal(r1.baseUrl, 'https://api.deepseek.com', '默认端点');
  assert.equal(r1.credential, 'DEEPSEEK_API_KEY', '默认凭据引用');
  assert.equal(r1.model, 'deepseek-v4-flash', '模型透传');

  /* 内置 DeepSeek：settings 显式配置 baseURL → 优先用配置 */
  const ctxDeep2 = makeModelCtx({
    settings: { 'llm-deepseek': { baseURL: 'http://gw/deepseek', apiKeyEnv: 'MY_KEY' } },
    llm: { directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }] },
  });
  const r2 = await resolveConfiguredProvider(ctxDeep2, 'llm-deepseek/deepseek-official/deepseek-v4-pro');
  assert.ok(r2);
  assert.equal(r2.baseUrl, 'http://gw/deepseek', '优先 settings baseURL');
  assert.equal(r2.credential, 'MY_KEY', '优先 settings apiKeyEnv');

  /* 自定义 pi-ai vision：从 providers.vision profile 解析 */
  const ctxPi = makeModelCtx({
    settings: { 'llm-pi-ai': { providers: { vision: { displayName: 'v', baseURL: 'http://b/v1', apiKeyEnv: 'VISION_API_KEY' } } } },
    llm: { directory: [{ provider: 'vision', displayName: 'v', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] }] },
  });
  const r3 = await resolveConfiguredProvider(ctxPi, 'llm-pi-ai/vision/general-model');
  assert.ok(r3);
  assert.equal(r3.baseUrl, 'http://b/v1', 'pi-ai baseURL');
  assert.equal(r3.credential, 'VISION_API_KEY', 'pi-ai apiKeyEnv');
  assert.equal(r3.model, 'general-model', 'pi-ai 模型透传');

  /* 无效目录：无匹配 entry → null */
  const r4 = await resolveConfiguredProvider(ctxPi, 'unknown/ns/model');
  assert.equal(r4, null, '无法解析返回 null');
});

