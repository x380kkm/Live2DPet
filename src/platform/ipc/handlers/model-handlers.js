// audience: internal
// # model-handlers
// 模型文件夹扫描、参数映射建议、文件选择与导入,产出按通道名索引的处理器表供 ipc-router 注册。
// 迁移自 src/main/model-import.js,去掉对全局 ctx 的依赖,文件存储改异步、经构造注入。
//
// 构造注入的协作者都只是窄接口,第三方类型(dialog、fs、path)留在装配处:
//   picker   弹选择框,异步:pickDirectory({title})/pickFile({title,filters}) 返回 { canceled, paths }
//   files    文件系统窄接口,异步:listDir(dir)/readJson(p)/exists(p)/isDirectory(p)/
//            copyFile(src,dest)/copyDir(src,dest)/removeDir(p);同步纯路径助手 join/extname/basename
//   config   读当前配置,异步:read() 返回含 model 字段的配置快照
//   paths    路径根,userDataDir() 返回可写数据目录绝对路径
//   mt       取一个翻译串,用于选择框标题与错误文案
//
// 处理器形参 payload 沿用 ipc-router 约定:单参通道收到值本身,多参通道收到参数数组。

const { isValidUUID } = require('../../../main/validators');

//// 渲染参数到常见模型参数 id 的模糊候选表:扫描时据它给映射建议 [@busybee 2026-06-13] ////
const PARAM_FUZZY_MAP = {
  angleX:     ['ParamAngleX', 'ParamX', 'Angle_X', 'PARAM_ANGLE_X', 'AngleX'],
  angleY:     ['ParamAngleY', 'ParamY', 'Angle_Y', 'PARAM_ANGLE_Y', 'AngleY'],
  angleZ:     ['ParamAngleZ', 'ParamZ', 'Angle_Z', 'PARAM_ANGLE_Z', 'AngleZ'],
  bodyAngleX: ['ParamBodyAngleX', 'BodyAngleX', 'PARAM_BODY_ANGLE_X', 'ParamBodyX'],
  eyeBallX:   ['ParamEyeBallX', 'EyeBallX', 'PARAM_EYE_BALL_X', 'ParamEyeX'],
  eyeBallY:   ['ParamEyeBallY', 'EyeBallY', 'PARAM_EYE_BALL_Y', 'ParamEyeY']
};

//// 按模糊候选表把模型暴露的参数 id 匹配成渲染参数建议,无匹配填 null [@busybee 2026-06-13] ////
function suggestParamMapping(parameterIds) {
  const suggested = {};
  for (const [key, candidates] of Object.entries(PARAM_FUZZY_MAP)) {
    const match = candidates.find((c) =>
      parameterIds.some((p) => p.toLowerCase() === c.toLowerCase())
    );
    suggested[key] = match
      ? parameterIds.find((p) => p.toLowerCase() === match.toLowerCase())
      : null;
  }
  return suggested;
}

