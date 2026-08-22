# PRD-008: Skin Creator MCP and Marketplace Intake

状态：`draft`
目标阶段：`v0.4.x`
父 Epic：[EPIC-008](../epics/EPIC-008-SKIN-UGC-MARKETPLACE.md)

## 1. v0 范围

先交付本地创作协议和可审核上传包，不承诺完整商店、支付或个性化推荐。

## 2. Skin 包契约

```json
{
  "schemaVersion": 1,
  "id": "author.slug",
  "name": "Display name",
  "version": "1.0.0",
  "author": "Author name",
  "license": "CC-BY-4.0",
  "assets": {
    "icon": "icon.png",
    "sprite": "sprite.webp"
  },
  "placement": {
    "islandAnchor": "left",
    "petAnchor": "free"
  },
  "variants": ["light", "dark"],
  "attribution": ""
}
```

必填字段、资源尺寸和帧布局由 validator 固定；缺少字段或无法解码时不得安装。

## 3. 展示规范

- `icon` 是 Island 闭合态左侧的静态形象，必须带透明背景；不能用图片把文字、任务内容或系统 UI 烘焙进去。
- `sprite` 是桌宠可用的像素精灵；即使作者只提供静态图，系统也必须安全回退到 `icon` 或默认千雪。
- AI 创作流程可以由用户提供参考图，再生成像素风候选；工具只生成包内资源，不能从图像推断或上传用户的本地文件、会话内容和身份信息。
- 皮肤不能改变 Island 面板的通知、点击热区或任务状态含义，避免装饰破坏可用性。

## 4. MCP/CLI 工具

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `skin_template` | 风格、尺寸、帧数 | 本地模板目录 |
| `skin_validate` | manifest + 资源目录 | 结构化错误/警告 |
| `skin_preview` | 合规 skin 包 | 本地预览图/动画 |
| `skin_export` | 合规 skin 包 | 可上传 zip + SHA-256 |

MCP server 默认只允许用户选定的 workspace 根目录；不会读取 Agent transcript、环境变量或隐藏目录。

## 5. 上传与审核

1. 客户端在本地完成 validator 和预览。
2. 用户确认作者、许可证和公开范围后上传草稿。
3. 服务端隔离扫描、去元数据、生成缩略图并进入审核队列。
4. 审核通过后生成不可变版本；作者可撤回，安装端保留已安装版本的本地副本。

## 6. 验收

- 非法路径、超限图片、未知 MIME、脚本文件和缺失许可证均被拒绝。
- AI 客户端只需读取 MCP 文档即可完成模板 -> 校验 -> 导出流程。
- 未登录用户仍可使用本地皮肤包；上传是显式操作且可撤销。
