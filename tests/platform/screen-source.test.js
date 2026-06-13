// 用 mock 注入断言 screen-source 的行为契约,不触真实 electron。
const { test } = require('node:test');
const assert = require('node:assert');
const { captureScreen, idleTime, screenLayout } = require('../../src/platform/electron/screen-source');

// 造一个产出已知 base64 的假缩略图,并记录是否被置空以验证释放
function makeSource(name, jpegBytes) {
    return {
        name,
        thumbnail: { toJPEG: () => Buffer.from(jpegBytes) },
        appIcon: {}
    };
}

// 造记录 getSources 调用参数的假 desktopCapturer
function makeCapturer(byType) {
    const calls = [];
    return {
        calls,
        desktopCapturer: {
            getSources: async (opts) => {
                calls.push(opts);
                return byType[opts.types[0]] || [];
            }
        }
    };
}

test('captureScreen 命中目标窗口时返回该窗口缩略图的 base64', async () => {
    const expected = Buffer.from([1, 2, 3]).toString('base64');
    const { desktopCapturer, calls } = makeCapturer({
        window: [makeSource('other', [9]), makeSource('Notepad', [1, 2, 3])]
    });
    const result = await captureScreen({ targetTitle: 'Notepad', deps: { desktopCapturer } });
    assert.strictEqual(result, expected);
    // 命中窗口后不应再查屏幕
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].types, ['window']);
});

test('captureScreen 未命中目标窗口时回退到主屏缩略图', async () => {
    const expected = Buffer.from([7, 7]).toString('base64');
    const { desktopCapturer, calls } = makeCapturer({
        window: [makeSource('other', [9])],
        screen: [makeSource('Screen 1', [7, 7])]
    });
    const result = await captureScreen({ targetTitle: 'Missing', deps: { desktopCapturer } });
    assert.strictEqual(result, expected);
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[1].types, ['screen']);
});

test('captureScreen 无目标标题时直接截主屏', async () => {
    const expected = Buffer.from([5]).toString('base64');
    const { desktopCapturer, calls } = makeCapturer({
        screen: [makeSource('Screen 1', [5])]
    });
    const result = await captureScreen({ deps: { desktopCapturer } });
    assert.strictEqual(result, expected);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].types, ['screen']);
});

test('captureScreen 用默认缩略尺寸与质量,可被选项覆盖', async () => {
    const { desktopCapturer, calls } = makeCapturer({ screen: [makeSource('s', [1])] });
    await captureScreen({ deps: { desktopCapturer } });
    assert.deepStrictEqual(calls[0].thumbnailSize, { width: 512, height: 512 });

    const { desktopCapturer: hq, calls: hqCalls } = makeCapturer({ screen: [makeSource('s', [1])] });
    await captureScreen({ deps: { desktopCapturer: hq }, thumbnailSize: { width: 768, height: 768 } });
    assert.deepStrictEqual(hqCalls[0].thumbnailSize, { width: 768, height: 768 });
});

test('captureScreen 用传入质量调 toJPEG', async () => {
    let usedQuality = null;
    const desktopCapturer = {
        getSources: async () => [{
            name: 's',
            thumbnail: { toJPEG: (q) => { usedQuality = q; return Buffer.from([1]); } },
            appIcon: {}
        }]
    };
    await captureScreen({ deps: { desktopCapturer }, quality: 40 });
    assert.strictEqual(usedQuality, 40);
});

test('captureScreen 无屏幕源时返回 null', async () => {
    const { desktopCapturer } = makeCapturer({ screen: [] });
    const result = await captureScreen({ deps: { desktopCapturer } });
    assert.strictEqual(result, null);
});

test('captureScreen 底层抛错时吞错返回 null', async () => {
    const desktopCapturer = { getSources: async () => { throw new Error('boom'); } };
    const result = await captureScreen({ deps: { desktopCapturer } });
    assert.strictEqual(result, null);
});

test('captureScreen 返回前释放原生图像引用', async () => {
    const s = makeSource('Screen 1', [1]);
    const desktopCapturer = { getSources: async () => [s] };
    await captureScreen({ deps: { desktopCapturer } });
    assert.strictEqual(s.thumbnail, null);
    assert.strictEqual(s.appIcon, null);
});

test('idleTime 转发 powerMonitor.getSystemIdleTime', () => {
    const powerMonitor = { getSystemIdleTime: () => 42 };
    const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1, height: 1 } }) };
    const desktopCapturer = { getSources: async () => [] };
    assert.strictEqual(idleTime({ powerMonitor, screen, desktopCapturer }), 42);
});

test('screenLayout 产出主屏工作区的平直宽高', () => {
    const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1040 } }) };
    const powerMonitor = { getSystemIdleTime: () => 0 };
    const desktopCapturer = { getSources: async () => [] };
    assert.deepStrictEqual(screenLayout({ screen, powerMonitor, desktopCapturer }), { width: 1920, height: 1040 });
});
