/**
 * ModelAdapter Strategy Pattern
 * Unified interface for Live2D, Image, and Null rendering modes.
 * desktop-pet-system only holds currentAdapter and calls these methods.
 */

// ========== Base Adapter ==========

class ModelAdapter {
    constructor(config) {
        this.config = config;
    }
    async load(container) { }
    setExpression(name) { }
    revertExpression() { }
    playMotion(group, index) { }
    stopMotion() { }
    updateParams(trackX, trackY) { }
    resize(width, height) { }
    destroy() { }
    getType() { return 'none'; }
}

// ========== Live2D Adapter ==========

class Live2DAdapter extends ModelAdapter {
    constructor(config) {
        super(config);
        this.pixiApp = null;
        this.model = null;
        this.paramMap = null;
        this.canvas = null;
        this._expressionCache = {};   // {name: [{Id, Value, Blend}]}
        this._activeExprParams = null; // current expression param overrides
        this._modelDir = null;         // resolved model directory URL
    }

    async load(container) {
        const canvas = document.getElementById('live2d-canvas');
        this.canvas = canvas;

        window.PIXI = PIXI;
        if (PIXI.live2d && PIXI.live2d.Live2DModel) {
            await PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);
        }

        const dpr = window.devicePixelRatio || 1;
        this.pixiApp = new PIXI.Application({
            view: canvas,
            transparent: true,
            autoStart: true,
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundAlpha: 0,
            resolution: dpr,
            autoDensity: true,
            powerPreference: 'high-performance',
            antialias: true,
            failIfMajorPerformanceCaveat: false
        });

        // Build model path from config
        let modelPath;
        if (this.config.userDataModelPath && this.config.modelJsonFile) {
            const basePath = this.config._resolvedModelDir;
            this._modelDir = basePath;
            modelPath = basePath + '/' + this.config.modelJsonFile;
        } else if (this.config.folderPath && this.config.modelJsonFile) {
            this._modelDir = this.config.folderPath;
            modelPath = this.config.folderPath + '/' + this.config.modelJsonFile;
        } else {
            throw new Error('No model path configured');
        }

        this.model = await PIXI.live2d.Live2DModel.from(modelPath, {
            autoUpdate: true,
            autoInteract: false  // We handle tracking manually
        });

        this.model.anchor.set(0.5, 0.5);
        this.model._origW = this.model.width;
        this.model._origH = this.model.height;
        this.pixiApp.stage.addChild(this.model);

        // Show canvas, hide image
        canvas.style.display = 'block';
        const img = document.getElementById('static-image');
        if (img) img.style.display = 'none';
        const placeholder = document.getElementById('placeholder');
        if (placeholder) placeholder.style.display = 'none';

        this._fitModel();
        this._buildParamMap();
        this._loadExpressionFiles();

