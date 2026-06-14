// audience: internal
// # search-source
// 把网络搜索(DuckDuckGo HTML 抓取与自定义 JSON 端点)包成自有的查询接口。
// 不变量:第三方 http、https 与 URL 解析类型不越过本文件;查询产物折成 { success, results|error } 平直数据。
//
// 本接口封掉网络类型,处理器只经能力网关调它。
//
// 依赖经构造注入:http、https 为 Node 网络模块;userAgent 为外发请求的 UA 标识。

// 最多保留的搜索片段条数与单片段最短可信长度。
const MAX_RESULTS = 3;
const MIN_SNIPPET_LENGTH = 10;

//// 装配网络模块,产出按提供方分派的搜索查询 [@busybee 2026-06-13] ////
function createSearchSource(deps = {}) {
  const http = deps.http;
  const https = deps.https;
  const userAgent = deps.userAgent || 'Live2DPet/2.0.0';

  //// 发起一次 GET 并把响应体收齐,超时与错误折成 reject [@busybee 2026-06-13] ////
  function httpGet(url, timeout, extraHeaders) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const headers = { 'User-Agent': userAgent, ...(extraHeaders || {}) };
      const req = mod.get(url, { timeout: timeout || 10000, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    });
  }
  //// /发起一次 GET 并把响应体收齐 ////

  //// 从 DuckDuckGo 的 HTML 抓取里提取若干文本片段,先取摘要再回退取链接文本 [@busybee 2026-06-13] ////
  function parseDuckDuckGo(html) {
    const results = [];
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\//gi;
    let match;
    while ((match = snippetRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > MIN_SNIPPET_LENGTH) results.push(text);
    }
    if (results.length > 0) return results.join(' | ');
    const linkRegex = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 5) results.push(text);
    }
    return results.length > 0 ? results.join(' | ') : null;
  }
  //// /从 DuckDuckGo 的 HTML 抓取里提取若干文本片段 ////

  //// 抓自定义 JSON 端点:拼查询参数、带可选鉴权,从常见字段挑片段,失败回退取原文片段 [@busybee 2026-06-13] ////
  async function searchCustom(query, options) {
    const url = new URL(options.customUrl);
    url.searchParams.set('q', query);
    const headers = {};
    if (options.customApiKey) headers['Authorization'] = `Bearer ${options.customApiKey}`;
    if (options.customHeaders) Object.assign(headers, options.customHeaders);

    const result = await httpGet(url.toString(), 10000, headers);
    if (result.status !== 200) return { success: false, error: `HTTP ${result.status}` };
    try {
      const json = JSON.parse(result.data);
      const pages = (json.webPages && json.webPages.value) || json.results || [];
      const snippets = pages
        .slice(0, MAX_RESULTS)
        .map((p) => p.snippet || p.content || p.description || p.name || '')
        .filter((s) => s.length > MIN_SNIPPET_LENGTH);
      if (snippets.length > 0) return { success: true, results: snippets.join(' | ') };
      const fallback = json.abstract || JSON.stringify(json).slice(0, 300);
      return { success: true, results: fallback };
    } catch {
      return { success: true, results: result.data.slice(0, 300) };
    }
  }
  //// /抓自定义 JSON 端点 ////

  //// 抓 DuckDuckGo:编码查询、抓 HTML、解析片段,解析不出折成失败 [@busybee 2026-06-13] ////
  async function searchDuckDuckGo(query) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const result = await httpGet(url);
    if (result.status !== 200) return { success: false, error: `HTTP ${result.status}` };
    const parsed = parseDuckDuckGo(result.data);
    if (!parsed) return { success: false, error: 'parse_failed' };
    return { success: true, results: parsed };
  }
  //// /抓 DuckDuckGo ////

  //// 按提供方分派搜索:先清洗查询里的长串疑似密钥,空查询直接拒 [@busybee 2026-06-13] ////
  async function search(query, provider, options) {
    const opts = options || {};
    try {
      const cleaned = (query || '').replace(/[A-Za-z0-9_-]{20,}/g, '').trim();
      if (!cleaned) return { success: false, error: 'empty_query' };
      if (provider === 'custom' && opts.customUrl) return searchCustom(cleaned, opts);
      if (provider === 'duckduckgo') return searchDuckDuckGo(cleaned);
      return { success: false, error: 'unknown_provider' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  //// /按提供方分派搜索 ////

  return { search };
}
//// /装配网络模块 ////

module.exports = { createSearchSource };
