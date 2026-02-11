/**
 * Settings UI Controller
 * Handles all tab interactions, model import, expression management, etc.
 */
let petSystem = null;
let currentModelConfig = {};
let suggestedMapping = null;
let scannedParamIds = [];
let scannedMotions = {};  // {group: [{file}]} from scan-model-info

document.addEventListener('DOMContentLoaded', async () => {
    petSystem = new DesktopPetSystem();
    await petSystem.init();

    // Wire emotion system callbacks to IPC
    petSystem.emotionSystem.onEmotionTriggered = (emotionName) => {
        console.log(`[SettingsUI] onEmotionTriggered → IPC triggerExpression("${emotionName}")`);
        if (window.electronAPI) window.electronAPI.triggerExpression(emotionName);
    };
    petSystem.emotionSystem.onEmotionReverted = () => {
        console.log('[SettingsUI] onEmotionReverted → IPC revertExpression');
        if (window.electronAPI) window.electronAPI.revertExpression();
    };
    petSystem.emotionSystem.onMotionTriggered = (group, index, emotionName) => {
        console.log(`[SettingsUI] onMotionTriggered → IPC triggerMotion("${group}", ${index}, "${emotionName}")`);
        if (window.electronAPI) window.electronAPI.triggerMotion(group, index);
    };

    // Load saved config
    const config = petSystem.aiClient.getConfig();
    document.getElementById('api-url').value = config.baseURL || '';
    document.getElementById('api-key').value = config.apiKey || '';
    document.getElementById('model-name').value = config.modelName || '';

    // Load full config
    if (window.electronAPI && window.electronAPI.loadConfig) {
        const fileConfig = await window.electronAPI.loadConfig();
        if (fileConfig.interval) {
            document.getElementById('interval').value = fileConfig.interval;
            petSystem.setInterval(parseInt(fileConfig.interval) * 1000);
        }
        // Load model config
        currentModelConfig = fileConfig.model || { type: 'none' };
        loadModelUI();
        loadEmotionUI(fileConfig);
    }
});

// ========== Tab Switching ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'prompt') loadPromptUI();
    });
});

// ========== Status Helper ==========
function showStatus(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status ' + type;
    if (type !== 'info') setTimeout(() => { el.className = 'status'; }, 5000);
}

// ========== API Settings ==========
document.getElementById('btn-save-api').addEventListener('click', () => {
    const cfg = {
        baseURL: document.getElementById('api-url').value.trim(),
        apiKey: document.getElementById('api-key').value.trim(),
        modelName: document.getElementById('model-name').value.trim()
    };
    petSystem.aiClient.saveConfig(cfg);
    petSystem.systemPrompt = petSystem.promptBuilder.buildSystemPrompt();
    showStatus('api-status', 'Saved', 'success');
});

document.getElementById('btn-test-api').addEventListener('click', async () => {
    showStatus('api-status', 'Testing...', 'info');
    const result = await petSystem.aiClient.testConnection();
    if (result.success) {
        showStatus('api-status', 'Connected: ' + result.response, 'success');
    } else {
        showStatus('api-status', 'Failed: ' + result.error, 'error');
    }
});

document.getElementById('btn-save-interval').addEventListener('click', () => {
    const seconds = parseInt(document.getElementById('interval').value);
    if (window.electronAPI) window.electronAPI.saveConfig({ interval: seconds });
    petSystem.setInterval(seconds * 1000);
});

// ========== Start/Stop ==========
document.getElementById('btn-start').addEventListener('click', () => petSystem.start());
document.getElementById('btn-stop').addEventListener('click', () => petSystem.stop());

if (window.electronAPI) {
    window.electronAPI.onPetWindowClosed(() => {
        petSystem.isActive = false;
        petSystem.stopDetection();
    });
}

// ========== Hover State ==========
if (window.electronAPI && window.electronAPI.onPetHoverState) {
    window.electronAPI.onPetHoverState((isHovering) => {
        if (petSystem && petSystem.emotionSystem) {
            petSystem.emotionSystem.setHoverState(isHovering);
        }
    });
}

// ========== Model Tab ==========
const PARAM_LABELS = {
    angleX: '头部左右', angleY: '头部上下', angleZ: '头部倾斜',
    bodyAngleX: '身体左右', eyeBallX: '眼球左右', eyeBallY: '眼球上下'
};

