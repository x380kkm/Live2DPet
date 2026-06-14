// audience: internal
// # pack-test-runner
// 打包版无人实测运行器:起本地桩 LLM,带自动化与自动启动开关拉起打包后的可执行文件,经标准输入输出行协议
// 驱动一轮,断言四窗建起、能跑一拍、产出并记下台词、TTS 通路可达,最后干净收场。
// 不在 node --test 默认套里跑(无 .test.js 后缀):依赖已构建的可执行文件、要起窗口、耗时较长,显式调用。
// 运行: node tests/pack/pack-test-runner.js [可执行文件路径]

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { startMockLlm } = require('./mock-llm-server');

// 拉起到断言完成的硬上限,超时即判失败收场,避免遗留窗口。
const HARD_TIMEOUT_MS = 60000;
// 等单条命令回应或某事件出现的上限。
const STEP_TIMEOUT_MS = 20000;

//// 解析打包后可执行文件路径:命令行优先,否则取约定的 win-unpacked 产物 [@busybee 2026-06-14] ////
function resolveExe() {
  const fromArg = process.argv[2];
  if (fromArg) {
    return path.resolve(fromArg);
  }
  return path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Live2DPet.exe');
}
//// /解析打包后可执行文件路径 ////

//// 把子进程标准输出按行解析成 JSON,分流成事件与命令回应 [@busybee 2026-06-14] ////
// 命令回应有 id,事件有 event;非 JSON 行(诊断日志)忽略。
function makeLineReader(onResponse, onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        continue;
      }
      if (parsed.event) {
        onEvent(parsed);
      } else if (parsed.id !== undefined) {
        onResponse(parsed);
      }
    }
  };
}
//// /把子进程标准输出按行解析成 JSON ////

//// 等一个条件成立或超时,周期性轮询 [@busybee 2026-06-14] ////
function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待超时:${label}`));
      }
    }, 100);
  });
}
//// /等一个条件成立或超时 ////

//// 主流程:起桩、拉起、连套接字、驱动、断言、收场 [@busybee 2026-06-14] ////
async function main() {
  const exe = resolveExe();
  if (!fs.existsSync(exe)) {
    throw new Error(`未找到打包可执行文件:${exe}(先跑 npm run build:dir)`);
  }

  const mock = await startMockLlm();
  const events = [];
  const responses = new Map();
  let nextId = 1;
  let listenPort = null;
  let socket = null;

  const child = spawn(exe, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LIVE2DPET_AUTOMATION: '1',
      LIVE2DPET_AUTOLAUNCH: '1',
      LIVE2DPET_API_KEY: 'mock-key',
      LIVE2DPET_BASE_URL: mock.url,
      LIVE2DPET_MODEL: 'mock-model',
      LIVE2DPET_PRESET: 'openai-chat'
    }
  });

  const stderrLines = [];
  child.stderr.on('data', (chunk) => stderrLines.push(chunk.toString()));
  // 标准输出只用来发现自动化套接字端口;命令与转发事件都走套接字。
  child.stdout.on('data', makeLineReader(
    () => {},
    (event) => { if (event.event === 'automation-listening') listenPort = event.port; }
  ));

  //// 发一条命令,等到对应 id 的回应 [@busybee 2026-06-14] ////
  const send = async (op, args) => {
    const id = nextId++;
    socket.write(JSON.stringify({ id, op, args: args || {} }) + '\n');
    await waitFor(() => responses.has(id), STEP_TIMEOUT_MS, `命令回应 ${op}`);
    const response = responses.get(id);
    if (!response.ok) {
      throw new Error(`命令 ${op} 失败:${response.error}`);
    }
    return response.result;
  };

  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? '通过' : '失败'} ${name}${detail ? ' :: ' + detail : ''}`);
  };

  const hardTimer = setTimeout(() => {
    console.error('达到硬超时,强制收场');
    try { child.kill('SIGKILL'); } catch (error) { /* 子进程已退出 */ }
  }, HARD_TIMEOUT_MS);

  try {
    // 标准输出回报套接字端口后连上去
    await waitFor(() => listenPort !== null, STEP_TIMEOUT_MS, '套接字端口回报');
    socket = net.connect(listenPort, '127.0.0.1');
    socket.setEncoding('utf8');
    socket.on('data', makeLineReader(
      (response) => responses.set(response.id, response),
      (event) => events.push(event)
    ));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    // 等自动化通道就绪事件
    await waitFor(() => events.some((e) => e.event === 'automation-ready'), STEP_TIMEOUT_MS, '自动化就绪');
    record('自动化通道就绪', true);

    // 健康检查
    const pong = await send('ping');
    record('ping 回 pong', pong && pong.pong === true);

    // 四窗建起:自动启动应建出宠物、气泡、mod 前端、设置四窗
    const windows = (await send('list-windows')).windows || [];
    const byName = Object.fromEntries(windows.map((w) => [w.name, w]));
    const expected = ['pet', 'bubble', 'modFrontend', 'settings'];
    const present = expected.filter((n) => byName[n]);
    record('四类窗口都在快照里', present.length === expected.length, `在场:${present.join('、')}`);
    record('宠物与气泡窗存活', Boolean(byName.pet && byName.pet.alive && byName.bubble && byName.bubble.alive));

    // 驱动一拍:决策器经桩模型选意图产台词
    const tick = await send('schedule-tick');
    record('调度跑通一拍', tick && tick.ticked === true);

    // 产出并记下台词:轮询近期发言或等产物事件
    await waitFor(
      () => events.some((e) => e.event === 'UtteranceProduced'),
      STEP_TIMEOUT_MS,
      '发言产物事件'
    ).catch(() => {});
    const replies = (await send('fetch-recent-reply', { count: 3 })).replies || [];
    record('产出并记下至少一条台词', replies.length > 0, `近期发言数:${replies.length}`);

    // TTS 通路:有 voicevox 资源则应出音频,无则记软通过不判失败
    const tts = await send('trigger-tts', { text: 'こんにちは' });
    if (tts.hasAudio) {
      record('TTS 合成出音频', tts.bytes > 0, `字节:${tts.bytes}`);
    } else {
      record('TTS 通路可达(本机无语音资源,软通过)', true, tts.error || '无音频');
    }

    // 无崩溃:标准错误里不应出现未捕获异常标记
    const crashed = stderrLines.join('').match(/Uncaught|未捕获|FATAL|app crashed/i);
    record('运行期无崩溃标记', !crashed, crashed ? crashed[0] : '');
  } finally {
    clearTimeout(hardTimer);
    try { if (socket) socket.destroy(); } catch (error) { /* 已关闭 */ }
    try { child.kill('SIGTERM'); } catch (error) { /* 已退出 */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { child.kill('SIGKILL'); } catch (error) { /* 已退出 */ }
    await mock.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n断言 ${checks.length} 项,通过 ${checks.length - failed.length} 项,失败 ${failed.length} 项。`);
  console.log(`桩模型被调用 ${mock.requests()} 次。`);
  return failed.length === 0;
}
//// /主流程 ////

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error('运行器异常:', error && error.stack ? error.stack : error);
    process.exit(2);
  });
