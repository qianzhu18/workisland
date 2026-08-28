const MESSAGES = Object.freeze({
  signaled: "已发送退出指令",
  protected: "这是受保护的进程",
  "identity-changed": "进程已发生变化，请刷新后重试",
  permission: "没有权限退出此进程",
  ended: "进程已经结束",
  failed: "退出失败，请稍后重试"
});

export function performanceActionMessage(result = {}) {
  return MESSAGES[result.reason] || (result.ok ? MESSAGES.signaled : MESSAGES.failed);
}
