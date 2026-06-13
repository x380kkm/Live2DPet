// audience: internal
// # recent-replies-source.test
// 运行: node --test tests/domain/sources/recent-replies-source.test.js
// 验证近期回复源契约:id 取引用名、检出各重复模式折成反重复提示、不足两条或无模式返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { RecentRepliesSource } = require('../../../src/domain/pet/sources/recent-replies-source');

test('id 默认取意图引用名 recentReplies 且为上下文源', () => {
  const source = new RecentRepliesSource({ recentRepliesProvider: () => [] });
  assert.strictEqual(source.id, 'recentReplies');
  assert.ok(source instanceof ContextSource);
});

test('render 少于两条回复返回 null', () => {
  const source = new RecentRepliesSource({ recentRepliesProvider: () => ['只有一条'] });
  assert.strictEqual(source.render({}), null);
});

test('render 检出反复发问', () => {
  const source = new RecentRepliesSource({
    recentRepliesProvider: () => ['今天过得怎么样?', '在忙什么呢?']
  });
  assert.strictEqual(source.render({}), '近期回复重复:反复发问');
});

test('render 检出开头雷同', () => {
  const source = new RecentRepliesSource({
    recentRepliesProvider: () => ['嘿呀今天天气好。', '嘿呀又见面了。']
  });
  assert.strictEqual(source.render({}), '近期回复重复:开头雷同');
});

test('render 检出叹号过多', () => {
  const source = new RecentRepliesSource({
    recentRepliesProvider: () => ['太棒了!', '真好!', '厉害!']
  });
  // 叹号在三条里各一,计三次触发叹号过多。
  const rendered = source.render({});
  assert.ok(rendered.includes('叹号过多'));
});

test('render 无重复模式返回 null', () => {
  const source = new RecentRepliesSource({
    recentRepliesProvider: () => ['第一句独特的话语在此处。', '另起一段完全不同长短的回复内容更长一些。']
  });
  assert.strictEqual(source.render({}), null);
});

test('render 只取最近 lookback 条参与检测', () => {
  const source = new RecentRepliesSource(
    { recentRepliesProvider: () => ['很久以前的?', '甲句独特内容在此。', '乙段迥异更长的回复内容在此处。'] },
    { lookback: 2 }
  );
  // 只看最近两条:开头结尾长短各异且无问号,不触发任何模式。
  assert.strictEqual(source.render({}), null);
});

test('render 可经配置覆盖模式标签', () => {
  const source = new RecentRepliesSource(
    { recentRepliesProvider: () => ['同样的?', '一样的?'] },
    { labels: { shell: 'avoid: {0}', question: 'questions' } }
  );
  assert.strictEqual(source.render({}), 'avoid: questions');
});

test('render 缺取数函数返回 null', () => {
  const source = new RecentRepliesSource({});
  assert.strictEqual(source.render({}), null);
});

test('estimateTokens 无可检模式为 0', () => {
  const source = new RecentRepliesSource({
    recentRepliesProvider: () => ['独特内容甲在此。', '迥异内容乙更长更不一样在此处呢。']
  });
  assert.strictEqual(source.estimateTokens({}), 0);
});