function loadModelUI() {
    const typeSelect = document.getElementById('model-type');
    typeSelect.value = currentModelConfig.type || 'none';
    updateModelCards();

    // Load existing values
    if (currentModelConfig.type === 'live2d') {
        document.getElementById('l2d-info').textContent =
            currentModelConfig.modelJsonFile ? `模型: ${currentModelConfig.modelJsonFile}` : '';
        document.getElementById('canvas-y-slider').value = currentModelConfig.canvasYRatio || 0.60;
        document.getElementById('canvas-y-val').textContent = (currentModelConfig.canvasYRatio || 0.60).toFixed(2);
        renderParamMapping();
    }
    if (currentModelConfig.type === 'image') {
        document.getElementById('image-info').textContent =
            currentModelConfig.staticImagePath ? `图片: ${currentModelConfig.staticImagePath}` : '';
        document.getElementById('bottom-align-slider').value = currentModelConfig.bottomAlignOffset || 0.5;
        document.getElementById('bottom-align-val').textContent = (currentModelConfig.bottomAlignOffset || 0.5).toFixed(2);
    }
}

function updateModelCards() {
    const type = document.getElementById('model-type').value;
    document.getElementById('card-live2d').style.display = type === 'live2d' ? '' : 'none';
    document.getElementById('card-param-mapping').style.display = type === 'live2d' ? '' : 'none';
    document.getElementById('card-canvas-y').style.display = type === 'live2d' ? '' : 'none';
    document.getElementById('card-image').style.display = type === 'image' ? '' : 'none';
    document.getElementById('card-bottom-align').style.display = type === 'image' ? '' : 'none';
}

document.getElementById('model-type').addEventListener('change', () => {
    currentModelConfig.type = document.getElementById('model-type').value;
    updateModelCards();
});

// Canvas Y slider
document.getElementById('canvas-y-slider').addEventListener('input', (e) => {
    document.getElementById('canvas-y-val').textContent = parseFloat(e.target.value).toFixed(2);
    currentModelConfig.canvasYRatio = parseFloat(e.target.value);
});

// Bottom align slider
document.getElementById('bottom-align-slider').addEventListener('input', (e) => {
    document.getElementById('bottom-align-val').textContent = parseFloat(e.target.value).toFixed(2);
    currentModelConfig.bottomAlignOffset = parseFloat(e.target.value);
});

// Import Live2D
document.getElementById('btn-import-l2d').addEventListener('click', async () => {
    const result = await window.electronAPI.selectModelFolder();
    if (!result.success) {
        if (result.error !== 'cancelled') showStatus('model-status', result.error, 'error');
        return;
    }
    const folderPath = result.folderPath;
    const modelFile = result.modelFiles[0]; // Use first found

    // Scan model info
    showStatus('model-status', '扫描模型...', 'info');
    const scanResult = await window.electronAPI.scanModelInfo(folderPath, modelFile);
    if (!scanResult.success) {
        showStatus('model-status', scanResult.error, 'error');
        return;
    }

    currentModelConfig.folderPath = folderPath;
    currentModelConfig.modelJsonFile = modelFile;
    currentModelConfig.type = 'live2d';
    document.getElementById('model-type').value = 'live2d';
    updateModelCards();

    // Store scan results
    scannedParamIds = scanResult.parameterIds || [];
    suggestedMapping = scanResult.suggestedMapping || {};

    // Show info
    const motionCount = Object.values(scanResult.motions || {}).reduce((sum, arr) => sum + arr.length, 0);
    const info = [`模型: ${scanResult.modelName}`,
        `参数: ${scannedParamIds.length}个`,
        `表情: ${scanResult.expressions.length}个`,
        `动作: ${motionCount}个`,
        `Moc: ${scanResult.validation.mocValid ? '✓' : '✗'}`,
        `纹理: ${scanResult.validation.texturesValid ? '✓' : '✗'}`
    ].join(' | ');
    document.getElementById('l2d-info').textContent = info;

    // Clear old expression/motion data for new model
    currentModelConfig.expressions = [];
    currentModelConfig.motionEmotions = [];
    currentModelConfig.expressionDurations = {};
    currentModelConfig.motionDurations = {};
    currentModelConfig.hasExpressions = false;

    // Auto-populate expressions
    if (scanResult.expressions.length > 0) {
        currentModelConfig.hasExpressions = true;
        currentModelConfig.expressions = scanResult.expressions.map(e => ({
            name: e.name, label: e.name, file: e.file
        }));
    }

    // Auto-populate motions
    scannedMotions = scanResult.motions || {};
    if (Object.keys(scannedMotions).length > 0) {
        const motionEmotions = [];
        for (const [group, entries] of Object.entries(scannedMotions)) {
            entries.forEach((entry, idx) => {
                const fileName = (entry.file || '').replace(/^.*[\\/]/, '').replace('.motion3.json', '');
                motionEmotions.push({
                    name: fileName || `${group}_${idx}`,
                    group, index: idx
                });
            });
        }
        currentModelConfig.motionEmotions = motionEmotions;
    }

    renderParamMapping();
    renderExpressionList(currentModelConfig);
    renderMotionList(currentModelConfig);

    // Copy to userData if checked
    if (document.getElementById('copy-to-userdata').checked) {
        showStatus('model-status', '复制模型到应用数据目录...', 'info');
        const copyResult = await window.electronAPI.copyModelToUserdata(folderPath, scanResult.modelName);
        if (copyResult.success) {
            currentModelConfig.userDataModelPath = copyResult.userDataModelPath;
            showStatus('model-status', '模型已导入', 'success');
        } else {
            showStatus('model-status', '复制失败: ' + copyResult.error, 'error');
        }
    } else {
        showStatus('model-status', '模型已选择', 'success');
    }
});

