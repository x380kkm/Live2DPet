// audience: internal
// # weight-panel
// 设置面板的动作权重子面板:对话总权重与模组总权重两个数,落到全局配置供权重模型分配候选倾向。
// 不变量:以配置数据模型为真相来源;保存时把两值收敛成非负数并入全局配置经网关落盘。

// 对话与模组总权重的缺省值,与 WeightModel 的内置缺省一致。
const DEFAULT_DIALOGUE_WEIGHT = 800;
const DEFAULT_MOD_WEIGHT = 200;

//// 装配动作权重子面板:读配置填两输入,保存把两值并入全局配置落盘 [@x380kkm 2026-06-14] ////
export function mountWeightPanel(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const config = model.config;
  const dialogueInput = doc.getElementById('action-weight-dialogue');
  const modInput = doc.getElementById('action-weight-mod');
  if (dialogueInput) {
    dialogueInput.value = config.actionWeightDialogue != null ? config.actionWeightDialogue : DEFAULT_DIALOGUE_WEIGHT;
  }
  if (modInput) {
    modInput.value = config.actionWeightMod != null ? config.actionWeightMod : DEFAULT_MOD_WEIGHT;
  }

  const button = doc.getElementById('btn-save-weights');
  if (!button) {
    return;
  }
  button.addEventListener('click', async () => {
    const dialogue = normalizeWeight(dialogueInput && dialogueInput.value, DEFAULT_DIALOGUE_WEIGHT);
    const mod = normalizeWeight(modInput && modInput.value, DEFAULT_MOD_WEIGHT);
    config.actionWeightDialogue = dialogue;
    config.actionWeightMod = mod;
    await gateway.config.save({ actionWeightDialogue: dialogue, actionWeightMod: mod });
    showStatus('weight-status', t('status.saved'), 'success');
  });
}
//// /装配动作权重子面板 ////

//// 把输入值收敛成非负数,空或非数或负回缺省 [@x380kkm 2026-06-14] ////
function normalizeWeight(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}
//// /把输入值收敛成非负数 ////

export { DEFAULT_DIALOGUE_WEIGHT, DEFAULT_MOD_WEIGHT };
