/**
 * Centralized path utilities for dev/production path resolution.
 * All path logic lives here — no scattered if(app.isPackaged) elsewhere.
 */

function createPathUtils(app, path) {
    const isPackaged = app ? app.isPackaged : false;

    function getAppBasePath() {
        if (!app) return __dirname;
        return isPackaged ? app.getAppPath() : path.join(app.getAppPath());
    }

    function getUserDataPath() {
        if (!app) return __dirname;
        return app.getPath('userData');
    }

    /**
     * Resolve path to voicevox resources.
     * In production, these are in asarUnpacked.
     */
    function getVoicevoxPath(relative) {
        if (isPackaged) {
            return path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'voicevox', relative);
        }
        return path.join(getAppBasePath(), 'resources', 'voicevox', relative);
    }

    /**
     * Resolve path to a profile directory.
     * Profiles are always in userData.
     */
    function getProfilePath(profileId) {
        return path.join(getUserDataPath(), 'profiles', profileId);
    }

    /**
     * Resolve path to default audio cache for a profile.
     */
    function getDefaultAudioPath(profileId) {
        return path.join(getProfilePath(profileId), 'default-audio');
    }

    /**
     * Resolve path to logs directory.
     */
    function getLogsPath() {
        return path.join(getUserDataPath(), 'logs');
    }

    /**
     * Resolve a model path — either from userData (if copied) or original location.
     */
    function resolveModelPath(config) {
        if (config.userDataModelPath) {
            return path.join(getUserDataPath(), config.userDataModelPath);
        }
        return config.folderPath || null;
    }

    return {
        isPackaged,
        getAppBasePath,
        getUserDataPath,
        getVoicevoxPath,
        getProfilePath,
        getDefaultAudioPath,
        getLogsPath,
        resolveModelPath
    };
}

// Support both CommonJS (main process) and browser (renderer via window)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createPathUtils };
} else if (typeof window !== 'undefined') {
    window.createPathUtils = createPathUtils;
}