function renderParamMapping() {
    const container = document.getElementById('param-mapping-list');
    container.innerHTML = '';
    const pm = currentModelConfig.paramMapping || {};
    for (const [key, label] of Object.entries(PARAM_LABELS)) {
        const mapped = pm[key];
        const suggested = suggestedMapping ? suggestedMapping[key] : null;
        // Sort: suggested first, then rest alphabetically
        const sorted = [...scannedParamIds].sort((a, b) => {
            if (a === suggested) return -1;
            if (b === suggested) return 1;
            return a.localeCompare(b);
        });
        const row = document.createElement('div');
        row.className = 'param-row';
        row.innerHTML = `
            <span class="param-label">${label}</span>
            <select class="param-select" data-key="${key}" style="flex:1;padding:4px;font-size:12px;border-radius:4px;">
                <option value="">未映射</option>
                ${sorted.map(id =>
                    `<option value="${id}" ${id === mapped ? 'selected' : ''}>${id}${id === suggested ? ' ★' : ''}</option>`
                ).join('')}
            </select>
        `;
        container.appendChild(row);
    }
    // Listen for manual changes
    container.querySelectorAll('.param-select').forEach(sel => {
        sel.addEventListener('change', () => {
            if (!currentModelConfig.paramMapping) currentModelConfig.paramMapping = {};
            currentModelConfig.paramMapping[sel.dataset.key] = sel.value || null;
        });
    });
}

document.getElementById('btn-apply-suggested').addEventListener('click', () => {
    if (!suggestedMapping) return;
    if (!currentModelConfig.paramMapping) currentModelConfig.paramMapping = {};
    for (const [key, val] of Object.entries(suggestedMapping)) {
        if (val) currentModelConfig.paramMapping[key] = val;
    }
    renderParamMapping();
    showStatus('model-status', '已应用建议映射', 'success');
});

// Import static image
document.getElementById('btn-import-image').addEventListener('click', async () => {
    const result = await window.electronAPI.selectStaticImage();
    if (!result.success) return;
    currentModelConfig.staticImagePath = result.filePath;
    currentModelConfig.type = 'image';
    document.getElementById('model-type').value = 'image';
    document.getElementById('image-info').textContent = `图片: ${result.filePath}`;
    updateModelCards();
});

// Bubble frame
document.getElementById('btn-select-bubble').addEventListener('click', async () => {
    const result = await window.electronAPI.selectBubbleImage();
    if (!result.success) return;
    document.getElementById('bubble-info').textContent = `气泡框: ${result.filePath}`;
    // Save to config
    await window.electronAPI.saveConfig({ bubble: { frameImagePath: result.filePath } });
});

document.getElementById('btn-clear-bubble').addEventListener('click', async () => {
    document.getElementById('bubble-info').textContent = '';
    await window.electronAPI.saveConfig({ bubble: { frameImagePath: null } });
});

// App icon
document.getElementById('btn-select-icon').addEventListener('click', async () => {
    const result = await window.electronAPI.selectAppIcon();
    if (!result.success) return;
    document.getElementById('icon-preview').src = result.iconPath;
    document.getElementById('icon-preview').style.display = '';
    document.getElementById('icon-info').textContent = `图标: ${result.iconPath}`;
    await window.electronAPI.saveConfig({ appIcon: result.iconPath });
});

// Save model config
document.getElementById('btn-save-model').addEventListener('click', async () => {
    await window.electronAPI.saveConfig({ model: currentModelConfig });
    showStatus('model-status', '模型设置已保存', 'success');
});

