// 用 mock 注入断言 tray-factory 的行为契约,不触真实 electron。
const { test } = require('node:test');
const assert = require('node:assert');
const { createTray } = require('../../src/platform/electron/tray-factory');

// 造记录调用的假 Tray 类与假 Menu,代替真实 electron 类型
function makeFakes() {
    const trayInstances = [];
    class FakeTray {
        constructor(iconPath) {
            this.iconPath = iconPath;
            this.tooltip = null;
            this.listeners = {};
            this.contextMenu = null;
            this.destroyed = false;
            trayInstances.push(this);
        }
        setToolTip(text) { this.tooltip = text; }
        on(name, fn) { this.listeners[name] = fn; }
        setContextMenu(menu) { this.contextMenu = menu; }
        destroy() { this.destroyed = true; }
    }
    const builtTemplates = [];
    const Menu = {
        buildFromTemplate(template) {
            const menu = { __template: template };
            builtTemplates.push(template);
            return menu;
        }
    };
    return { FakeTray, trayInstances, Menu, builtTemplates };
}

test('createTray 用注入的 Tray 类建托盘并设置图标与提示', () => {
    const { FakeTray, trayInstances, Menu } = makeFakes();
    createTray({ Tray: FakeTray, Menu, iconPath: '/icons/app.png', tooltip: 'Live2DPet' });
    assert.strictEqual(trayInstances.length, 1);
    assert.strictEqual(trayInstances[0].iconPath, '/icons/app.png');
    assert.strictEqual(trayInstances[0].tooltip, 'Live2DPet');
});

test('createTray 注册点击回调到底层托盘', () => {
    const { FakeTray, trayInstances, Menu } = makeFakes();
    const onClick = () => {};
    createTray({ Tray: FakeTray, Menu, iconPath: 'x', onClick });
    assert.strictEqual(trayInstances[0].listeners.click, onClick);
});

test('setMenu 把平直模板经 Menu.buildFromTemplate 转后设进托盘', () => {
    const { FakeTray, trayInstances, Menu, builtTemplates } = makeFakes();
    const handle = createTray({ Tray: FakeTray, Menu, iconPath: 'x' });
    const template = [{ label: 'a', click: () => {} }, { type: 'separator' }];
    handle.setMenu(template);
    assert.strictEqual(builtTemplates.length, 1);
    assert.strictEqual(builtTemplates[0], template);
    assert.strictEqual(trayInstances[0].contextMenu.__template, template);
});

test('setToolTip 转发到底层托盘', () => {
    const { FakeTray, trayInstances, Menu } = makeFakes();
    const handle = createTray({ Tray: FakeTray, Menu, iconPath: 'x' });
    handle.setToolTip('hi');
    assert.strictEqual(trayInstances[0].tooltip, 'hi');
});

test('destroy 转发到底层托盘', () => {
    const { FakeTray, trayInstances, Menu } = makeFakes();
    const handle = createTray({ Tray: FakeTray, Menu, iconPath: 'x' });
    handle.destroy();
    assert.strictEqual(trayInstances[0].destroyed, true);
});

test('缺少 Tray 注入时抛出清晰错误', () => {
    const { Menu } = makeFakes();
    assert.throws(() => createTray({ Menu, iconPath: 'x' }), /Tray/);
});

test('缺少 Menu 注入时抛出清晰错误', () => {
    const { FakeTray } = makeFakes();
    assert.throws(() => createTray({ Tray: FakeTray, iconPath: 'x' }), /Menu/);
});

test('句柄不暴露原始 Tray 实例', () => {
    const { FakeTray, Menu } = makeFakes();
    const handle = createTray({ Tray: FakeTray, Menu, iconPath: 'x' });
    assert.deepStrictEqual(Object.keys(handle).sort(), ['destroy', 'setMenu', 'setToolTip']);
});
