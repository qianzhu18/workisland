# WorkIsland AI 自定义接口手册

> 面向对象:运行在用户 Mac 上的 AI Agent(Claude Code、Codex、Cursor、ZCode 等)以及脚本作者。
> 目标:仅凭本文档即可完成 WorkIsland 灵动岛背景与桌宠角色的自动化自定义,无需其他上下文。
> 版本:v1(随 WorkIsland 3.2.0 引入)。协议与字段以本文档为准。

---

## 1. 你能做什么

WorkIsland 是一款本地优先的 macOS Agent 任务监控器(灵动岛 + 桌宠)。本接口允许你:

| 能力 | 说明 |
| --- | --- |
| 读取当前外观 | 岛屿主题、当前桌宠、缩放、已安装背景图 |
| 设置岛屿背景 | 纯色 / 双色渐变(含角度、透明度)/ 背景图片 |
| 恢复默认 | 一键回到经典纯黑岛屿 |
| 列出桌宠 | 内置、`~/.codex/pets` 发现、用户安装、程序化 Echo |
| 安装桌宠精灵图 | 校验几何尺寸后落入用户目录,默认立即启用 |
| 切换桌宠 | 按标识切换,运行中实时换图 |
| 校验精灵图 | 返回几何检测结果,支撑"生成 → 校验 → 重试"闭环 |

**边界(不可绕过)**:状态色(运行蓝/待审批橙/完成绿等)与面板交互热区不属于本接口;过亮的背景会被自动压暗(见 §4.3);所有操作仅在本机 Unix socket 上进行,无任何网络端口。

## 2. 前置条件与 CLI 定位

WorkIsland 必须正在运行(菜单栏有岛/桌宠)。CLI 通过本地 socket `~/.flux/run/bridge.sock` 通信。

**安装版(DMG 安装)**,推荐调用方式:

```bash
ELECTRON_RUN_AS_NODE=1 \
  '/Applications/WorkIsland.app/Contents/MacOS/WorkIsland' \
  '/Applications/WorkIsland.app/Contents/Resources/bin/workisland-cli' \
  appearance get
```

建议在你的 shell 里做一次性发现与别名:

```bash
WI_CLI_SHIM='/Applications/WorkIsland.app/Contents/Resources/bin/workisland-cli'
WI_APP='/Applications/WorkIsland.app/Contents/MacOS/WorkIsland'
alias workisland-cli="ELECTRON_RUN_AS_NODE=1 '$WI_APP' '$WI_CLI_SHIM'"
```

**开发版(源码仓库)**:

```bash
node <repo>/src/island/workisland-cli/index.cjs appearance get
```

**随时自举**:`workisland-cli manual` 会输出本手册全文(安装版读取打包资源,开发版读取仓库 `docs/AI-CUSTOMIZATION.md`;都缺失时输出内嵌简版)。你不需要记住本手册内容,发现二进制后执行 `manual` 即可。

环境变量:`FLUX_SOCKET_PATH` 覆盖 socket 路径;`WORKISLAND_MANUAL_PATH` 覆盖手册路径;`--socket <path>` 参数优先级最高。

## 3. 命令参考

所有成功输出都是 `JSON`(stdout,含 `"ok": true`);失败输出 `JSON`(stderr,含 `"ok": false` 与 `error`)。

### 3.1 appearance — 岛屿背景

```bash
# 读取当前外观(含可用背景图列表)
workisland-cli appearance get

# 设置纯色(透明度可选 0.15–1,默认 1)
workisland-cli appearance set --json '{"kind":"solid","color":"#0B1E3A","opacity":1}'

# 设置双色渐变(angle 0–360,默认 135)
workisland-cli appearance set --json '{"kind":"gradient","color":"#1F1330","color2":"#0B0716","angle":135,"opacity":1}'

# 安装背景图并启用(imageDim 为压暗遮罩 0.2–0.85,默认 0.35)
workisland-cli appearance set --image /path/to/bg.png --json '{"kind":"image","imageDim":0.4}'

# 复用已安装的背景图(imageRef 来自 appearance get 的 availableBackgrounds)
workisland-cli appearance set --json '{"kind":"image","imageRef":"bg-3f2a….png","imageDim":0.4}'

# 从文件或管道读取主题 JSON
workisland-cli appearance set --file theme.json
cat theme.json | workisland-cli appearance set

# 恢复默认纯黑
workisland-cli appearance reset
```

`set` 成功返回归一化后的主题与警告(如自动压暗提示):

```json
{
  "ok": true,
  "appearance": { "kind": "solid", "color": "#0b1e3a", "opacity": 1 },
  "warnings": []
}
```

### 3.2 pet — 桌宠

```bash
# 列出全部可用桌宠(含 current 当前值)
workisland-cli pet list

# 切换:<文件名.png/webp> | codex:<名称> | echo:little
workisland-cli pet set my-pet.webp

# 安装精灵图(默认安装后立即启用;--no-select 只装不切)
workisland-cli pet install /path/to/sprite.webp --name my-pet
```

