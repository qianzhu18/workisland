# WorkIsland 官网：Vercel 部署

官网是 `website/` 下的静态文件。2026-10-22 从本地正常源码部署到 Vercel，以移除对受损腾讯云主机的依赖。

- Vercel 项目：`qianzhu18s-projects/workisland`
- 可用地址：`https://workisland-six.vercel.app/`
- 正式域名：`https://workisland.yanglaishe.cn/`
- 配置文件：`website/vercel.json`
- Framework：Other；无需安装依赖或运行构建；Output Directory 为 `.`。

## 更新官网

生产部署使用 GitHub 仓库 `qianzhu18/workisland` 的 `main` 分支。Vercel 项目必须将 Root Directory 设为 `website`，使用 Other 框架和 `website/vercel.json` 中的静态站点配置。合并官网更新后，在 Vercel 的 Deployments 页面确认新提交已部署到正式域名。

紧急时可使用已关联项目的 Vercel CLI 手动部署。若项目已设置 Root Directory 为 `website`，请在仓库根目录执行以下命令，由 Vercel 选择官网目录：

```sh
vercel link --yes --project workisland --scope qianzhu18s-projects
vercel deploy --prod --yes --scope qianzhu18s-projects
```

如果 Root Directory 为空，以上两条命令均加上 `--cwd website`，确保只部署官网文件。不要提交 Vercel 生成的 `.vercel/` 目录。

安装包来自官方 GitHub Releases。首页分别提供 Apple 芯片和 Intel 版本；无法读取 GitHub API 时，入口仍可打开最新稳定版的 Release 页面。下载次数统计 GitHub Release 的 DMG 下载量，API 不可用时显示 `website/download-count.json` 中的最近快照。

## 域名切换

DNS 托管在 Cloudflare。正式域名已添加到 Vercel 项目。

2026-10-22 的 `vercel domains inspect workisland.yanglaishe.cn` 推荐：将名称为 `workisland` 的 A 记录从原服务器 IP 改为 `76.76.21.21`。仅修改该子域名记录，不需要修改整个域名的 nameserver。以后调整以 Vercel 当时显示的记录为准。

切换后检查：

```sh
vercel domains inspect workisland.yanglaishe.cn --scope qianzhu18s-projects
curl -I https://workisland.yanglaishe.cn/
```

确认 HTTPS 正常、响应来自 Vercel，首页、英文页、手册、更新日志及两篇提醒指南可访问。切换前也可使用临时地址查看完整官网。

## 本次恢复处理

- 为 HTML、CSS 和脚本引用的静态资源添加 `v=20261022-recovery`，避免读取浏览器缓存中的加密文件。
- 资源响应要求重新验证，避免长期保留损坏内容。
- 暂停从同一受损主机加载 Umami 统计脚本。
- 暂停原服务器的安装包镜像清单，下载按钮直接使用官方 GitHub Release。

官网迁移不会清除旧服务器上的入侵残留，也不会修复其 SSH 登录；旧主机后续需要单独处理。
