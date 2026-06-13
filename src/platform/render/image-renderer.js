// audience: internal
// # image-renderer
// RenderAdapter 的图片实现:默认走 Live2D 时不加载;分帧与口型为可选后置增强。
// 不变量:与 Live2D 实现共用同一套语义动作名,不引入任何 Live2D 或 Cubism 类型;
// 图片元素与配置经构造注入,本文件不抓任何全局。

import { RenderAdapter } from './model-renderer.js';

export class ImageRenderer extends RenderAdapter {
  //// 经构造注入接收图片元素与配置,建好分帧池,不抓全局 [@busybee 2026-06-13] ////
  // deps:{ imageElement, config }。imageElement 为页面里的 <img>,由组合根取好后注入。
  constructor(deps) {
    super();
    this.imageElement = deps.imageElement;
    this.config = deps.config || {};

    this.idleImages = [];
    this.talkingImages = [];
    this.emotionImages = {};
    this.isTalking = false;
    this.currentEmotion = null;

    this.folderMode = !!(this.config.imageFolderPath && this.config.imageFiles);
    if (this.folderMode) {
      this._buildPools();
      this._updateDisplay();
    }
  }

  //// 把配置的图片文件按用途分进空闲、说话、情绪三类池 [@busybee 2026-06-13] ////
  _buildPools() {
    this.idleImages = [];
    this.talkingImages = [];
    this.emotionImages = {};
    for (const f of this.config.imageFiles || []) {
      if (f.idle) this.idleImages.push(f.file);
      if (f.talking) this.talkingImages.push(f.file);
      if (f.emotionName) {
        if (!this.emotionImages[f.emotionName]) this.emotionImages[f.emotionName] = [];
        this.emotionImages[f.emotionName].push(f.file);
      }
    }
  }

  //// 按情绪、说话、空闲的优先级选当前应显示的池并刷新一帧 [@busybee 2026-06-13] ////
  _updateDisplay() {
    if (!this.folderMode) return;
    if (this.currentEmotion && this.emotionImages[this.currentEmotion]) {
      this._showRandom(this.emotionImages[this.currentEmotion]);
    } else if (this.isTalking && this.talkingImages.length > 0) {
      this._showRandom(this.talkingImages);
    } else if (this.idleImages.length > 0) {
      this._showRandom(this.idleImages);
    }
  }

  //// 从一个池里随机取一帧,拼成 file:// 地址写进图片元素 [@busybee 2026-06-13] ////
  _showRandom(pool) {
    if (!pool || pool.length === 0 || !this.imageElement) return;
    const file = pool[Math.floor(Math.random() * pool.length)];
    const folderPath = this.config.imageFolderPath.replace(/\\/g, '/');
    this.imageElement.src = 'file:///' + folderPath + '/' + encodeURIComponent(file);
  }

  //// 按语义动作名切换图片帧:分帧模式选情绪池,旧模式查 GIF 表 [@busybee 2026-06-13] ////
  playAction(name) {
    if (this.folderMode) {
      this.currentEmotion = name;
      this._updateDisplay();
      return;
    }
    const gifMap = this.config.gifExpressions || {};
    if (gifMap[name] && this.imageElement) {
      this.imageElement.src = gifMap[name];
    }
  }

  //// 清除当前情绪、回到说话或空闲的常态帧 [@busybee 2026-06-13] ////
  revertAction() {
    if (this.folderMode) {
      this.currentEmotion = null;
      this._updateDisplay();
      return;
    }
    if (this.imageElement && this.config.staticImagePath) {
      this.imageElement.src = this.config.staticImagePath;
    }
  }

  //// 外部告知说话状态变化,空闲与说话帧据此切换 [@busybee 2026-06-13] ////
  // 取代旧实现里对 window.electronAPI 的全局订阅,改为由调用方显式喂入。
  setTalking(isTalking) {
    this.isTalking = isTalking;
    if (!this.currentEmotion) this._updateDisplay();
  }

  //// 设置口型开合度:分帧口型为后置增强,当前不动帧 [@busybee 2026-06-13] ////
  setMouth(openness) {
    // 现阶段保持现有静图切换行为,口型分帧待后置增强接入。
  }

  //// 命中测试:图片模式无交互区,恒返回空 [@busybee 2026-06-13] ////
  hitTest(point) {
    return null;
  }

  //// 清空图片元素并隐藏,释放图片资源 [@busybee 2026-06-13] ////
  dispose() {
    if (this.imageElement) {
      this.imageElement.src = '';
      this.imageElement.style.display = 'none';
    }
  }
}
