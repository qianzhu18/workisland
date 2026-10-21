#!/usr/bin/env bash
#
# WorkIsland 一键安装脚本（macOS / Apple Silicon）
#
# 从 GitHub Releases 下载最新版 Apple Silicon DMG，挂载并安装到
# /Applications，然后启动应用。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/qianzhu18/workisland/main/scripts/install.sh | bash
#
# 安全说明：请先核对上方 URL 指向 qianzhu18/workisland 仓库后再执行。
# 本脚本始终从 GitHub Releases 的 latest 资产下载，并校验下载完成。

set -euo pipefail

REPO="qianzhu18/workisland"
APP_NAME="WorkIsland"
DEST="/Applications/${APP_NAME}.app"
API="https://api.github.com/repos/${REPO}/releases/latest"

log()  { printf "==> %s\n" "$*"; }
die()  { printf "Error: %s\n" "$*" >&2; exit 1; }

# 1. 架构检查：当前只发布 Apple Silicon 安装包
ARCH="$(uname -m)"
if [[ "${ARCH}" != "arm64" ]]; then
  die "目前仅发布 Apple Silicon（arm64）安装包，检测到本机架构为 ${ARCH}。\
请到 https://github.com/${REPO}/releases 手动选择对应 DMG 下载。"
fi

# 2. 解析 latest release 的 arm64 DMG 资产 URL
log "获取最新版本信息..."
LATEST_JSON="$(curl -fsSL "${API}")"
DMG_URL="$(printf '%s' "${LATEST_JSON}" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for asset in data.get("assets", []):
    name = asset.get("name") or ""
    if name.endswith("-arm64.dmg"):
        print(asset["browser_download_url"] or "")
        break
')"
TAG="$(printf '%s' "${LATEST_JSON}" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("tag_name") or "")')"
[[ -z "${DMG_URL}" ]] && die "未能从 GitHub Releases 解析到 arm64 DMG 资产，请稍后重试或手动下载：https://github.com/${REPO}/releases"
log "最新版本 ${TAG}，开始安装..."

# 3. 若应用正在运行，先退出（避免替换时文件占用）
if pgrep -f "${DEST}/Contents/MacOS" >/dev/null 2>&1; then
  log "检测到 WorkIsland 正在运行，先退出..."
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  sleep 2
fi

# 4. 下载 DMG 到临时目录
TMP="$(mktemp -d)"
cleanup() {
  hdiutil detach -quiet "/Volumes/${APP_NAME}" >/dev/null 2>&1 || true
  rm -rf "${TMP}"
}
trap cleanup EXIT
DMG="${TMP}/${APP_NAME}.dmg"
log "下载 ${DMG_URL##*/} ..."
curl -fL --progress-bar -o "${DMG}" "${DMG_URL}"

# 5. 挂载并复制到 /Applications
log "挂载 DMG..."
MOUNT="/Volumes/${APP_NAME}"
hdiutil attach -nobrowse -quiet -mountpoint "${MOUNT}" "${DMG}"
SRC_APP="$(find "${MOUNT}" -maxdepth 1 -name "*.app" -print -quit 2>/dev/null || true)"
[[ -z "${SRC_APP}" || ! -d "${SRC_APP}" ]] && die "DMG 中未找到 ${APP_NAME}.app，安装中止"

log "安装到 ${DEST} ..."
if [[ ! -w /Applications ]]; then
  die "没有 /Applications 的写权限。请使用 sudo 执行：sudo bash <(curl -fsSL ...) 或参考 README 手动安装。"
fi
if [[ -e "${DEST}" ]]; then
  rm -rf "${DEST}"
fi
cp -R "${SRC_APP}" "${DEST}"

# 6. 清除隔离属性（curl 下载的应用会被 Gatekeeper 拦截）
xattr -dr com.apple.quarantine "${DEST}" >/dev/null 2>&1 || true

log "安装完成：${DEST}"
log "启动 ${APP_NAME} ..."
open "${DEST}"
log "WorkIsland ${TAG} 已安装并启动。使用中遇到问题请在 https://github.com/${REPO}/issues 反馈。"
