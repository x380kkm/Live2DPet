// audience: internal
// # i18n
// 界面文案查表的单一实现:查当前语言、回退 en、再回退 key。
// 不变量:无行为副作用、无第三方依赖;查不到时退回 en,再退回 key 本身。

export function translate(key, language) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}
