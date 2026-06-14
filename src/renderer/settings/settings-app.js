// audience: internal
// # settings-app
// 设置面板:按领域拆分的子面板装配,以配置数据模型为真相来源而非 DOM 现场抓取。
// 不变量:真相来源是配置数据模型;读写配置经能力网关,面板不直接抓全局。

import { makeSettingsGateway } from './settings-gateway.js';
import { SettingsModel } from './settings-model.js';
import { mountApiPanel } from './api-panel.js';
import { mountModelPanel } from './model-panel.js';
import { mountModelConfigPanel } from './model-config-panel.js';
import { mountEmotionPanel, renderExpressionList, renderMotionList } from './emotion-panel.js';
import { mountCharacterPanel, loadCharacterList } from './character-panel.js';
import { mountTtsPanel } from './tts-panel.js';

export class SettingsApp {
  //// 构造注入文档根、能力 api、i18n 表、渲染适配与播音句柄 [@busybee 2026-06-13] ////
  constructor(deps = {}) {
    // 文档根经注入,使面板可在测试里换成 mock 文档。
    this.doc = deps.doc;
    this.gateway = makeSettingsGateway(deps.electronApi);
    // 翻译表与当前语言驻留本对象,语言切换时就地改写。
    this.i18n = deps.i18n || {};
    this.currentLang = 'en';
    // 渲染适配经构造注入,供后续模型预览使用,不在本层 new 第三方。
    this.renderAdapter = deps.renderAdapter || null;
    // 播音由调用方注入,把 base64 WAV 解码播放,本层不直接 new Audio。
    this.playWav = deps.playWav || (() => {});
    // 跨面板的领域回调经此注入,把面板事件接回宠物系统而不让面板抓全局。
    this.hooks = deps.hooks || {};
    this.model = null;
  }

  //// 装配入口:载入配置建模、绑定全局控件、逐领域挂载子面板 [@busybee 2026-06-13] ////
  async mount() {
    const config = await this.gateway.config.load();
    this._applyLanguage(config.uiLanguage);
    this.model = new SettingsModel(config);
    const ctx = this._panelContext();
    this._bindTabs();
    this._bindLanguageSwitch();
    this._bindPetLaunch();
    mountApiPanel(ctx);
    mountModelPanel(ctx);
    mountModelConfigPanel(ctx);
    mountEmotionPanel(ctx);
    mountTtsPanel(ctx);
    mountCharacterPanel(ctx);
    this._characterCtx = ctx;
    await loadCharacterList(ctx, ctx.characterState);
    return this.model;
  }

  //// 重新从能力网关载入配置并重建数据模型 [@busybee 2026-06-13] ////
  async load() {
    const config = await this.gateway.config.load();
    this.model = new SettingsModel(config);
    return this.model;
  }

  //// 把当前数据模型整体落盘 [@busybee 2026-06-13] ////
  async save() {
    if (!this.model) return false;
    await this.gateway.config.save(this.model.config);
    return true;
  }

  //// 翻译一个 i18n 键,缺当前语言回退英文,再缺回退键名 [@busybee 2026-06-13] ////
  t(key) {
    const table = this.i18n;
    return (table[this.currentLang] && table[this.currentLang][key])
      || (table.en && table.en[key])
      || key;
  }

  //// 把当前语言套到所有带 data-i18n 与 data-i18n-ph 的元素 [@busybee 2026-06-13] ////
  applyI18n() {
    this.doc.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = this.t(el.dataset.i18n);
    });
    this.doc.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = this.t(el.dataset.i18nPh);
    });
  }

  //// 把配置里的语言套上,缺失或未知则维持英文 [@busybee 2026-06-13] ////
  _applyLanguage(uiLanguage) {
    if (uiLanguage && this.i18n[uiLanguage]) this.currentLang = uiLanguage;
    const select = this.doc.getElementById('lang-select');
    if (select) select.value = this.currentLang;
    this.applyI18n();
  }

  //// 组装交给各子面板的上下文:数据模型、网关、翻译、状态与领域回调 [@busybee 2026-06-13] ////
  _panelContext() {
    return {
      doc: this.doc,
      model: this.model,
      gateway: this.gateway,
      t: (key) => this.t(key),
      lang: () => this.currentLang,
      showStatus: (id, message, type) => this._showStatus(id, message, type),
      playWav: this.playWav,
      onModelExpressionsChanged: () => this._refreshEmotionLists(),
      onEmotionFrequencyChanged: this.hooks.onEmotionFrequencyChanged || (() => {}),
      onEmotionConfigSaved: this.hooks.onEmotionConfigSaved || (() => {}),
      onCharacterChanged: this.hooks.onCharacterChanged || (() => {})
    };
  }

  //// 模型导入改动表情动作后,重渲情绪面板两份列表 [@busybee 2026-06-13] ////
  _refreshEmotionLists() {
    const ctx = this._panelContext();
    renderExpressionList(ctx);
    renderMotionList(ctx);
  }

  //// 显示一条状态,非常驻类型几秒后自动清除 [@busybee 2026-06-13] ////
  _showStatus(id, message, type) {
    const el = this.doc.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = `status ${type}`;
    if (type !== 'info') {
      const handle = setTimeout(() => { el.className = 'status'; }, 5000);
      // 有 unref 则调用使定时器不阻塞退出,无则跳过。
      if (handle && typeof handle.unref === 'function') handle.unref();
    }
  }

  //// 绑定标签页切换:激活态在按钮与内容间同步,进 prompt 页时重载角色列表 [@busybee 2026-06-13] ////
  _bindTabs() {
    this.doc.querySelectorAll('.tab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        this.doc.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        this.doc.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        button.classList.add('active');
        this.doc.getElementById('tab-' + button.dataset.tab).classList.add('active');
        if (button.dataset.tab === 'prompt' && this._characterCtx) {
          loadCharacterList(this._characterCtx, this._characterCtx.characterState);
        }
      });
    });
  }

  //// 绑定启动器:点启动宠物经网关建窗,点关闭宠物经网关停宠物 [@busybee 2026-06-14] ////
  // 启动后设置窗口由主进程收起;关闭后主进程把设置窗口重新显示。
  _bindPetLaunch() {
    const launch = this.doc.getElementById('btn-launch-pet');
    const close = this.doc.getElementById('btn-close-pet');
    if (launch) launch.addEventListener('click', async () => { await this.gateway.pet.launch(); });
    if (close) close.addEventListener('click', async () => { await this.gateway.pet.close(); });
  }
  //// /绑定启动器 ////

  //// 绑定语言下拉:切换语言、套 i18n、落盘并经回调重载角色卡与宠物 prompt [@busybee 2026-06-13] ////
  _bindLanguageSwitch() {
    const select = this.doc.getElementById('lang-select');
    if (!select) return;
    select.addEventListener('change', async (e) => {
      this.currentLang = e.target.value;
      this.applyI18n();
      await this.gateway.config.save({ uiLanguage: this.currentLang });
      // 模型路由面板的文案是动态构建的、不走 applyI18n,语言切换时按新语言重渲
      if (this._characterCtx && this._characterCtx.reRenderModelConfig) {
        this._characterCtx.reRenderModelConfig();
      }
      if (this._characterCtx) {
        await this._characterCtx.reloadCharacterPrompt();
        await this._characterCtx.reloadCharacterList();
      }
      if (this.hooks.onLanguageChanged) await this.hooks.onLanguageChanged(this.currentLang);
    });
  }
}
