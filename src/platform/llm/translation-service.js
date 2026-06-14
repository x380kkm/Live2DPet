// audience: internal
// # translation-service
// 中译日翻译服务:把中文文本译为自然日语,供 VOICEVOX 合成前调用。
// 不变量:翻译只经注入的 llm 客户端发起,本文件不直接碰供应商 SDK 与网络;译文缓存用 LRU 上限固定。
//
// 构造注入:llmClient 提供 complete(request) -> { text },deps 可选给定 cacheMaxSize。
// 译文按原文键缓存,缓存满则淘汰最早写入的一条;禁用、无客户端、调用失败时原样返回输入。

// 翻译用的少样本提示:中译日的少样本示例对
const TRANSLATE_SYSTEM_PROMPT =
  'あなたは翻訳機です。入力文を自然な日本語の完全な文に翻訳してください。' +
  '英単語はカタカナに変換（例: YouTube→ユーチューブ、Discord→ディスコード）。' +
  '翻訳結果の文だけを出力。説明・補足・比較・単語リスト・ローマ字は不要。' +
  '出力にアルファベットを含めないこと。口調と感情を保持。';
const TRANSLATE_EXAMPLE_INPUT = '哇，今天YouTube上有好多有趣的视频！';
const TRANSLATE_EXAMPLE_OUTPUT = 'わあ、今日ユーチューブに面白い動画がいっぱいあった！';

const { StepId } = require('../../shared/step-catalog');

// 默认译文缓存条数上限
const DEFAULT_CACHE_MAX_SIZE = 50;

//// 经注入的 llm 客户端把文本译为日语、带 LRU 缓存与可禁用开关的翻译服务 [@busybee 2026-06-13] ////
class TranslationService {
  constructor({ llmClient = null, cacheMaxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
    this.llmClient = llmClient;
    this.enabled = true;
    this.cache = new Map();
    this.cacheMaxSize = cacheMaxSize;
  }

  //// 替换底层 llm 客户端,翻译端点变更时由外部重新注入 [@busybee 2026-06-13] ////
  setClient(llmClient) {
    this.llmClient = llmClient;
  }

  //// 有可用客户端即视为已就绪,可发起翻译 [@busybee 2026-06-13] ////
  isConfigured() {
    return !!this.llmClient;
  }

  //// 把文本译为日语:禁用、未就绪、失败时原样返回,命中缓存直接返回 [@busybee 2026-06-13] ////
  async translate(text) {
    if (!text || !this.enabled) return text;
    if (!this.isConfigured()) return text;
    if (this.cache.has(text)) return this.cache.get(text);

    try {
      const result = await this._requestTranslation(text);
      if (result) {
        this._cacheSet(text, result);
        return result;
      }
      return text;
    } catch (err) {
      console.error('[Translation] Failed:', err.message);
      return text;
    }
  }

  //// 经 llm 客户端发起一次翻译补全,清理译文中的标记字符与多余空白 [@busybee 2026-06-13] ////
  async _requestTranslation(text) {
    const response = await this.llmClient.complete({
      // 翻译步:交模型路由按 translate 步配置(默认温度 0.3),温度与 token 由配置
      step: StepId.Translate,
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
        { role: 'user', content: TRANSLATE_EXAMPLE_INPUT },
        { role: 'assistant', content: TRANSLATE_EXAMPLE_OUTPUT },
        { role: 'user', content: text }
      ]
    });

    const raw = response && response.text;
    if (!raw) return null;
    return raw
      .replace(/[*_`#\[\]]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  //// 写入译文缓存,超出上限时淘汰最早写入的一条 [@busybee 2026-06-13] ////
  _cacheSet(key, value) {
    if (this.cache.size >= this.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  //// 清空译文缓存 [@busybee 2026-06-13] ////
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { TranslationService };
