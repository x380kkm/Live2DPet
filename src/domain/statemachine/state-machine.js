// audience: internal
// # state-machine
// 通用有界状态机:维护当前状态,按输入转移,边界态产出反应事件向事件总线发布。
// 不变量:同一份当前状态既供算法侧步进又供反应侧映射,无额外对齐层。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class StateMachine {
  get current() {
    throw new Error(NOT_IMPLEMENTED);
  }

  transition(input) {
    throw new Error(NOT_IMPLEMENTED);
  }

  onEnter(state) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { StateMachine };
