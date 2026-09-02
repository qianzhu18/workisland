# Developer API（B-9）

WorkIsland 提供一个**只读**的本地 HTTP 状态端点，供脚本、菜单栏工具、面板等第三方集成使用。
对标 Notchy 的 `127.0.0.1:9999` 开发者接口。

## 开关

设置 → 关于 WorkIsland → **开发者 API**：

- 默认**关闭**；开启后仅监听 `127.0.0.1`（loopback），外部机器无法访问。
- 可选配置**访问令牌**：填写后，请求必须携带 `Authorization: Bearer <token>` 头（或 `?token=<token>` 查询参数），否则返回 `401`。
- 端口默认 `9938`。

## 端点

### `GET /api/status`

```json
{
  "ok": true,
  "app": "WorkIsland",
  "version": "1.3.0-beta.1",
  "platform": "darwin",
  "sessions": [
    {
      "id": "sess_01J8...",
      "agent": "claude",
      "phase": "running",
      "startedAt": 1725300000000,
      "updatedAt": 1725300123456
    }
  ],
  "generatedAt": "2026-09-03T04:40:00.000Z"
}
```

`phase` 取值与岛内会话状态一致：`running / waitingForApproval / waitingForAnswer / completed / failed` 等。

### 隐私边界

响应**只包含会话状态元数据**（会话 id、Agent 名、阶段、时间戳），不包含 prompt、
transcript、文件路径、审批内容或用量明细。时间戳为 Unix 毫秒。

### 其它路径

一律返回 `404 {"ok":false,"error":"not_found"}`。
