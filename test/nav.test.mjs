/**
 * dsh-omnifile 会话内「用户消息」快速定位导航（nav.ts）回归测试（node:test）
 * 运行：node --test test/nav.test.mjs
 *
 * 覆盖（对 lib/client.js 内联实现做 DOM 桩级行为验证）：
 *  - ≤1 条用户消息 → 导航完全隐藏；
 *  - ≥2 条用户消息 → 显示等量锚点圆点，点击即滚动定位到对应用户消息；
 *  - 视口内当前用户消息 → 对应圆点高亮（active）；
 *  - hover 命中带/导航 → 激活可交互（pointer-events 门控）；
 *  - 样式静态断言：低 z-index + 默认 pointer-events:none（不挡弹窗/页面）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');

/* ── 轻量 DOM 桩（仅覆盖 nav.ts 使用的 API；导航元素即本插件的 HTMLElement） ── */
function createClassList() {
    const set = new Set();
    return {
        add(...names) { for (const n of names) set.add(n); },
        remove(...names) { for (const n of names) set.delete(n); },
        contains(n) { return set.has(n); },
        toggle(n, force) { const next = force === undefined ? !set.has(n) : !!force; next ? set.add(n) : set.delete(n); return next; },
    };
}

class HTMLElementStub {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.attributes = new Map();
        this.childNodes = [];
        this.parentNode = null;
        this.style = {};
        this.classList = createClassList();
        this.dataset = {};
        this._listeners = {};
        this.offsetWidth = 0;
        this.scrollTop = 0;
        this.className = '';
        this._text = undefined;
        this._overflowY = 'visible';
        this._rect = { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    hasAttribute(k) { return this.attributes.has(k); }
    removeAttribute(k) { this.attributes.delete(k); }
    remove() { if (!this.parentNode) return; const i = this.parentNode.childNodes.indexOf(this); if (i >= 0) this.parentNode.childNodes.splice(i, 1); this.parentNode = null; }
    get parentElement() { return this.parentNode; }
    appendChild(child) { if (child.parentNode) child.remove(); child.parentNode = this; this.childNodes.push(child); return child; }
    set textContent(v) { this.childNodes = []; this._text = v == null ? '' : String(v); }
    get textContent() { if (this._text !== undefined) return this._text; return this.childNodes.map((c) => c.textContent).join(''); }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { const a = this._listeners[type]; if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    dispatchEvent(ev) { ev.target = ev.target || this; const a = this._listeners[ev.type] || []; for (const fn of [...a]) fn.call(this, ev); return !ev.defaultPrevented; }
    getBoundingClientRect() {
        const base = { ...this._rect };
        if (this._scrollRef) {
            base.top = base.top - this._scrollRef.scrollTop;
            base.bottom = base.bottom - this._scrollRef.scrollTop;
        }
        return base;
    }
    closest(sel) { let n = this; while (n) { if (matchSelector(n, sel)) return n; n = n.parentNode; } return null; }
    querySelector(sel) { return queryAll(this, sel, false); }
    querySelectorAll(sel) { return queryAll(this, sel, true); }
}

const ATTR_RE = /^\[([a-z][a-z0-9-]*)(\*?=)?"?([^\]"]*)"?\]$/;
function matchSelector(el, sel) {
    const m = ATTR_RE.exec(sel);
    if (m === null) return false;
    const attr = m[1];
    const op = m[2];
    const val = m[3];
    if (op === '*=') {
        const hay = attr === 'class' ? String(el.className || '') : String(el.getAttribute(attr) || '');
        return hay.includes(val);
    }
    const v = el.getAttribute(attr);
    if (v === null) return false;
    return val === '' || v === val;
}
function queryAll(root, sel, all) {
    const out = [];
    const walk = (node) => {
        if (node !== root && matchSelector(node, sel)) out.push(node);
        for (const c of node.childNodes) walk(c);
    };
    walk(root);
    return all ? out : (out[0] || null);
}

/** 构造会话 DOM：滚动容器 → 消息流 → userCount 条用户消息行（含 bubble）。 */
function makeSession(userCount) {
    const scroller = new HTMLElementStub('div');
    scroller._overflowY = 'auto';
    scroller._rect = { top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 };
    const flow = new HTMLElementStub('div');
    flow.setAttribute('data-chat-flow', '');
    flow._rect = { top: 0, left: 0, right: 760, bottom: 560, width: 760, height: 560 };
    scroller.appendChild(flow);
    const rows = [];
    for (let i = 0; i < userCount; i++) {
        const row = new HTMLElementStub('div');
        row.setAttribute('data-time-hover-root', '');
        const bubble = new HTMLElementStub('div');
        bubble.className = 'gdEzaW_bubble';
        row.appendChild(bubble);
        row._bubble = bubble;
        row._rect = { top: 60 + i * 260, left: 0, right: 760, bottom: 60 + (i + 1) * 260, width: 760, height: 260 };
        row._scrollRef = scroller;
        flow.appendChild(row);
        rows.push(row);
    }
    return { scroller, flow, rows };
}

/** 加载 client.js 并 apply，返回可控的 DOM / nav 引用。 */
function bootNav(userCount) {
    const doc = new HTMLElementStub('document');
    doc.body = new HTMLElementStub('body');
    doc.documentElement = new HTMLElementStub('html');
    doc.head = new HTMLElementStub('head');
    doc.appendChild = () => {};
    Object.defineProperty(doc, '_body_', { value: true });
    doc.createElement = (tag) => new HTMLElementStub(tag);
    doc.createDocumentFragment = () => new HTMLElementStub('#fragment');
    doc.createTreeWalker = () => ({ nextNode: () => null });
    // 以 body 为根的查找委托
    doc.querySelector = (sel) => queryAll(doc.body, sel, false);
    doc.querySelectorAll = (sel) => queryAll(doc.body, sel, true);
    const session = makeSession(userCount);
    doc.body.appendChild(session.scroller);

    const observers = [];
    const MutationObserverStub = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() { this.observed = true; } disconnect() {} trigger(muts) { this.cb(muts || [], this); } };
    const sandbox = {
        HTMLElement: HTMLElementStub,
        document: doc,
        console,
        Promise,
        Set, Map, Array, Object, String, Number, Math, JSON, RegExp, Symbol, Error,
        Uint8Array, Buffer,
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        setTimeout, clearTimeout,
        getComputedStyle: (el) => ({ overflowY: el._overflowY }),
        WheelEvent: class { constructor(type, init) { this.type = type; this.deltaY = (init && init.deltaY) || 0; this.bubbles = !!(init && init.bubbles); this.cancelable = !!(init && init.cancelable); } },
        ResizeObserver: class { constructor() {} observe() {} disconnect() {} },
        MutationObserver: MutationObserverStub,
        fetch: () => Promise.resolve({ json: async () => ({ ok: false }) }),
        addEventListener() {}, removeEventListener() {},
    };
    sandbox.window = sandbox;
    sandbox.window.innerWidth = 1400;
    sandbox.window.innerHeight = 900;
    sandbox.window.__ModuleLoader__ = {
        load(entry) {
            const module = { exports: {} };
            const req = (name) => name === 'react' ? { createElement: () => ({}) } : { __dshModule: name };
            const ret = entry.factory(req);
            sandbox.window.__EX__ = ret ?? module.exports;
        },
    };
    let noticeValue = null;
    const occurrences = [];
    const fakeInput = { notify() {}, notices: { set: (v) => { noticeValue = v; } }, state: { getSnapshot: () => ({ occurrences, phase: 'plain' }) } };
    const registered = {};
    const slotsStub = {
        register(opts, Component) { registered[opts.name] = { opts, Component }; return {}; },
        inject(name, factory) { factory.call({ slots: slotsStub }); },
    };
    const ctx = {
        effect(fn) { return typeof fn === 'function' ? fn() : undefined; },
        slots: slotsStub,
        inject() {},
        get: (k) => {
            if (k === 'sessions') return { scope: () => ({}) };
            if (k === 'conversation') return { input: { for: () => fakeInput } };
            if (k === 'settings') return undefined;
            return undefined;
        },
    };
    vm.runInNewContext(clientSrc, sandbox, { filename: 'client.js' });
    sandbox.window.__EX__.apply(ctx);