// Clear model
document.getElementById('btn-clear-model').addEventListener('click', async () => {
    currentModelConfig = {
        type: 'none', folderPath: null, modelJsonFile: null,
        copyToUserData: true, userDataModelPath: null,
        staticImagePath: null, bottomAlignOffset: 0.5,
        gifExpressions: {},
        paramMapping: { angleX: null, angleY: null, angleZ: null, bodyAngleX: null, eyeBallX: null, eyeBallY: null },
        hasExpressions: false, expressions: [],
        expressionDurations: {}, defaultExpressionDuration: 5000,
        motionEmotions: [], motionDurations: {}, defaultMotionDuration: 3000,
        canvasYRatio: 0.60
    };
    await window.electronAPI.saveConfig({ model: currentModelConfig });
    document.getElementById('model-type').value = 'none';
    updateModelCards();
    showStatus('model-status', '模型已清除', 'success');
});

// ========== Emotion Tab ==========
function loadEmotionUI(fileConfig) {
    if (!fileConfig) return;
    if (fileConfig.emotionFrequency) {
        document.getElementById('emotion-frequency').value = fileConfig.emotionFrequency;
    }
    if (fileConfig.allowSimultaneous) {
        document.getElementById('allow-simultaneous').checked = true;
    }
    if (fileConfig.model && fileConfig.model.defaultExpressionDuration) {
        document.getElementById('default-expr-duration').value = fileConfig.model.defaultExpressionDuration / 1000;
    }
    if (fileConfig.model && fileConfig.model.defaultMotionDuration) {
        document.getElementById('default-motion-duration').value = fileConfig.model.defaultMotionDuration / 1000;
    }
    renderExpressionList(fileConfig.model);
    renderMotionList(fileConfig.model);
}

function renderExpressionList(modelConfig) {
    const container = document.getElementById('expression-list');
    container.innerHTML = '';
    const expressions = (modelConfig && modelConfig.expressions) || [];
    const durations = (modelConfig && modelConfig.expressionDurations) || {};
    const enabledList = [];

    if (expressions.length === 0) {
        document.getElementById('expr-hint').style.display = '';
        return;
    }
    document.getElementById('expr-hint').style.display = 'none';

    expressions.forEach((expr, i) => {
        const durMs = durations[expr.name];
        const durSec = durMs ? (durMs / 1000) : '';
        const row = document.createElement('div');
        row.className = 'expr-item';
        row.innerHTML = `
            <input type="checkbox" class="expr-enabled" data-name="${expr.name}" checked>
            <input type="text" class="expr-name" value="${expr.name}" style="width:80px;padding:2px 4px;font-size:12px;" data-index="${i}">
            <span style="color:#888;font-size:11px;">${expr.file || ''}</span>
            <input type="number" class="expr-dur" value="${durSec}" placeholder="默认" step="0.5" min="0" style="width:60px;padding:2px 4px;font-size:12px;" data-name="${expr.name}">
            <span style="color:#888;font-size:11px;">秒</span>
            <button class="btn btn-danger btn-sm expr-del" data-index="${i}" style="padding:2px 8px;">✕</button>
        `;
        container.appendChild(row);
    });

    // Delete expression
    container.querySelectorAll('.expr-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            currentModelConfig.expressions.splice(idx, 1);
            renderExpressionList(currentModelConfig);
        });
    });
}

document.getElementById('btn-add-expr').addEventListener('click', () => {
    if (!currentModelConfig.expressions) currentModelConfig.expressions = [];
    currentModelConfig.expressions.push({ name: '新表情', label: '新表情', file: '' });
    currentModelConfig.hasExpressions = true;
    renderExpressionList(currentModelConfig);
});