        // Apply params every frame
        if (this.pixiApp) {
            this.pixiApp.ticker.add(() => {
                if (!this.model || !this.paramMap) return;
                this._applyTracking();
                this._applyExpression();
            });
        }
    }

    _fitModel() {
        if (!this.model || !this.pixiApp) return;
        const w = window.innerWidth, h = window.innerHeight;
        const origW = this.model._origW || this.model.width;
        const scale = w / origW;
        this.model.scale.set(scale);
        this.model.x = w / 2;
        this.model.y = h * (this.config.canvasYRatio || 0.60);
    }

    _buildParamMap() {
        try {
            const core = this.model.internalModel.coreModel;
            const m = core._model;
            this.paramMap = {};
            for (let i = 0; i < m.parameters.count; i++) {
                this.paramMap[m.parameters.ids[i]] = i;
            }
        } catch (e) {
            console.error('[Live2DAdapter] Failed to build param map:', e);
        }
    }

    async _loadExpressionFiles() {
        const configExprs = this.config.expressions;
        if (!configExprs || configExprs.length === 0 || !this._modelDir) return;

        for (const expr of configExprs) {
            try {
                // Convert filesystem path to file:// URL
                let url = this._modelDir + '/' + expr.file;
                if (!url.startsWith('file://') && !url.startsWith('http')) {
                    url = 'file:///' + url.replace(/\\/g, '/');
                }
                const resp = await fetch(url);
                if (!resp.ok) {
                    console.warn(`[Live2DAdapter] Expression fetch failed: ${expr.name} (${resp.status})`);
                    continue;
                }
                const json = await resp.json();
                if (json.Parameters && Array.isArray(json.Parameters)) {
                    this._expressionCache[expr.name] = json.Parameters;
                }
            } catch (e) {
                console.warn(`[Live2DAdapter] Failed to load expression "${expr.name}":`, e.message);
            }
        }
        console.log(`[Live2DAdapter] Loaded ${Object.keys(this._expressionCache).length} expressions:`,
            Object.keys(this._expressionCache));
    }

    _applyExpression() {
        if (!this._activeExprParams) return;
        for (const p of this._activeExprParams) {
            // Use direct set every frame — value from exp3.json is the target
            this._setParam(p.Id, p.Value);
        }
    }

    _setParam(name, value) {
        if (!this.paramMap || this.paramMap[name] === undefined) return;
        try {
            const core = this.model.internalModel.coreModel;
            core._model.parameters.values[this.paramMap[name]] = value;
        } catch (e) { }
    }

    _applyTracking() {
        const pm = this.config.paramMapping || {};
        if (pm.angleX)     this._setParam(pm.angleX, this._trackX * 30);
        if (pm.angleY)     this._setParam(pm.angleY, -this._trackY * 30);
        if (pm.angleZ)     this._setParam(pm.angleZ, this._trackX * -5);
        if (pm.bodyAngleX) this._setParam(pm.bodyAngleX, this._trackX * 8);
        if (pm.eyeBallX)   this._setParam(pm.eyeBallX, this._trackX);
        if (pm.eyeBallY)   this._setParam(pm.eyeBallY, -this._trackY);
    }

    updateParams(trackX, trackY) {
        this._trackX = trackX;
        this._trackY = trackY;
    }

    setExpression(name) {
        if (!this.model) return;
        const params = this._expressionCache[name];
        if (params) {
            // Save default values of affected params for revert
            this._savedParamDefaults = {};
            try {
                const core = this.model.internalModel.coreModel;
                const defaults = core._model.parameters.defaultValues;
                for (const p of params) {
                    const idx = this.paramMap[p.Id];
                    if (idx !== undefined) {
                        this._savedParamDefaults[p.Id] = defaults[idx];
                    }
                }
            } catch (e) {
                for (const p of params) {
                    this._savedParamDefaults[p.Id] = 0;
                }
            }
            this._activeExprParams = params;
            console.log(`[Live2DAdapter] setExpression("${name}") → ${params.length} params`);
        } else {
            console.warn(`[Live2DAdapter] setExpression("${name}") → not found in cache`);
        }
    }

    revertExpression() {
        if (!this.model) return;
        // Restore default values for affected params
        if (this._savedParamDefaults) {
            for (const [id, val] of Object.entries(this._savedParamDefaults)) {
                this._setParam(id, val);
            }
            console.log('[Live2DAdapter] revertExpression → restored', Object.keys(this._savedParamDefaults).length, 'params');
            this._savedParamDefaults = null;
        }
        this._activeExprParams = null;
    }

    playMotion(group, index) {
        if (!this.model) return;
        try {
            // Use the SDK's motion method — plays animation and auto-ends
            this.model.motion(group, index);
            console.log(`[Live2DAdapter] playMotion("${group}", ${index})`);
        } catch (e) {
            console.warn(`[Live2DAdapter] playMotion failed:`, e.message);
        }
    }

    stopMotion() {
        // SDK motions auto-end; this is a no-op for now
    }

    resize(width, height) {
        if (this.pixiApp) {
            this.pixiApp.renderer.resize(width, height);
            this._fitModel();
        }
    }

    destroy() {
        if (this.model) {
            this.pixiApp.stage.removeChild(this.model);
            this.model.destroy();
            this.model = null;
        }
        if (this.pixiApp) {
            this.pixiApp.destroy(false);
            this.pixiApp = null;
        }
        this.paramMap = null;
    }

    getType() { return 'live2d'; }
}

// ========== Image Adapter ==========

class ImageAdapter extends ModelAdapter {
    constructor(config) {
        super(config);
        this.imgElement = null;
        // Folder mode pools
        this.idleImages = [];
        this.talkingImages = [];
        this.emotionImages = {};  // {emotionName: [filenames]}
        // State
        this.isTalking = false;
        this.currentEmotion = null;
        this._folderMode = false;
    }

    async load(container) {
        const canvas = document.getElementById('live2d-canvas');
        if (canvas) canvas.style.display = 'none';
        const placeholder = document.getElementById('placeholder');
        if (placeholder) placeholder.style.display = 'none';

        this.imgElement = document.getElementById('static-image');
        if (!this.imgElement) return;

        this._folderMode = !!(this.config.imageFolderPath && this.config.imageFiles);

        if (this._folderMode) {
            this._buildPools();
            this._applyCropStyle();
            this._updateDisplay();
        } else {
            // Legacy single-image mode
            this.imgElement.src = this.config.staticImagePath || '';
            const offset = this.config.bottomAlignOffset || 0.5;
            this.imgElement.style.position = 'absolute';
            this.imgElement.style.bottom = `${(1 - offset) * 100}%`;
            this.imgElement.style.left = '50%';
            this.imgElement.style.transform = 'translateX(-50%)';
        }

        this.imgElement.style.display = 'block';

        // Listen for talking state changes
        if (window.electronAPI && window.electronAPI.onTalkingStateChanged) {
            window.electronAPI.onTalkingStateChanged((isTalking) => {
                this.isTalking = isTalking;
                if (!this.currentEmotion) {
                    this._updateDisplay();
                }
            });
        }
    }