    const byAttr = (attr) => queryAll(doc.body, '[' + attr + ']', false);
    return {
        doc,
        session,
        bar: () => byAttr('data-omnifile-nav'),
        strip: () => byAttr('data-omnifile-nav-strip'),
        dots: () => queryAll(byAttr('data-omnifile-nav'), '[data-omnifile-nav-dot]', true),
        more: (dir) => queryAll(byAttr('data-omnifile-nav'), '[data-omnifile-nav-more]', true).find((el) => el.getAttribute('data-dir') === dir) || null,
        tip: () => byAttr('data-omnifile-nav-tip'),
        observer: () => observers.find((o) => o.observed === true) || observers[0],
        flush: () => new Promise((r) => setTimeout(r, 15)),
        noticeValue,
    };
}

/* ============ 1. 静态设计断言：低层级 + 事件穿透（不挡弹窗/页面） ============ */
test('nav 样式：低 z-index + 默认 pointer-events:none + 命中带', () => {
    assert.match(clientSrc, /\.omnifile-nav\{[^}]*z-index:40/, '导航层级低于弹窗层');
    assert.match(clientSrc, /\.omnifile-nav\{[^}]*pointer-events:none/, '默认事件穿透，不拦截任何鼠标');
    assert.match(clientSrc, /\.omnifile-nav\.active\{pointer-events:auto;?\}/, 'hover 激活后才可交互');
    assert.ok(clientSrc.indexOf('.omnifile-nav-strip{') >= 0, '命中带存在');
    assert.ok(clientSrc.indexOf('.omnifile-nav-dot{') >= 0, '锚点圆点样式存在');
    assert.ok(clientSrc.indexOf('.omnifile-nav-more{') >= 0, '更多按钮样式存在');
    assert.ok(clientSrc.indexOf('.omnifile-nav-tip{') >= 0, '内容预览样式存在');
    assert.ok(clientSrc.indexOf('data-omnifile-nav') >= 0, '导航标识编译进 bundle');
});