// ========== Motion List ==========
function renderMotionList(modelConfig) {
    const container = document.getElementById('motion-list');
    container.innerHTML = '';
    const motionEmotions = (modelConfig && modelConfig.motionEmotions) || [];
    const durations = (modelConfig && modelConfig.motionDurations) || {};

    if (motionEmotions.length === 0) {
        document.getElementById('motion-hint').style.display = '';
        return;
    }
    document.getElementById('motion-hint').style.display = 'none';

    // Build group options from scanned motions
    const groupOptions = Object.keys(scannedMotions);

    motionEmotions.forEach((m, i) => {
        const durMs = durations[m.name];
        const durSec = durMs ? (durMs / 1000) : '';
        const maxIdx = scannedMotions[m.group] ? scannedMotions[m.group].length - 1 : 99;
        const row = document.createElement('div');
        row.className = 'expr-item';
        row.innerHTML = `
            <input type="checkbox" class="motion-enabled" data-name="${m.name}" checked>
            <input type="text" class="motion-name" value="${m.name}" style="width:80px;padding:2px 4px;font-size:12px;" data-index="${i}">
            <select class="motion-group" data-index="${i}" style="width:80px;padding:2px 4px;font-size:12px;">
                ${groupOptions.map(g => `<option value="${g}" ${g === m.group ? 'selected' : ''}>${g}</option>`).join('')}
                ${!groupOptions.includes(m.group) ? `<option value="${m.group}" selected>${m.group}</option>` : ''}
            </select>
            <input type="number" class="motion-index" value="${m.index}" min="0" max="${maxIdx}" style="width:45px;padding:2px 4px;font-size:12px;" data-index="${i}">
            <input type="number" class="motion-dur" value="${durSec}" placeholder="默认" step="0.5" min="0" style="width:60px;padding:2px 4px;font-size:12px;" data-name="${m.name}">
            <span style="color:#888;font-size:11px;">秒</span>
            <button class="btn btn-danger btn-sm motion-del" data-index="${i}" style="padding:2px 8px;">✕</button>
        `;
        container.appendChild(row);
    });

    // Delete motion
    container.querySelectorAll('.motion-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            currentModelConfig.motionEmotions.splice(idx, 1);
            renderMotionList(currentModelConfig);
        });
    });
}

document.getElementById('btn-add-motion').addEventListener('click', () => {
    if (!currentModelConfig.motionEmotions) currentModelConfig.motionEmotions = [];
    const firstGroup = Object.keys(scannedMotions)[0] || 'Default';
    currentModelConfig.motionEmotions.push({ name: '新动作', group: firstGroup, index: 0 });
    renderMotionList(currentModelConfig);
});

document.getElementById('btn-save-emotion-freq').addEventListener('click', () => {
    if (!petSystem || !petSystem.emotionSystem) return;
    const freq = parseInt(document.getElementById('emotion-frequency').value);
    const simultaneous = document.getElementById('allow-simultaneous').checked;
    petSystem.emotionSystem.setExpectedFrequency(freq);
    petSystem.emotionSystem.allowSimultaneous = simultaneous;
    if (window.electronAPI) window.electronAPI.saveConfig({ allowSimultaneous: simultaneous });
    showStatus('emotion-status', 'Saved', 'success');
});

document.getElementById('btn-save-expressions').addEventListener('click', async () => {
    // Collect expression data from UI
    const container = document.getElementById('expression-list');
    const names = container.querySelectorAll('.expr-name');
    const durs = container.querySelectorAll('.expr-dur');
    const enabled = container.querySelectorAll('.expr-enabled');

    const expressions = [];
    const expressionDurations = {};
    const enabledEmotions = [];

    names.forEach((nameInput, i) => {
        const name = nameInput.value.trim();
        if (!name) return;
        const expr = currentModelConfig.expressions[i] || {};
        expressions.push({ name, label: name, file: expr.file || '' });
        const durSec = parseFloat(durs[i]?.value);
        if (durSec > 0) expressionDurations[name] = Math.round(durSec * 1000);
        if (enabled[i]?.checked) enabledEmotions.push(name);
    });

    // Collect motion data from UI
    const motionContainer = document.getElementById('motion-list');
    const motionNames = motionContainer.querySelectorAll('.motion-name');
    const motionGroups = motionContainer.querySelectorAll('.motion-group');
    const motionIndices = motionContainer.querySelectorAll('.motion-index');
    const motionDurs = motionContainer.querySelectorAll('.motion-dur');
    const motionEnabled = motionContainer.querySelectorAll('.motion-enabled');

    const motionEmotions = [];
    const motionDurations = {};

    motionNames.forEach((nameInput, i) => {
        const name = nameInput.value.trim();
        if (!name) return;
        const group = motionGroups[i]?.value || 'Default';
        const index = parseInt(motionIndices[i]?.value) || 0;
        motionEmotions.push({ name, group, index });
        const durSec = parseFloat(motionDurs[i]?.value);
        if (durSec > 0) motionDurations[name] = Math.round(durSec * 1000);
        if (motionEnabled[i]?.checked) enabledEmotions.push(name);
    });

    const defaultDurSec = parseFloat(document.getElementById('default-expr-duration').value);
    const defaultDur = defaultDurSec > 0 ? Math.round(defaultDurSec * 1000) : 5000;
    const defaultMotionDurSec = parseFloat(document.getElementById('default-motion-duration').value);
    const defaultMotionDur = defaultMotionDurSec > 0 ? Math.round(defaultMotionDurSec * 1000) : 3000;

    currentModelConfig.expressions = expressions;
    currentModelConfig.expressionDurations = expressionDurations;
    currentModelConfig.defaultExpressionDuration = defaultDur;
    currentModelConfig.hasExpressions = expressions.length > 0;
    currentModelConfig.motionEmotions = motionEmotions;
    currentModelConfig.motionDurations = motionDurations;
    currentModelConfig.defaultMotionDuration = defaultMotionDur;

    await window.electronAPI.saveConfig({
        model: currentModelConfig,
        enabledEmotions
    });

    // Update emotion system
    if (petSystem && petSystem.emotionSystem) {
        petSystem.emotionSystem.configureExpressions(expressions, expressionDurations, defaultDur);
        petSystem.emotionSystem.configureMotions(motionEmotions, motionDurations, defaultMotionDur);
        petSystem.emotionSystem.setEnabledEmotions(enabledEmotions);
    }

    showStatus('save-emotion-status', '表情设置已保存', 'success');
});