//// 装配模型处理器:取注入的窄接口,返回按通道名索引的处理器表 [@busybee 2026-06-13] ////
function createModelHandlers(deps) {
  const { picker, files, config, paths, mt } = deps;

  //// 在一个目录里找含 model3.json 的实际模型目录:本层没有就下探一层子目录 [@busybee 2026-06-13] ////
  async function locateModelFolder(folderPath) {
    const entries = await files.listDir(folderPath);
    const here = entries.filter((f) => f.endsWith('.model3.json'));
    if (here.length > 0) return { folder: folderPath, modelFiles: here };
    for (const sub of entries) {
      const subPath = files.join(folderPath, sub);
      if (!(await files.isDirectory(subPath))) continue;
      const subEntries = await files.listDir(subPath);
      const subModels = subEntries.filter((f) => f.endsWith('.model3.json'));
      if (subModels.length > 0) return { folder: subPath, modelFiles: subModels };
    }
    return { folder: folderPath, modelFiles: [] };
  }

  //// 选模型文件夹:下探定位含 model3.json 的目录,找不到报错 [@busybee 2026-06-13] ////
  async function selectModelFolder() {
    const picked = await picker.pickDirectory({ title: mt('main.selectL2d') });
    if (picked.canceled || !picked.paths.length) return { success: false, error: 'cancelled' };
    const located = await locateModelFolder(picked.paths[0]);
    if (located.modelFiles.length === 0) return { success: false, error: mt('main.noModel3Json') };
    return { success: true, folderPath: located.folder, modelFiles: located.modelFiles };
  }

  //// 扫一张 model3.json:汇总参数 id、表情、动作、命中区与资源校验 [@busybee 2026-06-13] ////
  async function scanModelInfo(folderPath, modelJsonFile) {
    const modelJsonPath = files.join(folderPath, modelJsonFile);
    if (!(await files.exists(modelJsonPath))) return { success: false, error: mt('main.model3NotExist') };
    const modelJson = await files.readJson(modelJsonPath);

    const parameterIds = await collectParameterIds(modelJson, folderPath);
    const expressions = await collectExpressions(modelJson, folderPath);
    const motions = await collectMotions(modelJson, folderPath);
    const hitAreas = modelJson.HitAreas || [];
    const validation = await validateResources(modelJson, folderPath);

    return {
      success: true,
      modelName: modelJsonFile.replace('.model3.json', ''),
      parameterIds, suggestedMapping: suggestParamMapping(parameterIds),
      expressions, motions, hitAreas, validation
    };
  }

  //// 从 Groups 与 cdi3.json 汇总并去重参数 id [@busybee 2026-06-13] ////
  async function collectParameterIds(modelJson, folderPath) {
    const ids = [];
    if (modelJson.Groups) {
      modelJson.Groups.forEach((g) => { if (g.Ids) ids.push(...g.Ids); });
    }
    const cdiFile = modelJson.FileReferences && modelJson.FileReferences.DisplayInfo;
    if (cdiFile) {
      const cdiPath = files.join(folderPath, cdiFile);
      if (await files.exists(cdiPath)) {
        const cdi = await files.readJson(cdiPath);
        if (cdi && Array.isArray(cdi.Parameters)) ids.push(...cdi.Parameters.map((p) => p.Id));
      }
    }
    return [...new Set(ids)];
  }

  //// 取表情:先读 model3.json 声明,没有就扫目录里的 exp3.json [@busybee 2026-06-13] ////
  async function collectExpressions(modelJson, folderPath) {
    const declared = modelJson.FileReferences && modelJson.FileReferences.Expressions;
    if (declared) return declared.map((e) => ({ name: e.Name, file: e.File }));
    const entries = await files.listDir(folderPath);
    return entries.filter((f) => f.endsWith('.exp3.json'))
      .map((f) => ({ name: f.replace('.exp3.json', ''), file: f }));
  }

  //// 取动作:先读 model3.json 声明,没有就把目录里的 motion3.json 归到 Default 组 [@busybee 2026-06-13] ////
  async function collectMotions(modelJson, folderPath) {
    const declared = modelJson.FileReferences && modelJson.FileReferences.Motions;
    if (declared) {
      const motions = {};
      for (const [group, entries] of Object.entries(declared)) {
        motions[group] = (entries || []).map((e) => ({ file: e.File }));
      }
      return motions;
    }
    const entries = await files.listDir(folderPath);
    const motionFiles = entries.filter((f) => f.endsWith('.motion3.json'));
    return motionFiles.length > 0 ? { Default: motionFiles.map((f) => ({ file: f })) } : {};
  }

  //// 校验 moc 与贴图文件都在位 [@busybee 2026-06-13] ////
  async function validateResources(modelJson, folderPath) {
    const refs = modelJson.FileReferences || {};
    let mocValid = false;
    if (refs.Moc) mocValid = await files.exists(files.join(folderPath, refs.Moc));
    let texturesValid = false;
    if (refs.Textures) {
      texturesValid = true;
      for (const t of refs.Textures) {
        if (!(await files.exists(files.join(folderPath, t)))) { texturesValid = false; break; }
      }
    }
    return { mocValid, texturesValid };
  }

  //// 选一张静态图片 [@busybee 2026-06-13] ////
  async function selectStaticImage() {
    const picked = await picker.pickFile({
      title: mt('main.selectImage'),
      filters: [{ name: mt('main.filterImage'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    });
    if (picked.canceled || !picked.paths.length) return { success: false, error: 'cancelled' };
    return { success: true, filePath: picked.paths[0] };
  }

  //// 选一个图片文件夹 [@busybee 2026-06-13] ////
  async function selectImageFolder() {
    const picked = await picker.pickDirectory({ title: mt('main.selectImageFolder') });
    if (picked.canceled || !picked.paths.length) return { success: false, error: 'cancelled' };
    return { success: true, folderPath: picked.paths[0] };
  }

  //// 扫一个图片文件夹,列出受支持扩展名的图片 [@busybee 2026-06-13] ////
  async function scanImageFolder(folderPath) {
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp'];
    const entries = await files.listDir(folderPath);
    const images = entries
      .filter((f) => imageExts.includes(files.extname(f).toLowerCase()))
      .map((f) => ({ filename: f, path: files.join(folderPath, f) }));
    return { success: true, images };
  }

  //// 选一张气泡框图片 [@busybee 2026-06-13] ////
  async function selectBubbleImage() {
    const picked = await picker.pickFile({
      title: mt('main.selectBubble'),
      filters: [{ name: mt('main.filterImage'), extensions: ['png', 'jpg', 'jpeg', 'svg'] }]
    });
    if (picked.canceled || !picked.paths.length) return { success: false, error: 'cancelled' };
    return { success: true, filePath: picked.paths[0] };
  }

  //// 选一张应用图标并复制进用户数据目录 [@busybee 2026-06-13] ////
  async function selectAppIcon() {
    const picked = await picker.pickFile({
      title: mt('main.selectIcon'),
      filters: [{ name: mt('main.filterIcon'), extensions: ['png', 'ico', 'jpg'] }]
    });
    if (picked.canceled || !picked.paths.length) return { success: false, error: 'cancelled' };
    const srcPath = picked.paths[0];
    const destPath = files.join(paths.userDataDir(), 'app-icon' + files.extname(srcPath));
    await files.copyFile(srcPath, destPath);
    return { success: true, iconPath: destPath };
  }

  //// 把模型目录复制进用户数据目录的 models 下,返回相对与绝对路径 [@busybee 2026-06-13] ////
  async function copyModelToUserData(folderPath, modelName) {
    const dirName = modelName || files.basename(folderPath);
    const destDir = files.join(paths.userDataDir(), 'models', dirName);
    await files.copyDir(folderPath, destDir);
    return { success: true, userDataModelPath: files.join('models', dirName), absolutePath: destDir };
  }

  //// 校验当前配置里的模型路径是否仍可用,按模型类型分别判定 [@busybee 2026-06-13] ////
  async function validateModelPaths() {
    const cfg = await config.read();
    const model = (cfg && cfg.model) || {};
    if (model.type === 'none') return { success: true, valid: true, type: 'none' };

    if (model.type === 'live2d') {
      const modelDir = model.userDataModelPath
        ? files.join(paths.userDataDir(), model.userDataModelPath)
        : model.folderPath;
      if (!modelDir || !(await files.exists(modelDir))) {
        return { success: true, valid: false, error: mt('main.modelFolderNotExist') };
      }
      if (model.modelJsonFile) {
        const jsonPath = files.join(modelDir, model.modelJsonFile);
        if (!(await files.exists(jsonPath))) {
          return { success: true, valid: false, error: mt('main.model3NotExist') };
        }
        try { await files.readJson(jsonPath); }
        catch { return { success: true, valid: false, error: mt('main.model3ParseFail') }; }
      }
      return { success: true, valid: true, type: 'live2d', modelDir };
    }

    if (model.type === 'image') {
      if (model.imageFolderPath) {
        if (!(await files.exists(model.imageFolderPath))) {
          return { success: true, valid: false, error: mt('main.imageNotExist') };
        }
        return { success: true, valid: true, type: 'image' };
      }
      if (!model.staticImagePath || !(await files.exists(model.staticImagePath))) {
        return { success: true, valid: false, error: mt('main.imageNotExist') };
      }
      return { success: true, valid: true, type: 'image' };
    }

    return { success: true, valid: true, type: model.type };
  }
  //// /校验当前配置里的模型路径是否仍可用 ////

  //// 删一个外观档:校验 id 后递归删除其目录 [@busybee 2026-06-13] ////
  async function deleteProfile(profileId) {
    if (!isValidUUID(profileId)) return { success: false, error: 'invalid profile ID' };
    const profileDir = files.join(paths.userDataDir(), 'profiles', profileId);
    if (await files.exists(profileDir)) await files.removeDir(profileDir);
    return { success: true };
  }

  return {
    'select-model-folder': () => selectModelFolder(),
    'scan-model-info': (payload) => scanModelInfo(payload[0], payload[1]),
    'select-static-image': () => selectStaticImage(),
    'select-image-folder': () => selectImageFolder(),
    'scan-image-folder': (payload) => scanImageFolder(payload),
    'select-bubble-image': () => selectBubbleImage(),
    'select-app-icon': () => selectAppIcon(),
    'copy-model-to-userdata': (payload) => copyModelToUserData(payload[0], payload[1]),
    'validate-model-paths': () => validateModelPaths(),
    'delete-profile': (payload) => deleteProfile(payload)
  };
}

module.exports = { createModelHandlers, suggestParamMapping, PARAM_FUZZY_MAP };
