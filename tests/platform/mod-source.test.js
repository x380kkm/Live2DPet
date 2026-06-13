// audience: internal
// # mod-source.test
// 验证 mod 文件源:逐目录读 JSON 规格、信任级别由目录强制、坏文件与缺目录跳过、缺 id 用文件名兜底。
// 用内存假 fs,不触真实磁盘。

const { test } = require('node:test');
const assert = require('node:assert');
const { createModSource } = require('../../src/platform/mod/mod-source.js');

// 内存假 fs:files 形如 { 'dir/name.json': '内容' };假 path.join 用斜杠拼接。
function makeFakeFs(files) {
  return {
    readdirSync(dir) {
      const prefix = dir + '/';
      const names = Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((n) => !n.includes('/'));
      if (names.length === 0 && !Object.keys(files).some((k) => k.startsWith(prefix))) {
        throw new Error('ENOENT');
      }
      return names;
    },
    readFileSync(p) {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    }
  };
}
const fakePath = { join: (...parts) => parts.join('/') };

//// list 逐目录读规格,信任级别由来源目录强制覆盖文件自报值 [@busybee 2026-06-14] ////
test('createModSource 出厂目录标 Official、用户目录标 UserCustom,文件自报的 trust 被覆盖', () => {
  const fs = makeFakeFs({
    'sys/a.json': JSON.stringify({ id: 'a', emits: ['x'] }),
    // 用户 mod 自报 Official 想冒充出厂,应被来源目录强制改回 UserCustom
    'usr/b.json': JSON.stringify({ id: 'b', trust: 'Official' })
  });
  const source = createModSource({
    dirs: [{ dir: 'sys', trust: 'Official' }, { dir: 'usr', trust: 'UserCustom' }],
    fs, path: fakePath
  });
  const specs = source.list();
  assert.strictEqual(specs.length, 2);
  assert.deepStrictEqual(specs.map((s) => [s.id, s.trust]), [['a', 'Official'], ['b', 'UserCustom']]);
});

test('createModSource 缺 id 时用文件名兜底,非 json 与坏 json 跳过', () => {
  const fs = makeFakeFs({
    'sys/click.json': JSON.stringify({ emits: ['click'] }),
    'sys/readme.txt': 'not json',
    'sys/broken.json': '{ not valid'
  });
  const source = createModSource({ dirs: [{ dir: 'sys', trust: 'Official' }], fs, path: fakePath });
  const specs = source.list();
  assert.strictEqual(specs.length, 1);
  assert.strictEqual(specs[0].id, 'click');
});

test('createModSource 缺目录返回空、不抛', () => {
  const fs = makeFakeFs({ 'sys/a.json': JSON.stringify({ id: 'a' }) });
  const source = createModSource({ dirs: [{ dir: 'missing', trust: 'Official' }], fs, path: fakePath });
  assert.deepStrictEqual(source.list(), []);
});
//// /list 逐目录读规格 ////