// ========== Prompt Management ==========
function fillPromptFields(data) {
    document.getElementById('prompt-name').value = data.name || '';
    document.getElementById('prompt-user-identity').value = data.userIdentity || '';
    document.getElementById('prompt-user-term').value = data.userTerm || '';
    document.getElementById('prompt-desc').value = data.description || '';
    document.getElementById('prompt-personality').value = data.personality || '';
    document.getElementById('prompt-scenario').value = data.scenario || '';
    document.getElementById('prompt-rules').value = data.rules || '';
}

async function loadPromptUI() {
    if (!window.electronAPI || !window.electronAPI.loadPrompt) return;
    const result = await window.electronAPI.loadPrompt();
    if (result.success) fillPromptFields(result.data);
}

document.getElementById('btn-save-prompt').addEventListener('click', async () => {
    const promptData = {
        name: document.getElementById('prompt-name').value,
        userIdentity: document.getElementById('prompt-user-identity').value,
        userTerm: document.getElementById('prompt-user-term').value,
        description: document.getElementById('prompt-desc').value,
        personality: document.getElementById('prompt-personality').value,
        scenario: document.getElementById('prompt-scenario').value,
        rules: document.getElementById('prompt-rules').value
    };
    const result = await window.electronAPI.savePrompt(promptData);
    if (result.success) {
        showStatus('prompt-status', '已保存', 'success');
        if (petSystem && petSystem.promptBuilder) {
            await petSystem.promptBuilder.loadCharacterPrompt();
            petSystem.systemPrompt = petSystem.promptBuilder.buildSystemPrompt();
        }
    } else {
        showStatus('prompt-status', '保存失败: ' + result.error, 'error');
    }
});

document.getElementById('btn-reset-prompt').addEventListener('click', async () => {
    const result = await window.electronAPI.resetPrompt();
    if (result.success) {
        fillPromptFields(result.data);
        showStatus('prompt-status', '已还原为默认', 'success');
        if (petSystem && petSystem.promptBuilder) {
            await petSystem.promptBuilder.loadCharacterPrompt();
            petSystem.systemPrompt = petSystem.promptBuilder.buildSystemPrompt();
        }
    } else {
        showStatus('prompt-status', '还原失败: ' + result.error, 'error');
    }
});

// ========== TTS Settings ==========

let ttsMetas = [];

async function loadTTSStatus() {
    if (!window.electronAPI || !window.electronAPI.ttsGetStatus) return;
    const status = await window.electronAPI.ttsGetStatus();
    const el = document.getElementById('tts-status');
    const restartBtn = document.getElementById('btn-restart-tts');
    if (status.initialized) {
        if (status.degraded) {
            const elapsed = Date.now() - status.degradedAt;
            const remaining = Math.max(0, Math.ceil((status.retryInterval - elapsed) / 1000));
            el.textContent = `TTS: 熔断中 (${remaining}s 后自动重试)`;
            el.className = 'status error';
            restartBtn.style.display = '';
        } else {
            el.textContent = 'TTS: 已就绪' + (status.gpuMode ? ' (GPU)' : ' (CPU)');
            el.className = 'status success';
            restartBtn.style.display = 'none';
        }
        document.getElementById('tts-hint').style.display = 'none';
        // Load metas and populate dropdowns
        ttsMetas = await window.electronAPI.ttsGetMetas();
        populateSpeakerDropdown();
    } else {
        el.textContent = 'TTS: 离线 (voicevox_core 未找到)';
        el.className = 'status error';
        restartBtn.style.display = '';
    }
    const config = await window.electronAPI.loadConfig();
    if (config.tts) {
        document.getElementById('tts-speed').value = config.tts.speedScale || 1.0;
        document.getElementById('tts-pitch').value = config.tts.pitchScale || 0.0;
        document.getElementById('tts-volume').value = config.tts.volumeScale || 1.0;
        document.getElementById('tts-speed-val').textContent = config.tts.speedScale || 1.0;
        document.getElementById('tts-pitch-val').textContent = config.tts.pitchScale || 0.0;
        document.getElementById('tts-volume-val').textContent = config.tts.volumeScale || 1.0;
        // Restore audio mode
        const audioMode = config.tts.audioMode || 'tts';
        const radio = document.querySelector(`input[name="audio-mode"][value="${audioMode}"]`);
        if (radio) radio.checked = true;
        // Restore saved speaker + style selection
        if (config.tts.styleId !== undefined) {
            selectStyleById(config.tts.styleId);
        }
        // Restore GPU mode checkbox
        const gpuCheckbox = document.getElementById('tts-gpu-mode');
        if (gpuCheckbox) gpuCheckbox.checked = config.tts.gpuMode || false;
    }
}

