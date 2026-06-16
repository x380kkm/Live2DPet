// audience: internal
// # segmentation-fix-service
// 分词纠错服务:词典分词偶尔把一个专名或成语切成几段(市女笠、大如巨象),这里只让 LLM 把切错的相邻词合并,不改其它。
// 韵律分句仍由确定性算法做;LLM 只修词边界、不碰停顿,既补上词典的盲点,又不让停顿回到大模型凭感觉。
// 不变量:只经注入的 llm 客户端发起;禁用、无客户端、失败时原样返回分词;结果按原文键缓存,LRU 上限固定。

const { parseMerges, applyMerges } = require('../../domain/tts/word-segmenter');

// 系统提示:只合并被切错的相邻词,不拆分、不改字、不动其它。返回 JSON 的合并下标区间。
const SEG_FIX_SYSTEM_PROMPT =
  '你是中文分词校对器。下面给一句话和它的分词(每词带下标)。只把本该是一个词、却被切成相邻几段的合并起来——' +
  '主要是专有名词、成语、固定搭配。不要拆分任何词,不要改动任何字,不要合并本就该分开的词。' +
  '只输出 JSON:{"merges":[[起始下标,结束下标],...]},下标含两端、指要并成一个词的相邻词。没有要合并的就输出 {"merges":[]}。';
const SEG_FIX_EXAMPLE_INPUT = '词:0=头戴 1=巨大 2=市 3=女笠';
const SEG_FIX_EXAMPLE_OUTPUT = '{"merges":[[2,3]]}';

const DEFAULT_CACHE_MAX_SIZE = 100;

//// 经注入的 llm 客户端只合并切错的相邻词、带 LRU 缓存与可禁用开关的分词纠错服务 [@x380kkm 2026-06-17] ////
class SegmentationFixService {
  constructor({ llmClient = null, cacheMaxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
    this.llmClient = llmClient;
    this.enabled = true;
    this.cache = new Map();
    this.cacheMaxSize = cacheMaxSize;
  }

  //// 替换底层 llm 客户端,端点变更时由外部重新注入 [@x380kkm 2026-06-17] ////
  setClient(llmClient) {
    this.llmClient = llmClient;
  }

  //// 有可用客户端即视为已就绪 [@x380kkm 2026-06-17] ////
  isConfigured() {
    return !!this.llmClient;
  }

  //// 校对一句的分词:禁用、未就绪、失败时原样返回 units,命中缓存直接返回 [@x380kkm 2026-06-17] ////
  // units 是 word-segmenter 切出的词与标点单元;返回合并切错词后的同形数组。
  async fix(text, units) {
    if (!units || !units.length || !this.enabled || !this.isConfigured()) return units;
    const key = (text != null ? text : units.map((u) => u.word || u.punct).join('')) ;
    if (this.cache.has(key)) return applyMerges(units, this.cache.get(key));

    try {
      const merges = await this._requestMerges(units);
      this._cacheSet(key, merges);
      return applyMerges(units, merges);
    } catch (err) {
      console.error('[SegFix] Failed:', err.message);
      return units;
    }
  }

  //// 经 llm 客户端发起一次分词校对,返回合并下标区间数组 [@x380kkm 2026-06-17] ////
  async _requestMerges(units) {
    // 只把词单元编号给模型(标点不参与合并),编号即在 units 数组里的下标。
    const listing = units.map((u, i) => (u.word != null ? `${i}=${u.word}` : null)).filter(Boolean).join(' ');
    const response = await this.llmClient.complete({
      messages: [
        { role: 'system', content: SEG_FIX_SYSTEM_PROMPT },
        { role: 'user', content: SEG_FIX_EXAMPLE_INPUT },
        { role: 'assistant', content: SEG_FIX_EXAMPLE_OUTPUT },
        { role: 'user', content: `词:${listing}` }
      ]
    });
    return parseMerges(response && response.text);
  }

  //// 写入缓存,超上限淘汰最早一条 [@x380kkm 2026-06-17] ////
  _cacheSet(key, value) {
    if (this.cache.size >= this.cacheMaxSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }

  //// 清空缓存 [@x380kkm 2026-06-17] ////
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { SegmentationFixService };
