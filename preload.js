const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Pet window
    createPetWindow: (data) => ipcRenderer.invoke('create-pet-window', data),
    closePetWindow: () => ipcRenderer.invoke('close-pet-window'),
    updatePetCharacter: (data) => ipcRenderer.invoke('update-pet-character', data),
    getCharacterData: () => ipcRenderer.invoke('get-character-data'),

    // Window control
    setWindowSize: (w, h) => ipcRenderer.invoke('set-window-size', w, h),
    setWindowPosition: (x, y) => ipcRenderer.invoke('set-window-position', x, y),
    getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
    getWindowPosition: () => ipcRenderer.invoke('get-window-position'),

    // Chat bubble
    showPetChat: (msg, time) => ipcRenderer.invoke('show-pet-chat', msg, time),
    closeChatBubble: () => ipcRenderer.invoke('close-chat-bubble'),
    resizeChatBubble: (w, h) => ipcRenderer.invoke('resize-chat-bubble', w, h),

    // Screen & window detection
    getScreenCapture: () => ipcRenderer.invoke('get-screen-capture'),
    getActiveWindow: () => ipcRenderer.invoke('get-active-window'),

    // Utility
    getGenderTerm: () => ipcRenderer.invoke('get-gender-term'),
    openDevTools: () => ipcRenderer.invoke('open-dev-tools'),
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    showSettings: () => ipcRenderer.invoke('show-settings'),
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-config', data),
    getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
    showPetContextMenu: () => ipcRenderer.invoke('show-pet-context-menu'),

    // Prompt management
    loadPrompt: () => ipcRenderer.invoke('load-prompt'),
    savePrompt: (data) => ipcRenderer.invoke('save-prompt', data),
    resetPrompt: () => ipcRenderer.invoke('reset-prompt'),

    // Emotion system
    triggerExpression: (name) => ipcRenderer.invoke('trigger-expression', name),
    revertExpression: () => ipcRenderer.invoke('revert-expression'),
    triggerMotion: (group, index) => ipcRenderer.invoke('trigger-motion', group, index),
    reportHoverState: (hovering) => ipcRenderer.invoke('report-hover-state', hovering),

    // Model import & scanning (Phase 1)
    selectModelFolder: () => ipcRenderer.invoke('select-model-folder'),
    scanModelInfo: (folder, file) => ipcRenderer.invoke('scan-model-info', folder, file),
    selectStaticImage: () => ipcRenderer.invoke('select-static-image'),
    selectBubbleImage: () => ipcRenderer.invoke('select-bubble-image'),
    selectAppIcon: () => ipcRenderer.invoke('select-app-icon'),
    copyModelToUserdata: (folder, modelName) => ipcRenderer.invoke('copy-model-to-userdata', folder, modelName),
    validateModelPaths: () => ipcRenderer.invoke('validate-model-paths'),
    deleteProfile: (id) => ipcRenderer.invoke('delete-profile', id),

    // Event listeners
    onCharacterUpdate: (cb) => ipcRenderer.on('character-update', (e, data) => cb(data)),
    onPetWindowClosed: (cb) => ipcRenderer.on('pet-window-closed', () => cb()),
    onChatBubbleMessage: (cb) => ipcRenderer.on('chat-bubble-message', (e, data) => cb(data)),
    onShowChatMessage: (cb) => ipcRenderer.on('show-chat-message', (e, data) => cb(data)),
    onSizeChanged: (cb) => ipcRenderer.on('size-changed', (e, size) => cb(size)),
    onPlayExpression: (cb) => ipcRenderer.on('play-expression', (e, name) => cb(name)),
    onRevertExpression: (cb) => ipcRenderer.on('revert-expression', () => cb()),
    onPlayMotion: (cb) => ipcRenderer.on('play-motion', (e, group, index) => cb(group, index)),
    onPetHoverState: (cb) => ipcRenderer.on('pet-hover-state', (e, hovering) => cb(hovering)),
    onModelConfigUpdate: (cb) => ipcRenderer.on('model-config-update', (e, config) => cb(config))
});
