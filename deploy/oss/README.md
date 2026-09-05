# 阿里云 OSS 下载镜像

目标是让官网继续使用 `workisland.yanglaishe.cn`，而把大文件下载放到独立的 `download.<你的域名>`。官网读取镜像清单；镜像尚未配置、超时或不可用时，按钮仍会回退到官方 GitHub Release。

## 一次性配置

1. 在面向中国大陆用户的 OSS 地域创建**私有或公共读** Bucket；若采用私有 Bucket，必须额外用 CDN/签名 URL，当前静态官网方案适合公共读的安装包目录。
2. 为 Bucket 绑定 `download.<你的域名>`，签发该子域名的 HTTPS 证书；中国内地 Bucket 绑定自有域名通常需要完成域名 ICP 备案。
3. 在 OSS CORS 规则中只允许官网源站读取清单：`https://workisland.yanglaishe.cn`，方法 `GET, HEAD`，响应头至少暴露 `Content-Length` 和 `ETag`。安装包的普通导航下载不依赖 CORS，但浏览器读取跨域 `latest.json` 依赖它。
4. 上传后的对象路径固定为 `releases/<tag>/<文件名>`，并为 DMG 设置 `Content-Type: application/x-apple-diskimage`，`Content-Disposition: attachment`。`latest.json` 使用 `application/json` 且短缓存（建议 `Cache-Control: no-cache`）。版本目录中的安装包可用长缓存（例如 `public, max-age=31536000, immutable`）。
5. 在官网的 [`website/download-config.json`](../../website/download-config.json) 中，把 `mirrorManifestUrl` 改为 `https://download.<你的域名>/latest.json`，再部署官网。

## 每个正式 macOS Release 的顺序

先在 GitHub Actions 完成签名、公证和 DMG 校验，再同步**同一份**已发布 DMG 到 OSS。不要为镜像重新打包或修改文件。

```sh
# 1. 从已验证的 release 目录生成 manifest（同时计算 SHA-256）
node scripts/build-download-manifest.mjs \
  --tag vX.Y.Z \
  --source ./release \
  --public-base https://download.<你的域名> \
  --output ./release-mirror/latest.json

# 2. 使用已配置凭据的 ossutil 上传；将 <bucket> 替换为真实 Bucket 名称
ossutil cp -rf ./release/ oss://<bucket>/releases/vX.Y.Z/
ossutil cp ./release-mirror/latest.json oss://<bucket>/latest.json
```

发布后至少验证三件事：

```sh
curl -fsS https://download.<你的域名>/latest.json
shasum -a 256 WorkIsland-X.Y.Z-arm64.dmg
curl -I https://download.<你的域名>/releases/vX.Y.Z/WorkIsland-X.Y.Z-arm64.dmg
```

将本地计算出的 SHA-256 与 `latest.json` 和 GitHub Release 的校验文件逐项比对。只有三处一致，才更新官网的 `mirrorManifestUrl`。

## 自动同步（推荐）

仓库内的 [`.github/workflows/oss-download-mirror.yml`](../../.github/workflows/oss-download-mirror.yml) 会在**正式 GitHub Release 发布后**下载其已经发布的 DMG 与校验文件，校验 OSS CLI 自身的 SHA-256，再上传同一批文件，最后才推进 `latest.json`。它不镜像带 `-` 的预发布 Tag。

启用前，在 GitHub Actions secrets 配置以下值；AccessKey 必须属于最小权限的 RAM 用户，只允许写入此下载 Bucket：

| Secret | 示例 / 用途 |
| --- | --- |
| `ALIYUN_OSS_BUCKET` | `workisland-download` |
| `ALIYUN_OSS_REGION` | `cn-hangzhou`，必须与 Bucket 匹配 |
| `ALIYUN_OSS_ACCESS_KEY_ID` | RAM AccessKey ID |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` | RAM AccessKey Secret |
| `ALIYUN_DOWNLOAD_PUBLIC_BASE` | `https://download.<你的域名>`，无末尾 `/` |

未配置这些 secrets 时工作流会跳过，不会向 OSS 写入任何内容。首次配置后，可在 Actions 中手动执行该工作流并填入一个已发布的稳定 Tag；成功后再填写 `download-config.json` 的镜像地址。

## 成本与边界

OSS 可解决 GitHub Releases/API 对中国大陆用户不稳定的问题，但不是“永久免费”：费用主要来自存储、下行流量和请求次数。初期不必额外购买全球加速服务；若海外下载量增长，再为同一 OSS 源站启用 CDN 或选择另一个全球 CDN。不要把 API、更新校验或官网 HTML 混进这个 Bucket。