`pet install` 返回校验结果(协议、尺寸);几何不合规会以**校验错误**拒绝安装——请按 §5 规格重新生成后重试。

### 3.3 validate — 精灵图几何校验(不安装)

```bash
workisland-cli validate /path/to/sprite.webp
```

成功示例:

```json
{
  "ok": true,
  "protocol": "codex-v2",
  "width": 1536, "height": 2288,
  "expected": { "width": 1536, "height": 2288, "columns": 8, "rows": 11, "cellWidth": 192, "cellHeight": 208 },
  "message": "符合 Codex V2(1536×2288,8 列 × 11 行,cell 192×208)"
}
```

失败示例(尺寸不符时 `expected` 为 null,message 给出两种期望尺寸;据此修正生成参数后重试):

```json
{ "ok": false, "protocol": null, "width": 1024, "height": 1024, "expected": null,
  "message": "尺寸 1024×1024 不匹配任何精灵图协议;期望 Codex V2(1536×2288,8 列 × 11 行,cell 192×208) 或 Orca v1(1024×896,8 列 × 7 行,cell 128×128)" }
```

### 3.4 退出码

| 码 | 含义 | 建议处理 |
| --- | --- | --- |
| 0 | 成功 | 解析 stdout JSON |
| 1 | 用法/本地错误(参数错、JSON 解析失败、文件不可读) | 修正参数后重试 |
| 2 | 桥接/服务错误(应用未运行、socket 不可达、内部错误) | 提示用户启动 WorkIsland |
| 3 | 校验失败(输入不合法:颜色、尺寸、格式等) | 按 error 信息修正输入 |

## 4. 岛屿主题 JSON 规格

### 4.1 字段

| 字段 | 类型 | 适用 kind | 说明 |
| --- | --- | --- | --- |
| `kind` | `"default" \| "solid" \| "gradient" \| "image"` | 全部 | 背景类型,必填 |
| `color` | string | solid, gradient | 主色。`#rgb` `#rrggbb` `#rrggbbaa` `rgb()` `rgba()` |
| `color2` | string | gradient | 渐变第二色,格式同 `color` |
| `angle` | number | gradient | 渐变角度 0–360,默认 135 |
| `opacity` | number | solid, gradient | 整体不透明度 0.15–1,默认 1。颜色自带 alpha 时取两者较小值 |
| `imageRef` | string | image | 已安装背景图的文件名(来自 `appearance get`),不允许路径 |
| `imageDim` | number | image | 压暗遮罩 0.2–0.85,默认 0.35(保证浅色文字可读) |

`kind:"image"` 首次使用必须配合 CLI 的 `--image <path>` 参数安装本地图片(.png/.jpg/.webp,≤8 MB,≥8×8 像素);安装幂等(按内容哈希命名 `bg-<hash>.<ext>`)。image 模式下 `opacity` 不生效。

### 4.2 归一化输出

服务端会归一化再持久化:颜色统一为 `#rrggbb`;数字钳制到上述区间;对象只保留白名单字段。`set` 的返回值就是最终生效值,请以它为准回读。

### 4.3 可读性守卫(重要)

岛内文字永远为浅色系。若你的 `color`/`color2` 亮度(WCAG 相对亮度)超过 0.45,服务端会**自动压暗到阈值内**并在 `warnings` 里说明原值与实际值。这不是报错——主题会生效;但若你要精确控制观感,请直接选用足够深的颜色(参考:所有 `#0A`–`#3F` 开头的深色均不会触发压暗)。背景图模式靠 `imageDim` 遮罩保证可读性,最小 0.2。

## 5. 桌宠精灵图规格

像素角色是一张雪碧图(spritesheet),每个动画占一行,帧从左到右播放。支持两种协议,**整图尺寸必须精确匹配**:

### 5.1 Codex V2(推荐)

- 整图:**1536 × 2288** px;网格:8 列 × 11 行;单帧 cell:**192 × 208** px
- 每行左侧起为第 0 帧;行尾多余格子留透明
- 文件格式 `.webp` 或 `.png`(带 alpha 通道),≤10 MB

| 行 | 语义 | 帧数 | 对应任务状态 |
| --- | --- | --- | --- |
| 0 | idle 静息 | 6 | 空闲 / 睡眠(无专属睡眠行,复用) |
| 1 | running-right 拖拽向右 | 8 | 用户拖动桌宠 |
| 2 | running-left 拖拽向左 | 8 | 用户拖动桌宠 |
| 3 | waving 挥手 | 4 | 备用问候动画 |
| 4 | jumping 跳跃 | 5 | 交互玩耍 |
| 5 | failed 受阻 | 8 | (保留) |
| 6 | waiting 等待审批 | 6 | **待审批 / 待回答(attention)** |
| 7 | running 工作中 | 6 | **任务运行中** |
| 8 | review 检阅成果 | 6 | **任务完成** |
| 9–10 | 朝向行 | — | 本应用未使用,留透明即可 |

