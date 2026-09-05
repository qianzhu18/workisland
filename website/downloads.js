(() => {
  "use strict";

  const repository = "qianzhu18/workisland";
  const releasePage = `https://github.com/${repository}/releases/latest`;
  const releaseApi = `https://api.github.com/repos/${repository}/releases/latest`;
  const configUrl = "/download-config.json";

  function isHttpsUrl(value) {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }

  async function getJson(url, timeoutMs, headers = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  function findMacAsset(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    return assets.find((asset) => {
      const name = typeof asset?.name === "string" ? asset.name : "";
      const url = asset?.url || asset?.browser_download_url;
      return /\.dmg$/i.test(name) && /arm64/i.test(name) && isHttpsUrl(url);
    });
  }

  function updateDownloadLinks(release) {
    const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
    const asset = findMacAsset(release);
    const downloadUrl = asset?.url || asset?.browser_download_url || release?.html_url || releasePage;

    document.querySelectorAll("[data-download-link]").forEach((link) => {
      link.href = downloadUrl;
      if (asset) link.setAttribute("download", "");
      else link.removeAttribute("download");
    });
    document.querySelectorAll("[data-version]").forEach((node) => {
      node.textContent = tag || "最新稳定版";
    });
  }

  function normalizeMirrorManifest(manifest) {
    if (!manifest || typeof manifest !== "object") return null;
    const version = typeof manifest.version === "string" ? manifest.version : "";
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    const macAsset = assets.find((asset) => (
      asset?.platform === "macos"
      && asset?.arch === "arm64"
      && /\.dmg$/i.test(asset?.name || "")
      && isHttpsUrl(asset?.url)
    ));
    if (!macAsset) return null;

    return {
      tag_name: version,
      html_url: isHttpsUrl(manifest.fallbackUrl) ? manifest.fallbackUrl : releasePage,
      assets: [{ name: macAsset.name, url: macAsset.url }]
    };
  }

  async function loadLatestRelease() {
    // The static fallback always works, including before OSS is configured.
    updateDownloadLinks({ html_url: releasePage });

    try {
      const config = await getJson(configUrl, 1200);
      const manifestUrl = config?.mirrorManifestUrl;
      if (isHttpsUrl(manifestUrl)) {
        const mirrorRelease = normalizeMirrorManifest(await getJson(manifestUrl, 2500));
        if (mirrorRelease) {
          updateDownloadLinks(mirrorRelease);
          return;
        }
      }
    } catch {
      // A mirror/configuration outage must never block the official fallback.
    }

    try {
      const release = await getJson(releaseApi, 2500, { Accept: "application/vnd.github+json" });
      updateDownloadLinks(release);
    } catch {
      document.querySelectorAll("[data-version]").forEach((node) => {
        node.textContent = "最新稳定版";
      });
    }
  }

  window.WorkIslandDownloads = { loadLatestRelease };
  loadLatestRelease();
})();
