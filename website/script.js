const REPOSITORY = "qianzhu18/workisland";
const RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

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
    // The release page remains a stable fallback when the API is unavailable.
    document.querySelectorAll("[data-version]").forEach((node) => { node.textContent = "最新稳定版"; });
  }
}

loadLatestRelease();
