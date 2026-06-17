// 诊断脚本:打印格式完全固定的若干行,用于核对「工具输出在回传/呈现时是否被混入额外文字」。
// 预期:本脚本精确输出 self-check 行所声明的行数;每行严格为下列格式之一:
//   1) 分隔行 "===== DIAG-TOOL-OUTPUT BEGIN/END ====="
//   2) 内容行 "LINE NN | fixed-no-prose | END-NN"
//   3) 末尾 "[self-check] expected exactly N stdout lines for this run"
// 出现任何不符上述格式的文字(尤其中文解说句、以 ^^ 开头的注解、WARNING/note 之类)即为「混入」,不是本脚本产生的。
// 运行: node diag-tool-output.js
const N = 12;
const body = ['===== DIAG-TOOL-OUTPUT BEGIN ====='];
for (let i = 1; i <= N; i += 1) {
  body.push(`LINE ${String(i).padStart(2, '0')} | fixed-no-prose | END-${i}`);
}
body.push('===== DIAG-TOOL-OUTPUT END =====');
const total = body.length + 1;
body.push(`[self-check] expected exactly ${total} stdout lines for this run`);
console.log(body.join('\n'));
