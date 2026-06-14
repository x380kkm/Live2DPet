// audience: internal
// # stdio-channel
// 标准输入输出行协议通道:从输入流逐行读 JSON 命令交处理器,把结果与事件逐行写回输出流。
// 不变量:流经构造注入、不直接抓 process;一行一条 JSON;解析失败回错误行不崩溃;stop 后不再处理。

class StdioChannel {
  //// 构造注入输入输出流与命令处理器 [@busybee 2026-06-14] ////
  // handle(command) 返回一份结果对象;input 为可读流,output 为可写流。
  constructor({ input, output, handle } = {}) {
    this.input = input;
    this.output = output;
    this.handle = handle;
    // 未切到换行的残余输入。
    this._buffer = '';
    this._onData = null;
    this._started = false;
    // 逐行处理的串行尾:把每行的解析与处理串成一条链,保证回应顺序与命令顺序一致。
    this._tail = Promise.resolve();
  }

  //// 开始监听输入,重复启动无副作用 [@busybee 2026-06-14] ////
  start() {
    if (this._started || !this.input) {
      return;
    }
    this._started = true;
    if (typeof this.input.setEncoding === 'function') {
      this.input.setEncoding('utf8');
    }
    this._onData = (chunk) => this._ingest(String(chunk));
    this.input.on('data', this._onData);
    if (typeof this.input.resume === 'function') {
      this.input.resume();
    }
  }
  //// /开始监听输入 ////

  //// 停止监听,重复停止无副作用 [@busybee 2026-06-14] ////
  stop() {
    if (!this._started) {
      return;
    }
    this._started = false;
    if (this._onData && this.input && typeof this.input.removeListener === 'function') {
      this.input.removeListener('data', this._onData);
    }
    this._onData = null;
  }

  //// 把一个对象作为一行 JSON 写到输出流 [@busybee 2026-06-14] ////
  send(obj) {
    if (!this.output || typeof this.output.write !== 'function') {
      return;
    }
    this.output.write(JSON.stringify(obj) + '\n');
  }

  //// 累积输入、按换行切分、逐行串行交解析处理 [@busybee 2026-06-14] ////
  _ingest(text) {
    this._buffer += text;
    let nl;
    while ((nl = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, nl).trim();
      this._buffer = this._buffer.slice(nl + 1);
      if (line) {
        this._tail = this._tail.then(() => this._processLine(line));
      }
    }
  }

  //// 解析一行命令交处理器,解析失败回错误行 [@busybee 2026-06-14] ////
  async _processLine(line) {
    let command;
    try {
      command = JSON.parse(line);
    } catch (error) {
      this.send({ id: null, ok: false, error: `命令不是合法 JSON:${error.message}` });
      return;
    }
    if (!this.handle) {
      return;
    }
    const response = await this.handle(command);
    this.send(response);
  }
}

module.exports = { StdioChannel };