状态映射(应用内部):idle→行0、play→行4、sleep→行0、running→行7、attention→行6、complete→行8、drag→行1/2。

### 5.2 Orca v1(兼容)

- 整图:**1024 × 896** px;网格:8 列 × 7 行;单帧 cell:**128 × 128** px

| 行 | 语义 | 对应状态 |
| --- | --- | --- |
| 0 | idle | 空闲 |
| 1 | play | 玩耍 |
| 2 | sleep | 睡眠 |
| 3 | running | 运行中 |
| 4 | attention | 待审批/待回答 |
| 5 | complete | 完成 |
| 6 | drag | 拖拽 |

帧数不固定:应用按 cell 的 alpha 自动检测每行有效帧数。

### 5.3 AI 生成建议

1. 以"像素小人 9 宫状态图"思路生成或程序化绘制整图,严格按上表网格排布;先出 PNG 再转 webp 时不要改变画布尺寸。
2. **务必先 `validate`** 再 `install`;validate 的失败信息包含期望尺寸,直接按它修正。
3. 角色内容任意(即"角色 IP 自定义"),但保持深色背景上可辨识、单帧内主体居中、行间不溢出。

## 6. 端到端流程(自动换装示例)

```bash
# A. 换岛屿背景为渐变
workisland-cli appearance set --json '{"kind":"gradient","color":"#101A33","color2":"#0B0716","angle":120}'

# B. 生成像素小人后安装(假设你已产出 /tmp/my-pet.png,1536×2288)
workisland-cli validate /tmp/my-pet.png            # ok:true 才继续
workisland-cli pet install /tmp/my-pet.png --name my-pet
#   → {"ok":true,"sprite":"my-pet.png","selected":true,"validation":{...}}

# C. 安装背景图并启用
workisland-cli appearance set --image /tmp/bg.png --json '{"kind":"image","imageDim":0.45}'

# D. 验证与回滚
workisland-cli appearance get
workisland-cli appearance reset
workisland-cli pet set codex:qianxue              # 回到内置千雪
```

用户的"设置 → 外观"页会实时显示你设置的背景,并可手动重置——尊重用户最终控制权。

## 7. 直接调用桥协议(可选,不经过 CLI)

传输:Unix socket `~/.flux/run/bridge.sock`(或 `$FLUX_SOCKET_PATH`),换行分隔 JSON。

1. 连接后服务端先发 hello:`{"type":"hello","hello":{"protocolVersion":1,"serverLabel":"flux-desktop"}}`
2. 客户端发送命令帧(收到 hello 前不要发送):

```json
{"type":"command","command":{"type":"setAppearance","appearance":{"kind":"solid","color":"#0B1E3A"}}}
```

命令 `type` 一览:`getAppearance` / `setAppearance`(可带 `imageSource:{sourcePath}`)/ `resetAppearance` / `listPets` / `setPet {sprite}` / `installPet {sourcePath,name?,select?}` / `validateSprite {sourcePath}`。

3. 服务端回响应帧:

```json
{"type":"response","response":{"type":"result","data":{ …命令对应结果… }}}
{"type":"response","response":{"type":"error","code":"VALIDATION","message":"…"}}
```

`code` 取值:`VALIDATION`(输入不合法)/ `ERROR`(内部错误)/ `UNAVAILABLE`(控制器未就绪)。旧客户端忽略未知响应类型即可保持兼容。

## 8. 安全与隐私

- 接口仅监听本机 Unix socket,依赖文件系统权限隔离;WorkIsland 不开放任何 TCP 端口。
- 背景图与精灵图分别存放于应用数据目录的 `island-backgrounds/` 与 `pet-sprites/`,引用仅允许裸文件名,目录穿越会被拒绝。
- 上限:背景图 ≤8 MB、精灵图 ≤10 MB;仅 png/jpg/webp。
- 本接口不读写 Agent 会话内容,不改变审批与通知行为。

## 9. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| `无法连接 WorkIsland(socket: …)` | 应用未运行或 socket 被清理。请用户启动 WorkIsland 后重试。 |
| 连接后 8 秒超时 | 应用正忙或版本过旧(无外观命令)。确认版本 ≥3.2.0。 |
| 退出码 3 + `尺寸 … 不匹配任何精灵图协议` | 按 §5 尺寸重新生成,先 validate 后 install。 |
| 退出码 3 + 颜色报错 | 检查颜色格式(§4.1 支持的形式)。 |
| 设置生效但颜色比预期深 | 触发了 §4.3 可读性守卫,`warnings` 中有说明;换更深的颜色。 |
| 背景图显示纯黑 | 图片缺失或损坏,回退兜底;重新 `--image` 安装。 |
