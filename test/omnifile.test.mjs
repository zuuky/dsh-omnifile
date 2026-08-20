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
  const sandbox = { window, document, MutationObserver, NodeFilter: { SHOW_TEXT: 4 }, console, Promise, Set, Map, Array, Object, String, Date, Math, JSON, RegExp, Number, encodeURIComponent, Symbol, Error, Uint8Array, FileReader: class {}, fetch: fetchStub, setInterval, clearInterval, setTimeout, clearTimeout };
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
