// audience: internal
// # prompt-composer
// 提示词组装器:接 few-shot 解析器与已组装上下文,按 token 预算裁剪样例轮次,组装成结构化的 LLM 请求。
// 不变量:人格文本经构造注入、不内联在本文件;few-shot 样例只在角色文风下解析,跨角色不借文风。
// 不变量:组装只搭结构,不写成品措辞;上下文与样例各占独立预算,样例超预算时按优先序丢最低优先的。
//
// 依赖经构造注入:fewShotResolver.resolve(refs, characterId) 产出样例轮次;
// persona 为角色人格纯数据,形如 { responseMode?, description?, personality?, scenario?, rules?,
//   importantReminder?, language?, useLanguageTemplate? },字段缺省即略过,迁移自 core/prompt-builder。
// estimateTokens(text) 粗估文本 token 数,缺省按字符数粗估;fewShotBudget 为样例轮次的 token 预算上限。
//
// compose(intent, context, scope) 收已组装上下文与意图,产出 { messages };
// scope.characterId 决定 few-shot 取哪个角色的语气;context.text 为组装器已按预算裁好的上下文片段。

//// 按字符数粗估文本 token 数:无文本计零 [@busybee 2026-06-13] ////
// 与 context-source 同口径:每 4 字符约一个 token,向上取整避免低估。
function estimateTextTokensByChars(text) {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

class PromptComposer {
  //// 构造注入 few-shot 解析器、人格数据、token 估算与样例预算 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    this.fewShotResolver = deps.fewShotResolver;
    this.persona = deps.persona || {};
    this.estimateTokens = deps.estimateTokens || estimateTextTokensByChars;
    // 样例轮次的 token 预算上限;缺省不限,超预算时按原序丢末尾轮次。
    this.fewShotBudget = config.fewShotBudget;
  }
  //// /构造注入 few-shot 解析器、人格数据、token 估算与样例预算 ////

  //// 把已组装上下文与意图拼成结构化 LLM 请求 [@busybee 2026-06-13] ////
  // 消息序:人格与上下文合成的系统提示在前,角色文风样例轮次居中,意图指令收尾。
  compose(intent, context, scope) {
    const characterId = (scope && scope.characterId) || '';
    const contextText = (context && context.text) || '';

    const messages = [];
    messages.push({ role: 'system', content: this._buildSystemContent(contextText) });

    const fewShotTurns = this._resolveFewShot(intent, characterId);
    for (const turn of fewShotTurns) {
      messages.push(turn);
    }

    messages.push({ role: 'user', content: this._buildIntentInstruction(intent, scope) });
    return { messages };
  }
  //// /把已组装上下文与意图拼成结构化 LLM 请求 ////

  //// 把人格各段与已组装上下文折成一段系统提示,缺字段即略过 [@busybee 2026-06-13] ////
  // 段序迁移自 core/prompt-builder.buildSystemPrompt:回应模式、人物设定、规则、上下文、语言指令。
  _buildSystemContent(contextText) {
    const persona = this.persona;
    const parts = [];

    if (persona.responseMode) parts.push(persona.responseMode);
    if (persona.description) parts.push(persona.description);
    if (persona.personality) parts.push(persona.personality);
    if (persona.scenario) parts.push(persona.scenario);

    // 规则段与人物设定以分隔线隔开,再叠一句重点提醒,守住规则不被设定淹没。
    if (persona.rules) {
      parts.push('---');
      parts.push(persona.rules);
      if (persona.importantReminder) parts.push(persona.importantReminder);
    }

    // 动态上下文排在规则之后并以分隔线隔开,使模型先记住人格与规则再看当下态势。
    if (contextText) {
      parts.push('---');
      parts.push(contextText);
    }

    if (persona.language) {
      const template = persona.useLanguageTemplate || '{0}';
      parts.push(template.replace('{0}', persona.language));
    }

    return parts.join('\n\n');
  }
  //// /把人格各段与已组装上下文折成一段系统提示 ////

  //// 经解析器取本角色的 few-shot 样例轮次,按预算裁剪 [@busybee 2026-06-13] ////
  // 解析器在角色文风下产出 { role, content } 轮次;无解析器或无引用时返回空。
  _resolveFewShot(intent, characterId) {
    if (!this.fewShotResolver) {
      return [];
    }
    const refs = (intent && intent.fewShotRefs) || [];
    const turns = this.fewShotResolver.resolve(refs, characterId);
    return this._trimToBudget(turns);
  }
  //// /经解析器取本角色的 few-shot 样例轮次 ////

  //// 按 token 预算从前往后累加样例轮次,超预算则丢其后全部轮次 [@busybee 2026-06-13] ////
  // 样例已按解析顺序排好优先级,前面的更代表性;预算未给定时全数保留。
  _trimToBudget(turns) {
    if (this.fewShotBudget === undefined) {
      return turns;
    }
    const kept = [];
    let usedTokens = 0;
    for (const turn of turns) {
      const tokens = this.estimateTokens(turn.content);
      if (usedTokens + tokens > this.fewShotBudget) {
        break;
      }
      usedTokens += tokens;
      kept.push(turn);
    }
    return kept;
  }
  //// /按 token 预算从前往后累加样例轮次 ////

  //// 把意图与当前态势压成一行收尾指令,只搭结构不写成品措辞 [@busybee 2026-06-13] ////
  // 态势摘要随作用域而来;意图只给 id,让模型据上文与样例产出本意图下的一句发言。
  _buildIntentInstruction(intent, scope) {
    const intentId = (intent && intent.id) || '';
    const situation = (scope && scope.situationDigest) || '';
    const parts = [];
    if (situation) parts.push(situation);
    parts.push(`按意图 ${intentId} 与以上上下文产出一句角色发言。`);
    return parts.join('\n');
  }
  //// /把意图与当前态势压成一行收尾指令 ////
}

module.exports = { PromptComposer, estimateTextTokensByChars };
