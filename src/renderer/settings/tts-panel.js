// audience: internal
// # tts-panel
// TTS 标签页子面板:引擎状态、说话人与样式、语速音高音量、音频模式、默认音声、VVM 勾选。
// 不变量:说话人元数据与 VVM 勾选态由能力网关取得,经纯逻辑算出视图;保存只发 tts 段补丁不触发整表重载。

import { availableVvmState, resolveStyleSelection, VVM_CHARACTERS } from './settings-model.js';

//// 装配 TTS 面板:载入状态、绑定滑块与各保存按钮 [@x380kkm 2026-06-13] ////
export function mountTtsPanel(ctx) {
  const { doc } = ctx;
  // 说话人元数据缓存,样式联动下拉据此构建。
  const state = { metas: [] };

  ['tts-speed', 'tts-pitch', 'tts-volume'].forEach((id) => {
    const slider = doc.getElementById(id);
    if (slider) slider.addEventListener('input', () => {
      doc.getElementById(`${id}-val`).textContent = slider.value;
    });
  });

  doc.getElementById('btn-save-tts').addEventListener('click', () => saveTts(ctx));
  doc.getElementById('btn-test-tts').addEventListener('click', () => testTts(ctx));
  bindOptional(doc, 'btn-restart-tts', () => restartTts(ctx, state));
  bindOptional(doc, 'btn-setup-voicevox', () => setupVoicevox(ctx, state));
  bindOptional(doc, 'btn-generate-default-audio', () => generateDefaultAudio(ctx));
  bindOptional(doc, 'btn-save-vvm', () => saveVvm(ctx));

  loadStatus(ctx, state);
  loadDefaultPhrases(ctx);
  loadVvm(ctx);
}

//// 给可能不存在的按钮绑定点击,缺失则跳过 [@x380kkm 2026-06-13] ////
function bindOptional(doc, id, handler) {
  const button = doc.getElementById(id);
  if (button) button.addEventListener('click', handler);
}

//// 载入引擎状态:就绪、熔断倒计时或离线,并据状态填充说话人与配置 [@x380kkm 2026-06-13] ////
async function loadStatus(ctx, state) {
  const { doc, gateway, t } = ctx;
  if (!gateway.tts.status) return;
  const status = await gateway.tts.status();
  const statusEl = doc.getElementById('tts-status');
  const restartBtn = doc.getElementById('btn-restart-tts');
  if (status.initialized) {
    if (status.degraded) {
      const elapsed = Date.now() - status.degradedAt;
      const remaining = Math.max(0, Math.ceil((status.retryInterval - elapsed) / 1000));
      statusEl.textContent = t('tts.circuitBreak').replace('{0}', remaining);
      statusEl.className = 'status error';
      restartBtn.style.display = '';
    } else {
      statusEl.textContent = t('tts.ready') + (status.gpuMode ? t('tts.readyGpu') : t('tts.readyCpu'));
      statusEl.className = 'status success';
      restartBtn.style.display = 'none';
    }
    doc.getElementById('tts-hint').style.display = 'none';
    state.metas = await gateway.tts.metas();
    populateSpeakers(ctx, state);
  } else {
    statusEl.textContent = t('tts.offline');
    statusEl.className = 'status error';
    restartBtn.style.display = '';
  }
  await applySavedTtsConfig(ctx, state);
}

//// 把保存过的 tts 配置还原到面板控件 [@x380kkm 2026-06-13] ////
async function applySavedTtsConfig(ctx, state) {
  const { doc, gateway } = ctx;
  const config = await gateway.config.load();
  const tts = config.tts;
  if (!tts) return;
  setSliderValue(doc, 'tts-speed', tts.speedScale, 1.0);
  setSliderValue(doc, 'tts-pitch', tts.pitchScale, 0.0);
  setSliderValue(doc, 'tts-volume', tts.volumeScale, 1.0);
  const modeRadio = doc.querySelector(`input[name="audio-mode"][value="${tts.audioMode || 'tts'}"]`);
  if (modeRadio) modeRadio.checked = true;
  if (tts.styleId !== undefined) selectStyle(ctx, state, tts.styleId);
  const gpuCheckbox = doc.getElementById('tts-gpu-mode');
  if (gpuCheckbox) gpuCheckbox.checked = tts.gpuMode || false;
  const toneCheckbox = doc.getElementById('tts-tone-control');
  if (toneCheckbox) toneCheckbox.checked = tts.toneControl || false;
}

//// 设置一个滑块的值与其旁标 [@x380kkm 2026-06-13] ////
function setSliderValue(doc, id, value, fallback) {
  const resolved = value != null ? value : fallback;
  doc.getElementById(id).value = resolved;
  doc.getElementById(`${id}-val`).textContent = resolved;
}