test('nav 样式：圆点 10px + 间距 12px + 预览样式', () => {
    assert.match(clientSrc, /\.omnifile-nav-dot\{[^}]*width:10px/, '圆点 10px 宽');
    assert.match(clientSrc, /\.omnifile-nav-dot\{[^}]*height:10px/, '圆点 10px 高');
    assert.match(clientSrc, /\.omnifile-nav\{[^}]*gap:12px/, '圆点上下间距 12px');
    assert.match(clientSrc, /\.omnifile-nav-dot:hover\{[^}]*width:24px/, 'hover 拉长胶囊 24px');
    assert.match(clientSrc, /\.omnifile-nav-tip\{[^}]*pointer-events:none/, '预览不拦截鼠标');
});

/* CSS 选择器与 DOM class 必须对齐：历史 bug——JS 只设 attribute 而 CSS 用 class，
 * 导致全部导航样式不生效（元素跑到页面左下角、白色方块、一行排列）。 */
test('nav DOM 与 CSS class 对齐（元素带 .omnifile-nav* class）', async () => {
    const b = bootNav(3);
    const bar = b.bar();
    const strip = b.strip();
    assert.match(bar.className, /(^|\s)omnifile-nav(\s|$)/, 'nav 元素带 .omnifile-nav class');
    assert.match(strip.className, /(^|\s)omnifile-nav-strip(\s|$)/, 'strip 带 .omnifile-nav-strip class');
    const dots = b.dots();
    assert.ok(dots.length >= 1, '有锚点圆点');
    assert.match(dots[0].className, /(^|\s)omnifile-nav-dot(\s|$)/, '圆点带 .omnifile-nav-dot class');
    await b.flush();
});

/* ============ 2. 行为：无用户消息 → 隐藏；1 条 → 显示单个锚点 ============ */
test('nav 行为：只有一条用户消息时显示单个锚点', async () => {
    const b = bootNav(1);
    assert.equal(b.bar().style.display, 'flex', '单条用户消息 → 显示');
    assert.equal(b.dots().length, 1, '一个锚点圆点');
    await b.flush();
});

test('nav 行为：没有用户消息时不显示', async () => {
    const b = bootNav(0);
    assert.equal(b.bar().style.display, 'none', '无用户消息 → 隐藏');
});

/* ============ 3. 行为：≥2 条用户消息 → 显示并定位 ============ */
test('nav 行为：多条用户消息 → 等量圆点 + 点击滚动定位 + 视口高亮', async () => {
    const b = bootNav(2);
    const bar = b.bar();
    assert.equal(bar.style.display, 'flex', '两条用户消息 → 显示');
    const dots = b.dots();
    assert.equal(dots.length, 2, '每条用户消息一个圆点');

    /* 视口内最靠上的用户消息(row0 top=60)高亮 */
    assert.ok(dots[0].classList.contains('active'), 'row0 位于视口 → dot0 高亮');
    assert.ok(!dots[1].classList.contains('active'), 'row1 视口外 → 不高亮');

    /* 点击第二个圆点 → 滚动定位到该用户消息 */
    const scroller = b.session.scroller;
    const before = scroller.scrollTop;
    dots[1].dispatchEvent({ type: 'click' });
    const expected = before + (b.session.rows[1]._rect.top - scroller._rect.top);
    assert.equal(scroller.scrollTop, expected, 'scrollTop 定位到目标用户消息');
});