    _buildPools() {
        const files = this.config.imageFiles || [];
        this.idleImages = [];
        this.talkingImages = [];
        this.emotionImages = {};

        for (const f of files) {
            if (f.idle) this.idleImages.push(f.file);
            if (f.talking) this.talkingImages.push(f.file);
            if (f.emotionName) {
                if (!this.emotionImages[f.emotionName]) {
                    this.emotionImages[f.emotionName] = [];
                }
                this.emotionImages[f.emotionName].push(f.file);
            }
        }
    }

    _updateDisplay() {
        if (!this._folderMode) return;
        // Priority: emotion > talking > idle
        if (this.currentEmotion && this.emotionImages[this.currentEmotion]) {
            this._showRandom(this.emotionImages[this.currentEmotion]);
        } else if (this.isTalking && this.talkingImages.length > 0) {
            this._showRandom(this.talkingImages);
        } else if (this.idleImages.length > 0) {
            this._showRandom(this.idleImages);
        }
    }

    _showRandom(pool) {
        if (!pool || pool.length === 0 || !this.imgElement) return;
        const file = pool[Math.floor(Math.random() * pool.length)];
        const folderPath = this.config.imageFolderPath.replace(/\\/g, '/');
        this.imgElement.src = 'file:///' + folderPath + '/' + encodeURIComponent(file);
    }

    _applyCropStyle() {
        if (!this.imgElement) return;
        const scale = this.config.imageCropScale || 1.0;
        this.imgElement.style.position = 'absolute';
        this.imgElement.style.top = '0';
        this.imgElement.style.left = '0';
        this.imgElement.style.width = '100%';
        this.imgElement.style.height = 'auto';
        this.imgElement.style.transformOrigin = 'top center';
        this.imgElement.style.transform = `scale(${scale})`;
    }

    setExpression(name) {
        if (this._folderMode) {
            this.currentEmotion = name;
            this._updateDisplay();
        } else {
            // Legacy GIF expression switching
            const gifMap = this.config.gifExpressions || {};
            if (gifMap[name] && this.imgElement) {
                this.imgElement.src = gifMap[name];
            }
        }
    }

    revertExpression() {
        if (this._folderMode) {
            this.currentEmotion = null;
            this._updateDisplay();
        } else if (this.imgElement && this.config.staticImagePath) {
            this.imgElement.src = this.config.staticImagePath;
        }
    }

    updateParams(trackX, trackY) {
        // No-op for image mode
    }

    resize(width, height) {
        // Image auto-scales via CSS
    }

    destroy() {
        if (this.imgElement) {
            this.imgElement.src = '';
            this.imgElement.style.display = 'none';
        }
    }

    getType() { return 'image'; }
}

// ========== Null Adapter ==========

class NullAdapter extends ModelAdapter {
    async load(container) {
        const canvas = document.getElementById('live2d-canvas');
        if (canvas) canvas.style.display = 'none';
        const img = document.getElementById('static-image');
        if (img) img.style.display = 'none';

        let placeholder = document.getElementById('placeholder');
        if (!placeholder) {
            placeholder = document.createElement('img');
            placeholder.id = 'placeholder';
            placeholder.style.maxWidth = '80%';
            placeholder.style.maxHeight = '80%';
            placeholder.style.objectFit = 'contain';
            container.appendChild(placeholder);
        }
        placeholder.src = 'assets/placeholder.svg';
        placeholder.style.display = 'block';
    }

    destroy() {
        const placeholder = document.getElementById('placeholder');
        if (placeholder) placeholder.style.display = 'none';
    }

    getType() { return 'none'; }
}

// ========== Factory ==========

function createModelAdapter(modelConfig) {
    switch (modelConfig.type) {
        case 'live2d': return new Live2DAdapter(modelConfig);
        case 'image':  return new ImageAdapter(modelConfig);
        default:       return new NullAdapter(modelConfig);
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.ModelAdapter = ModelAdapter;
    window.Live2DAdapter = Live2DAdapter;
    window.ImageAdapter = ImageAdapter;
    window.NullAdapter = NullAdapter;
    window.createModelAdapter = createModelAdapter;
}