//// 用说话人元数据填充说话人下拉,联动样式下拉 [@x380kkm 2026-06-13] ////
function populateSpeakers(ctx, state) {
  const { doc } = ctx;
  const speakerSelect = doc.getElementById('tts-speaker');
  speakerSelect.innerHTML = '';
  state.metas.forEach((speaker, index) => {
    const option = doc.createElement('option');
    option.value = index;
    option.textContent = speaker.name;
    speakerSelect.appendChild(option);
  });
  speakerSelect.addEventListener('change', () => populateStyles(ctx, state, parseInt(speakerSelect.value)));
  if (state.metas.length > 0) populateStyles(ctx, state, 0);
}

//// 用某说话人的样式列表填充样式下拉 [@x380kkm 2026-06-13] ////
function populateStyles(ctx, state, speakerIndex) {
  const { doc } = ctx;
  const styleSelect = doc.getElementById('tts-style-id');
  styleSelect.innerHTML = '';
  const speaker = state.metas[speakerIndex];
  if (!speaker) return;
  speaker.styles.forEach((style) => {
    const option = doc.createElement('option');
    option.value = style.id;
    option.textContent = style.name;
    styleSelect.appendChild(option);
  });
}

//// 按 styleId 在元数据里定位说话人并选中对应样式 [@x380kkm 2026-06-13] ////
function selectStyle(ctx, state, styleId) {
  const { doc } = ctx;
  const { speakerIndex, styleId: resolvedId } = resolveStyleSelection(state.metas, styleId);
  if (resolvedId == null) return;
  doc.getElementById('tts-speaker').value = speakerIndex;
  populateStyles(ctx, state, speakerIndex);
  doc.getElementById('tts-style-id').value = resolvedId;
}

//// 保存说话人样式与三项参数,以及音频模式与 GPU 开关 [@x380kkm 2026-06-13] ////
async function saveTts(ctx) {
  const { doc, gateway, t, showStatus } = ctx;
  const ttsConfig = {
    styleId: parseInt(doc.getElementById('tts-style-id').value),
    speedScale: parseFloat(doc.getElementById('tts-speed').value),
    pitchScale: parseFloat(doc.getElementById('tts-pitch').value),
    volumeScale: parseFloat(doc.getElementById('tts-volume').value),
    toneControl: (doc.getElementById('tts-tone-control') || {}).checked || false
  };
  await gateway.tts.setConfig(ttsConfig);
  const audioMode = (doc.querySelector('input[name="audio-mode"]:checked') || {}).value || 'tts';
  await gateway.config.save({
    tts: {
      audioMode,
      styleId: ttsConfig.styleId,
      speedScale: ttsConfig.speedScale,
      pitchScale: ttsConfig.pitchScale,
      volumeScale: ttsConfig.volumeScale,
      gpuMode: (doc.getElementById('tts-gpu-mode') || {}).checked || false,
      toneControl: ttsConfig.toneControl
    }
  });
  showStatus('tts-save-status', t('status.saved'), 'success');
}

//// 合成测试文本并播放,展示译出的日文 [@x380kkm 2026-06-13] ////
async function testTts(ctx) {
  const { doc, gateway, t, showStatus, playWav } = ctx;
  const text = doc.getElementById('tts-test-text').value.trim();
  if (!text) return;
  showStatus('tts-test-status', t('tts.synthesizing'), '');
  const result = await gateway.tts.synthesize(text);
  if (result.success) {
    showStatus('tts-test-status', t('tts.translated') + result.jaText, 'success');
    playWav(result.wav);
  } else {
    showStatus('tts-test-status', t('tts.synthFailed') + result.error, 'error');
  }
}

//// 重启引擎并刷新状态 [@x380kkm 2026-06-13] ////
async function restartTts(ctx, state) {
  const { doc, gateway, t } = ctx;
  const statusEl = doc.getElementById('tts-status');
  statusEl.textContent = t('tts.restarting');
  statusEl.className = 'status';
  const result = await gateway.tts.restart();
  if (result.success) {
    await loadStatus(ctx, state);
  } else {
    statusEl.textContent = t('tts.restartFailed') + (result.error || t('tts.unknownError'));
    statusEl.className = 'status error';
  }
}

//// 一键安装 VOICEVOX,装毕自动重启引擎 [@x380kkm 2026-06-13] ////
async function setupVoicevox(ctx, state) {
  const { doc, gateway, t } = ctx;
  const button = doc.getElementById('btn-setup-voicevox');
  const statusEl = doc.getElementById('voicevox-setup-status');
  button.disabled = true;
  button.textContent = t('tts.installing');
  statusEl.textContent = t('tts.preparing');
  statusEl.className = 'status';
  gateway.tts.onSetupProgress((message) => { statusEl.textContent = message; });
  const result = await gateway.tts.setupVoicevox();
  button.disabled = false;
  button.textContent = t('tts.setup');
  if (result.success) {
    statusEl.textContent = t('tts.installDone');
    statusEl.className = 'status success';
    const restart = await gateway.tts.restart();
    if (restart.success) {
      await loadStatus(ctx, state);
      statusEl.textContent = t('tts.installDoneTts');
    }
  } else {
    statusEl.textContent = t('tts.installFail') + result.error;
    statusEl.className = 'status error';
  }
}