/* ============ 4. 行为：超过 10 条 → 窗口化 + 上下「展开更多」 ============ */
test('nav 行为：超过 10 条窗口化，▲/▼ 更多按钮点击定位并平移窗口', async () => {
    const b = bootNav(11);
    const bar = b.bar();
    assert.equal(bar.style.display, 'flex', '有用户消息 → 显示');

    /* 初始 active=row0(视口顶部) → 窗口 rows0..9，仅底部有 ▼ */
    assert.equal(b.dots().length, 10, '窗口化只渲染 10 个锚点');
    assert.equal(b.more('up'), null, '顶部无「更多」');
    assert.ok(b.more('down'), '底部有「展开更多」');

    /* 点击 ▼ → 定位到最后一对消息，窗口平移到底部，顶部出现 ▲ */
    const scroller = b.session.scroller;
    b.more('down').dispatchEvent({ type: 'click' });
    await b.flush();
    const expected = b.session.rows[10]._rect.top - scroller._rect.top;
    assert.equal(scroller.scrollTop, expected, '▼ 定位到最后一对用户消息');
    assert.equal(b.dots().length, 10, '窗口仍为 10 个锚点');
    assert.ok(b.more('up'), '窗口移到底部后顶部出现「展开更多」');
    assert.equal(b.more('down'), null, '已到最后一条，底部「更多」消失');

    /* 点击 ▲ → 回到头部窗口，底部「更多」回归 */
    b.more('up').dispatchEvent({ type: 'click' });
    await b.flush();
    const upTarget = b.session.rows[0]._rect.top - scroller._rect.top;
    assert.equal(scroller.scrollTop, upTarget, '▲ 定位回最早的用户消息');
    assert.equal(b.more('up'), null, '回到顶部窗口后「更多」消失');
    assert.ok(b.more('down'), '底部「展开更多」恢复');
});

/* ============ 5. 行为：hover 圆点 → 用户消息内容预览（100 字截断） ============ */
test('nav 行为：hover 圆点显示内容预览，超过 100 字截断，移出隐藏', async () => {
    const b = bootNav(3);
    b.session.rows[0]._bubble.textContent = '短消息：今天进展如何？';
    b.session.rows[1]._bubble.textContent = '很长的内容'.repeat(40);
    await b.flush();
    const dots = b.dots();
    const tip = b.tip();
    assert.ok(tip, '预览元素存在');
    assert.equal(tip.style.display, 'none', '初始隐藏');

    dots[0].dispatchEvent({ type: 'mouseenter' });
    assert.equal(tip.style.display, 'block', 'hover 显示预览');
    assert.equal(tip.textContent, '短消息：今天进展如何？', '预览内容为该用户消息');

    dots[1].dispatchEvent({ type: 'mouseenter' });
    assert.equal(tip.textContent, '很长的内容'.repeat(40).slice(0, 100) + '…', '超过 100 字截断为 100 字');

    dots[1].dispatchEvent({ type: 'mouseleave' });
    assert.equal(tip.style.display, 'none', '移出圆点隐藏预览');
    await b.flush();
});

/* ============ 5. 行为：hover 门控（默认穿透，激活后 pointer-events:auto） ============ */
test('nav 行为：命中带/导航 hover 切换 active', async () => {
    const b = bootNav(2);
    const bar = b.bar();
    assert.ok(!bar.classList.contains('active'), '初始未激活');
    b.strip().dispatchEvent({ type: 'mouseenter' });
    assert.ok(bar.classList.contains('active'), '进入命中带 → 激活');
    b.strip().dispatchEvent({ type: 'mouseleave' });
    assert.ok(!bar.classList.contains('active'), '离开命中带 → 还原');
    b.bar().dispatchEvent({ type: 'mouseenter' });
    assert.ok(bar.classList.contains('active'), '直接 hover 导航 → 激活');
    b.bar().dispatchEvent({ type: 'mouseleave' });
    assert.ok(!bar.classList.contains('active'), '离开导航 → 还原');
});
