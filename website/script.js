const REPOSITORY = "qianzhu18/workisland";
const RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

const scenes = {
  approval: { title: "需要你的确认", copy: "Allow changes to auth.ts?", state: "!", detail: "Codex · WorkIsland", tone: "approval" },
  running: { title: "正在运行", copy: "Refactoring auth module · 64%", state: "·", detail: "Claude Code · WorkIsland", tone: "running" },
  complete: { title: "任务已完成", copy: "Tests passed · Ready to review", state: "✓", detail: "Cursor · WorkIsland", tone: "complete" }
};

function setScene(name) {
  const scene = scenes[name] || scenes.approval;
  document.querySelectorAll("[data-scene-title]").forEach((node) => { node.textContent = scene.title; });
  document.querySelectorAll("[data-scene-copy]").forEach((node) => { node.textContent = scene.copy; });
  document.querySelectorAll("[data-scene-state]").forEach((node) => { node.textContent = scene.state; });
  document.querySelectorAll("[data-scene-detail]").forEach((node) => { node.textContent = scene.detail; });
  document.querySelectorAll(".notch-shell").forEach((node) => { node.dataset.state = scene.tone; });
  document.querySelectorAll(".scene-button").forEach((button) => {
    const active = button.dataset.scene === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

document.querySelectorAll(".scene-button").forEach((button) => {
  button.addEventListener("click", () => setScene(button.dataset.scene));
});

function updateReleaseLinks(release) {
  const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
  const asset = release?.assets?.find((candidate) => /\.dmg$/i.test(candidate?.name || "") && /arm64/i.test(candidate?.name || ""));
  const downloadUrl = asset?.browser_download_url || release?.html_url || RELEASE_PAGE;
  const label = asset?.name ? `下载 ${tag || "最新版本"}` : "打开最新 Release";
  document.querySelectorAll("[data-download-link]").forEach((link) => {
    link.href = downloadUrl;
    if (asset?.browser_download_url) link.setAttribute("download", "");
  });
  document.querySelectorAll("[data-download-label]").forEach((node) => { node.textContent = label; });
  document.querySelectorAll("[data-version]").forEach((node) => { node.textContent = tag ? `${tag} 稳定版` : "最新稳定版"; });
}

async function loadLatestRelease() {
  updateReleaseLinks({ html_url: RELEASE_PAGE });
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`GitHub Releases returned ${response.status}`);
    updateReleaseLinks(await response.json());
  } catch {
    document.querySelectorAll("[data-version]").forEach((node) => { node.textContent = "最新稳定版"; });
  }
}

const video = document.querySelector(".demo-video");
const placeholder = document.querySelector("#video-placeholder");
if (video && placeholder) {
  video.addEventListener("loadedmetadata", () => { video.hidden = false; placeholder.hidden = true; });
  video.addEventListener("error", () => { video.hidden = true; placeholder.hidden = false; });
}

setScene("approval");
loadLatestRelease();
