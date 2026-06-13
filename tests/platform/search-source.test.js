// 用注入的假 http 断言 search-source 的行为契约:查询清洗、DDG 解析、自定义端点、错误折叠。
const { test } = require('node:test');
const assert = require('node:assert');
const { createSearchSource } = require('../../src/platform/electron/search-source');

// 造一个按 url 返回给定状态与响应体的假 http 模块;记录请求过的 url
function makeHttp(responder) {
  const requested = [];
  const http = {
    get(url, options, cb) {
      requested.push(url);
      const { status, data } = responder(url);
      const res = {
        statusCode: status,
        on(event, fn) {
          if (event === 'data') fn(data);
          if (event === 'end') fn();
        }
      };
      cb(res);
      return { on() {} };
    }
  };
  return { http, requested };
}

test('search 拒绝空查询', async () => {
  const { http } = makeHttp(() => ({ status: 200, data: '' }));
  const src = createSearchSource({ http, https: http });
  assert.deepStrictEqual(await src.search('', 'duckduckgo'), { success: false, error: 'empty_query' });
});

test('search 清洗查询里的长串疑似密钥后若为空也拒绝', async () => {
  const { http } = makeHttp(() => ({ status: 200, data: '' }));
  const src = createSearchSource({ http, https: http });
  const result = await src.search('abcdefghijklmnopqrstuvwxyz1234', 'duckduckgo');
  assert.deepStrictEqual(result, { success: false, error: 'empty_query' });
});

test('search 对未知提供方返回失败', async () => {
  const { http } = makeHttp(() => ({ status: 200, data: '' }));
  const src = createSearchSource({ http, https: http });
  assert.deepStrictEqual(await src.search('cats', 'bing'), { success: false, error: 'unknown_provider' });
});

test('duckduckgo 解析出摘要片段并以竖线拼接', async () => {
  const html = '<div class="result__snippet">A cat is a small mammal.</div>' +
               '<div class="result__snippet">Cats are popular pets worldwide.</div>';
  const { http, requested } = makeHttp(() => ({ status: 200, data: html }));
  const src = createSearchSource({ http, https: http });
  const result = await src.search('cats', 'duckduckgo');
  assert.deepStrictEqual(result, { success: true, results: 'A cat is a small mammal. | Cats are popular pets worldwide.' });
  assert.match(requested[0], /html\.duckduckgo\.com/);
});

test('duckduckgo 无摘要时回退到链接文本', async () => {
  const html = '<a class="result__a" href="x">Wikipedia Cats</a>';
  const { http } = makeHttp(() => ({ status: 200, data: html }));
  const src = createSearchSource({ http, https: http });
  const result = await src.search('cats', 'duckduckgo');
  assert.deepStrictEqual(result, { success: true, results: 'Wikipedia Cats' });
});

test('duckduckgo 解析不出片段时折成失败', async () => {
  const { http } = makeHttp(() => ({ status: 200, data: '<div>nothing useful</div>' }));
  const src = createSearchSource({ http, https: http });
  assert.deepStrictEqual(await src.search('cats', 'duckduckgo'), { success: false, error: 'parse_failed' });
});

test('duckduckgo 非 200 状态折成 HTTP 错误', async () => {
  const { http } = makeHttp(() => ({ status: 503, data: '' }));
  const src = createSearchSource({ http, https: http });
  assert.deepStrictEqual(await src.search('cats', 'duckduckgo'), { success: false, error: 'HTTP 503' });
});

test('custom 端点从 webPages.value 取片段', async () => {
  const json = JSON.stringify({ webPages: { value: [
    { snippet: 'First snippet about the topic.' },
    { snippet: 'Second snippet about the topic.' }
  ] } });
  const { http, requested } = makeHttp(() => ({ status: 200, data: json }));
  const src = createSearchSource({ http, https: http });
  const result = await src.search('topic', 'custom', { customUrl: 'https://api.example/search' });
  assert.deepStrictEqual(result, { success: true, results: 'First snippet about the topic. | Second snippet about the topic.' });
  assert.match(requested[0], /q=topic/);
});

test('custom 端点无可用片段时回退到 abstract', async () => {
  const json = JSON.stringify({ abstract: 'A short abstract.' });
  const { http } = makeHttp(() => ({ status: 200, data: json }));
  const src = createSearchSource({ http, https: http });
  const result = await src.search('topic', 'custom', { customUrl: 'https://api.example/search' });
  assert.deepStrictEqual(result, { success: true, results: 'A short abstract.' });
});

test('custom 端点响应非 JSON 时回退取原文片段', async () => {
  const { http } = makeHttp(() => ({ status: 200, data: 'plain text body' }));
  const src = createSearchSource({ http, https: http });
  const result = await src.search('topic', 'custom', { customUrl: 'https://api.example/search' });
  assert.deepStrictEqual(result, { success: true, results: 'plain text body' });
});