function populateSpeakerDropdown() {
    const speakerSel = document.getElementById('tts-speaker');
    speakerSel.innerHTML = '';
    ttsMetas.forEach((speaker, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = speaker.name;
        speakerSel.appendChild(opt);
    });
    speakerSel.addEventListener('change', () => populateStyleDropdown(parseInt(speakerSel.value)));
    if (ttsMetas.length > 0) populateStyleDropdown(0);
}

function populateStyleDropdown(speakerIdx) {
    const styleSel = document.getElementById('tts-style-id');
    styleSel.innerHTML = '';
    const speaker = ttsMetas[speakerIdx];
    if (!speaker) return;
    speaker.styles.forEach(style => {
        const opt = document.createElement('option');
        opt.value = style.id;
        opt.textContent = style.name;
        styleSel.appendChild(opt);
    });
}

function selectStyleById(styleId) {
    for (let i = 0; i < ttsMetas.length; i++) {
        const idx = ttsMetas[i].styles.findIndex(s => s.id === styleId);
        if (idx >= 0) {
            document.getElementById('tts-speaker').value = i;
            populateStyleDropdown(i);
            document.getElementById('tts-style-id').value = styleId;
            return;
        }
    }
}

['tts-speed', 'tts-pitch', 'tts-volume'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
        document.getElementById(id + '-val').textContent = el.value;
    });
});

document.getElementById('btn-save-tts').addEventListener('click', async () => {
    const ttsConfig = {
        styleId: parseInt(document.getElementById('tts-style-id').value),
        speedScale: parseFloat(document.getElementById('tts-speed').value),
        pitchScale: parseFloat(document.getElementById('tts-pitch').value),
        volumeScale: parseFloat(document.getElementById('tts-volume').value)
    };
    await window.electronAPI.ttsSetConfig(ttsConfig);
    // Save audio mode to config
    const audioMode = document.querySelector('input[name="audio-mode"]:checked')?.value || 'tts';
    const fullConfig = await window.electronAPI.loadConfig();
    fullConfig.tts = fullConfig.tts || {};
    fullConfig.tts.audioMode = audioMode;
    fullConfig.tts.styleId = ttsConfig.styleId;
    fullConfig.tts.speedScale = ttsConfig.speedScale;
    fullConfig.tts.pitchScale = ttsConfig.pitchScale;
    fullConfig.tts.volumeScale = ttsConfig.volumeScale;
    fullConfig.tts.gpuMode = document.getElementById('tts-gpu-mode')?.checked || false;
    await window.electronAPI.saveConfig(fullConfig);
    showStatus('tts-save-status', '已保存', 'success');
});

document.getElementById('btn-test-tts').addEventListener('click', async () => {
    const text = document.getElementById('tts-test-text').value.trim();
    if (!text) return;
    showStatus('tts-test-status', '合成中...', '');
    const result = await window.electronAPI.ttsSynthesize(text);
    if (result.success) {
        showStatus('tts-test-status', `翻译: ${result.jaText}`, 'success');
        const wavBytes = Uint8Array.from(atob(result.wav), c => c.charCodeAt(0));
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
    } else {
        showStatus('tts-test-status', '失败: ' + result.error, 'error');
    }
});

loadTTSStatus();

// Restart TTS button
document.getElementById('btn-restart-tts')?.addEventListener('click', async () => {
    const el = document.getElementById('tts-status');
    el.textContent = 'TTS: 重启中...';
    el.className = 'status';
    const result = await window.electronAPI.ttsRestart();
    if (result.success) {
        await loadTTSStatus();
    } else {
        el.textContent = 'TTS: 重启失败 - ' + (result.error || '未知错误');
        el.className = 'status error';
    }
});

