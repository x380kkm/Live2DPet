// audience: internal
// # language-state
// 当前界面语言的显式载体,并据当前语言查表翻译。
// 不变量:语言代码与翻译表都从构造时注入的表取,本文件不直接 require 表;
// 缺失的语言或键逐级回退,mt 永不抛错。
//
// 构造注入:table 形如 { en: { key: text }, zh: {...}, ja: {...} };
// fallbackLang 给定回退语言(默认 en);mt(key) 查当前语言、回退 fallbackLang、再回退原 key。

const I18N = require('../../i18n/locales');

// 缺省回退语言:任一语言缺该键时退到此语言
const DEFAULT_FALLBACK_LANG = 'en';

//// 持有当前语言并据其查表翻译的载体,缺失逐级回退 [@busybee 2026-06-13] ////
class LanguageState {
  constructor({ table = I18N, lang = DEFAULT_FALLBACK_LANG, fallbackLang = DEFAULT_FALLBACK_LANG } = {}) {
    this.table = table;
    this.lang = lang;
    this.fallbackLang = fallbackLang;
  }

  //// 读取当前语言代码 [@busybee 2026-06-13] ////
  get() {
    return this.lang;
  }

  //// 设置当前语言代码 [@busybee 2026-06-13] ////
  set(lang) {
    if (lang) this.lang = lang;
  }

  //// 查当前语言译文,缺则回退语言,再缺则返回原 key [@busybee 2026-06-13] ////
  mt(key) {
    const current = this.table[this.lang];
    if (current && current[key] !== undefined) return current[key];
    const fallback = this.table[this.fallbackLang];
    if (fallback && fallback[key] !== undefined) return fallback[key];
    return key;
  }
}

module.exports = { LanguageState };
