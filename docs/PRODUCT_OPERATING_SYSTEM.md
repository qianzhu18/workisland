# WorkIsland Product Operating System

状态：`active`  
适用范围：所有远程协作、产品决策、研发任务和发布  
最后更新：2026-08-17

## 1. 目的

WorkIsland 是长期维护的产品，不把聊天记录、个人记忆或未经评审的本地笔记当作交付依据。GitHub 仓库是远程协作的工作台：需求为什么存在、如何实现、由谁验证、在哪个版本交付，都必须能被 Issue、PR 和文档追溯。

## 2. 工作层级

```text
产品愿景
  -> 路线图
    -> Epic / Feature
      -> Feature PRD 或 Version PRD
        -> GitHub Task / Issue
          -> Branch + Pull Request
            -> Review + CI
              -> Merge + Release + Review
```

不要为了形式而增加层级：

- 新的大能力、跨模块体验或商业化决策：从 Epic / Feature PRD 开始。
- 当前路线图已有的能力：从 Feature PRD 开始。
- 可复现 Bug、文案、依赖升级或已有 PRD 内的独立小任务：可以直接从 Issue 开始。
- 每个外部 Beta、稳定版或热修复：必须从 Version PRD 开始。

## 3. 文档责任与位置

| 层级 | 位置 | 决策问题 | 创建时机 |
| --- | --- | --- | --- |
| 产品愿景 | `docs/product/PRODUCT_VISION.md` | 为谁解决什么长期问题 | 方向变化时 |
| 路线图 | `docs/product/ROADMAP.md` | 哪些结果按什么顺序验证 | 每月或阶段门变化时 |
| Epic | `docs/product/epics/EPIC-编号-主题.md` | 一个完整能力的边界和成功证据 | 跨 2 个以上任务时 |
| Feature PRD | `docs/product/prd/PRD-编号-主题.md` | 用户行为、范围、验收、指标 | 进入研发前 |
| Version PRD | `docs/product/prd/PRD-编号-vX.Y.Z-主题.md` | 某个分发包的范围、门槛、回滚 | 打 Tag 前 |
| Task / Bug | GitHub Issue | 一个可分配、可验证的交付单元 | PRD 拆分后或发现缺陷时 |
| 实现与评审 | GitHub Pull Request | 代码和文档是否满足该 Issue | 开发完成后 |
| 发布记录 | GitHub Release + 版本复盘 | 分发、学习和下一假设 | 发布后 24 小时、7 天 |

PRD 编号按创建顺序递增，不预留、不复用。Epic、Feature PRD、Issue、PR 和 Release 都必须相互链接。

## 4. 从 Feature 到 Release

1. 在 GitHub 开一个 Feature intake Issue，记录用户问题和证据。
2. 需要开发时，创建 Epic 或 Feature PRD；明确目标、非目标、用户旅程、验收、指标和隐私/架构影响。
3. 将 PRD 拆成 3-6 个可独立验证的 Task Issue。每个 Issue 写明父 PRD、范围、非目标、验收证据和目标版本。
4. 从最新 `main` 创建分支：`feature/<topic>`、`fix/<topic>`、`docs/<topic>`、`release/v<version>` 或 `hotfix/<topic>`。
5. 每个 PR 只完成一个 Issue 或一个紧密关联的小单元，使用 PR 模板填写 `Closes #<issue>`、PRD、验证和风险。
6. CI 的 `source-contracts` 与 `native-macos` 通过，Review 完成，必要的手册或 Release Notes 已更新，才允许合并到 `main`。
7. 版本 PRD 的发布门槛全部通过后才打 Tag 和创建 GitHub Release；发布后按时复盘并把结论回写到下一 Feature 或版本 PRD。

## 5. GitHub 协作规则

### 分支与提交

- `main`：始终保持可发布，只经 Pull Request 合并。
- 分支命名：`feature/<topic>`、`fix/<topic>`、`docs/<topic>`、`release/v<version>`、`hotfix/<topic>`。
- 提交使用 `type(scope): summary`，例如 `feat(onboarding): record opt-in launch`。
- 不把私钥、API key、用户路径、Agent transcript、`.local-*`、日志或未授权素材提交到 Git。

### Pull Request

- 一个 PR 有一个清晰的用户结果和可回滚边界；无关重构另开 PR。
- UI、窗口、多显示器和桌宠变更必须附截图/录屏或真实设备验证说明。
- 行为变更必须有测试；不能自动覆盖的 macOS 行为必须写明手动验证步骤和结果。
- 任何修改用户行为、隐私、架构或发布流程的 PR 必须同步更新对应文档。
- P0 隐私、安全、安装、核心工作流或数据正确性问题未解决时，任何人都可以阻止发布。

### Issue 与反馈

- Bug 必须写版本、复现步骤、预期/实际行为和影响。相同问题被 3 位独立用户反馈时标为 `priority: P0/P1` 并在最近迭代处理或给出不处理理由。
- Feature Issue 只进入总需求池，不代表承诺开发；有证据并通过排期后才进入 PRD。
- 所有用户反馈在 24 小时内确认收到，在修复或排期后回告用户。

## 6. 标签和项目看板

在 GitHub 仓库 Settings 或 Labels 页面创建并维护：

| 分类 | 标签 |
| --- | --- |
| 类型 | `bug`、`enhancement`、`documentation`、`kind: epic`、`kind: task` |
| 优先级 | `priority: P0`、`priority: P1`、`priority: P2`、`priority: P3` |
| 状态 | `status: needs-prd`、`status: ready`、`status: in-progress`、`status: blocked`、`status: needs-validation` |
| 来源 | `source: user-feedback`、`source: beta`、`source: strategy` |

GitHub Project 使用单一的 `WorkIsland Delivery` 看板，字段为 `Status`、`Priority`、`Target version`、`Parent PRD`、`Owner`。流程为 `Inbox -> Needs PRD -> Ready -> In Progress -> In Review -> Validating -> Done`。

## 7. 建议的 GitHub 保护设置

当前 `main` 尚未受分支保护。第一次多人协作前，在 Settings -> Rules -> Rulesets 为 `main` 启用：

- Require a pull request before merging。
- Require `check / source-contracts` 和 `check / native-macos` 成功。
- Require conversation resolution，禁止 force push 和删除分支。
- 单人维护阶段不强制 approval，避免维护者无法合并自己的修复；出现第二位维护者后，要求至少 1 个 approval，并为关键路径设置 CODEOWNERS。

Tag `v*` 的创建权限只交给发布维护者。Beta Tag 必须生成 GitHub Pre-release，稳定版才进入更新通道，详见 [Release Process](./RELEASE_PROCESS.md)。

## 8. 固定运营节奏

| 节奏 | 产出 |
| --- | --- |
| 每天 | 新反馈归类、P0/P1 处理、Issue 状态更新 |
| 每周 | 30 分钟迭代复盘：指标、用户原话、阻断问题、下一主假设 |
| 每 10 天 | 规划会、可测试包、验收会和发布/继续验证决定 |
| 每月 | Roadmap 校准：停止无证据方向，确认下一 Epic |
| 每个版本后 | 24 小时和 7 天发布复盘，结论回流 Backlog |

## 9. 完成定义

一个 Task 只有同时满足以下条件才能关闭：父 PRD/Issue 已链接，范围与非目标明确，代码和文档已合并，自动检查通过，必要的真实设备验证已留证，用户可见变化已进入手册/Release Notes，发布与回滚影响已记录。
