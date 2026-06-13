// 用 mock 注入断言 window-factory 的行为契约,不触真实 electron。
const { test } = require('node:test');
const assert = require('node:assert');
const { createWindow, isAlive } = require('../../src/platform/electron/window-factory');

// 造一个记录调用的假 BrowserWindow 类,代替真实 electron 类型
function makeFakeBrowserWindowClass() {
    const instances = [];
    class FakeBrowserWindow {
        constructor(opts) {
            this.opts = opts;
            this.destroyed = false;
            this.calls = [];
            this.listeners = {};
            this.webContents = {
                sent: [],
                send: (channel, payload) => this.webContents.sent.push({ channel, payload }),
                session: {
                    webRequest: {
                        headersHandler: null,
                        onHeadersReceived: (fn) => { this.webContents.session.webRequest.headersHandler = fn; }
                    }
                }
            };
            this.position = [0, 0];
            this.bounds = { x: 0, y: 0, width: 100, height: 100 };
            this.visible = false;
            instances.push(this);
        }
        loadFile(p) { this.calls.push(['loadFile', p]); return Promise.resolve(); }
        on(name, fn) { this.calls.push(['on', name]); this.listeners[name] = fn; }
        show() { this.visible = true; this.calls.push(['show']); }
        hide() { this.visible = false; this.calls.push(['hide']); }
        focus() { this.calls.push(['focus']); }
        close() { this.calls.push(['close']); }
        showInactive() { this.calls.push(['showInactive']); }
        isVisible() { return this.visible; }
        setSize(w, h) { this.calls.push(['setSize', w, h]); }
        setPosition(x, y) { this.position = [x, y]; }
        getPosition() { return this.position; }
        setBounds(b) { this.bounds = b; }
        getBounds() { return this.bounds; }
        setAlwaysOnTop(flag, level) { this.calls.push(['setAlwaysOnTop', flag, level]); }
        setVisibleOnAllWorkspaces(flag, o) { this.calls.push(['setVisibleOnAllWorkspaces', flag]); }
        isDestroyed() { return this.destroyed; }
    }
    return { FakeBrowserWindow, instances };
}

test('createWindow 把注入的类实例化并剥掉 BrowserWindow 字段后传给构造', () => {
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
    createWindow({ BrowserWindow: FakeBrowserWindow, width: 300, height: 200, transparent: true });
    assert.strictEqual(instances.length, 1);
    assert.deepStrictEqual(instances[0].opts, { width: 300, height: 200, transparent: true });
    assert.ok(!('BrowserWindow' in instances[0].opts));
});

test('createWindow 缺少 BrowserWindow 注入时抛出清晰错误', () => {
    assert.throws(() => createWindow({ width: 300 }), /BrowserWindow/);
});

test('句柄方法转发到底层窗口', () => {
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    const raw = instances[0];

    w.loadFile('index.html');
    w.show();
    w.hide();
    w.focus();
    w.setSize(10, 20);
    w.setAlwaysOnTop(true, 'screen-saver');

    assert.ok(raw.calls.some(c => c[0] === 'loadFile' && c[1] === 'index.html'));
    assert.ok(raw.calls.some(c => c[0] === 'show'));
    assert.ok(raw.calls.some(c => c[0] === 'hide'));
    assert.ok(raw.calls.some(c => c[0] === 'focus'));
    assert.ok(raw.calls.some(c => c[0] === 'setSize' && c[1] === 10 && c[2] === 20));
    assert.ok(raw.calls.some(c => c[0] === 'setAlwaysOnTop' && c[1] === true && c[2] === 'screen-saver'));
});

test('send 走 webContents.send,业务侧不见 webContents', () => {
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    w.send('character-update', { name: 'x' });
    assert.deepStrictEqual(instances[0].webContents.sent, [{ channel: 'character-update', payload: { name: 'x' } }]);
    assert.strictEqual(w.webContents, undefined);
});

test('getPosition 产出平直的 {x,y},不暴露数组', () => {
    const { FakeBrowserWindow } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    w.setPosition(40, 50);
    assert.deepStrictEqual(w.getPosition(), { x: 40, y: 50 });
});

test('setBounds 与 getBounds 透传边界对象', () => {
    const { FakeBrowserWindow } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    w.setBounds({ x: 1, y: 2, width: 3, height: 4 });
    assert.deepStrictEqual(w.getBounds(), { x: 1, y: 2, width: 3, height: 4 });
});

test('on 注册监听并返回句柄本身以便链式', () => {
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    const cb = () => {};
    const ret = w.on('closed', cb);
    assert.strictEqual(ret, w);
    assert.strictEqual(instances[0].listeners.closed, cb);
});

test('applyResponseHeader 注册响应头改写并合并进既有头', () => {
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    w.applyResponseHeader('Content-Security-Policy', ['default-src self']);
    const handler = instances[0].webContents.session.webRequest.headersHandler;
    assert.strictEqual(typeof handler, 'function');
    let captured = null;
    handler({ responseHeaders: { 'X-Old': ['v'] } }, (r) => { captured = r; });
    assert.deepStrictEqual(captured.responseHeaders, {
        'X-Old': ['v'],
        'Content-Security-Policy': ['default-src self']
    });
});

test('isAlive 对存活窗口为真、销毁后为假、对空句柄为假', () => {
    const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
    const w = createWindow({ BrowserWindow: FakeBrowserWindow });
    assert.strictEqual(isAlive(w), true);
    instances[0].destroyed = true;
    assert.strictEqual(isAlive(w), false);
    assert.strictEqual(isAlive(null), false);
    assert.strictEqual(isAlive({}), false);
});