//// 由短语列表与当前样式批量生成默认音声 [@x380kkm 2026-06-13] ////
async function generateDefaultAudio(ctx) {
  const { doc, gateway, t, showStatus } = ctx;
  const phrases = doc.getElementById('default-audio-phrases').value
    .split('\n').map((s) => s.trim()).filter(Boolean);
  if (phrases.length === 0) {
    showStatus('default-audio-status', t('tts.enterPhrase'), 'error');
    return;
  }
  const styleId = parseInt(doc.getElementById('tts-style-id').value) || 0;
  showStatus('default-audio-status', t('tts.generating').replace('{0}', phrases.length), '');
  const result = await gateway.tts.generateDefaultAudio(phrases, styleId);
  if (result.success) {
    const ok = result.results.filter((r) => r.success).length;
    showStatus('default-audio-status',
      t('tts.generateDone').replace('{0}', ok).replace('{1}', phrases.length), 'success');
  } else {
    showStatus('default-audio-status', t('status.failed') + result.error, 'error');
  }
}

//// 把保存过的默认短语载入文本域 [@x380kkm 2026-06-13] ////
async function loadDefaultPhrases(ctx) {
  const { doc, gateway } = ctx;
  const config = await gateway.config.load();
  const phrases = config && config.tts && config.tts.defaultPhrases;
  const textarea = doc.getElementById('default-audio-phrases');
  if (phrases && textarea) textarea.value = phrases.join('\n');
}

//// 按磁盘可用与已载列表渲染 VVM 勾选项,缺失项给下载按钮 [@x380kkm 2026-06-13] ////
async function loadVvm(ctx) {
  const { doc, gateway, t } = ctx;
  if (!gateway.tts.availableVvms) return;
  const available = await gateway.tts.availableVvms();
  const config = await gateway.config.load();
  const loaded = (config.tts && config.tts.vvmFiles) || ['0.vvm'];
  const container = doc.getElementById('vvm-checkboxes');
  if (!container) return;
  const states = availableVvmState(available, loaded);
  container.innerHTML = states.map((vvm) => {
    const downloadButton = vvm.onDisk
      ? '<span style="color:#4a4;font-size:11px;">OK</span>'
      : `<button class="btn-dl-vvm" data-vvm="${vvm.file}" style="font-size:11px;padding:1px 6px;cursor:pointer;">${t('tts.vvm.dl')}</button>`;
    return `<label style="display:flex;align-items:center;gap:4px;padding:2px 0;font-size:12px;">
      <input type="checkbox" value="${vvm.file}" ${vvm.checked ? 'checked' : ''} ${vvm.disabled ? 'disabled' : ''}>
      <b>${vvm.file}</b> ${vvm.description} ${downloadButton}
    </label>`;
  }).join('');
  container.querySelectorAll('.btn-dl-vvm').forEach((button) => {
    button.addEventListener('click', (e) => downloadVvm(ctx, e, button));
  });
}

//// 下载一个 VVM,毕则加入配置、重渲染并重启引擎 [@x380kkm 2026-06-13] ////
async function downloadVvm(ctx, event, button) {
  const { gateway, t, showStatus } = ctx;
  event.preventDefault();
  const vvm = button.dataset.vvm;
  button.textContent = '...';
  button.disabled = true;
  const result = await gateway.tts.downloadVvm(vvm);
  if (result.success) {
    const config = await gateway.config.load();
    const vvmFiles = (config.tts && config.tts.vvmFiles) || ['0.vvm'];
    if (!vvmFiles.includes(vvm)) {
      vvmFiles.push(vvm);
      await gateway.config.save({ tts: { vvmFiles } });
    }
    await loadVvm(ctx);
    await gateway.tts.restart();
    showStatus('vvm-save-status', t('tts.vvm.saved'), 'success');
  } else {
    button.textContent = t('status.failed');
    showStatus('vvm-save-status', t('tts.vvm.dlFail') + result.error, 'error');
  }
}

//// 保存勾选的 VVM 列表并重启应用以生效 [@x380kkm 2026-06-13] ////
async function saveVvm(ctx) {
  const { doc, gateway, t, showStatus } = ctx;
  const checked = doc.querySelectorAll('#vvm-checkboxes input[type=checkbox]:checked');
  const vvmFiles = Array.from(checked).map((c) => c.value);
  if (vvmFiles.length === 0) {
    showStatus('vvm-save-status', t('tts.vvm.selectOne'), 'error');
    return;
  }
  await gateway.config.save({ tts: { vvmFiles } });
  await gateway.system.relaunch();
}

export { VVM_CHARACTERS };