// Default audio generation
document.getElementById('btn-generate-default-audio')?.addEventListener('click', async () => {
    const textarea = document.getElementById('default-audio-phrases');
    const phrases = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (phrases.length === 0) {
        showStatus('default-audio-status', '请输入至少一个语气词', 'error');
        return;
    }
    const styleId = parseInt(document.getElementById('tts-style-id').value) || 0;
    showStatus('default-audio-status', `生成中... (${phrases.length} 个)`, '');
    const result = await window.electronAPI.generateDefaultAudio(phrases, styleId);
    if (result.success) {
        const ok = result.results.filter(r => r.success).length;
        showStatus('default-audio-status', `完成: ${ok}/${phrases.length} 个成功`, 'success');
    } else {
        showStatus('default-audio-status', '失败: ' + result.error, 'error');
    }
});

// Load saved phrases into textarea
(async () => {
    const config = await window.electronAPI?.loadConfig();
    if (config?.tts?.defaultPhrases) {
        const textarea = document.getElementById('default-audio-phrases');
        if (textarea) textarea.value = config.tts.defaultPhrases.join('\n');
    }
})();

// VVM config
const VVM_CHARACTERS = {
    '0.vvm': '四国めたん, ずんだもん, 春日部つむぎ, 雨晴はう',
    '1.vvm': '冥鳴ひまり',
    '2.vvm': '九州そら',
    '3.vvm': '波音リツ, 中国うさぎ',
    '4.vvm': '玄野武宏, 剣崎雌雄',
    '5.vvm': '四国めたん(ささやき), ずんだもん(ささやき), 九州そら(ささやき)',
    '6.vvm': 'No.7',
    '7.vvm': '後鬼',
    '8.vvm': 'WhiteCUL',
    '9.vvm': '白上虎太郎',
    '10.vvm': '玄野武宏(追加), ちび式じい',
    '11.vvm': '櫻歌ミコ, ナースロボ＿タイプＴ',
    '12.vvm': '†聖騎士 紅桜†, 雀松朱司, 麒ヶ島宗麟',
    '13.vvm': '春歌ナナ, 猫使アル, 猫使ビィ',
    '14.vvm': '栗田まろん, あいえるたん, 満別花丸, 琴詠ニア',
    '15.vvm': 'ずんだもん(追加), 青山龍星, もち子さん, 小夜/SAYO',
    '16.vvm': '後鬼(追加)',
    '17.vvm': 'Voidoll',
    '18.vvm': 'ぞん子, 中部つるぎ',
    '19.vvm': '離途, 黒沢冴白',
    '20.vvm': 'ユーレイちゃん',
    '21.vvm': '東北ずん子, 東北きりたん, 東北イタコ, 猫使(追加)',
    '22.vvm': 'あんこもん',
    '23.vvm': 'あんこもん(ささやき)',
    'n0.vvm': 'VOICEVOX Nemo (女声1-6, 男声1-3)',
};

async function loadVvmConfig() {
    if (!window.electronAPI?.ttsGetAvailableVvms) return;
    const available = await window.electronAPI.ttsGetAvailableVvms();
    const config = await window.electronAPI.loadConfig();
    const loaded = config.tts?.vvmFiles || ['0.vvm', '8.vvm'];
    const container = document.getElementById('vvm-checkboxes');
    if (!container) return;
    container.innerHTML = available.map(f => {
        const checked = loaded.includes(f) ? 'checked' : '';
        const desc = VVM_CHARACTERS[f] || '';
        return `<label style="display:block;padding:2px 0;font-size:12px;"><input type="checkbox" value="${f}" ${checked}> <b>${f}</b> ${desc}</label>`;
    }).join('');
}

document.getElementById('btn-save-vvm')?.addEventListener('click', async () => {
    const checks = document.querySelectorAll('#vvm-checkboxes input[type=checkbox]:checked');
    const vvmFiles = Array.from(checks).map(c => c.value);
    if (vvmFiles.length === 0) {
        showStatus('vvm-save-status', '至少选择一个 VVM', 'error');
        return;
    }
    const config = await window.electronAPI.loadConfig();
    config.tts = config.tts || {};
    config.tts.vvmFiles = vvmFiles;
    await window.electronAPI.saveConfig(config);
    showStatus('vvm-save-status', '已保存，重启后生效', 'success');
});

loadVvmConfig();
