(() => {
  "use strict";

  const repository = "qianzhu18/workisland";
  const releasePage = `https://github.com/${repository}/releases/latest`;
  const releaseApi = `https://api.github.com/repos/${repository}/releases/latest`;
  const releasesApi = `https://api.github.com/repos/${repository}/releases?per_page=100`;
  const downloadCountUrl = "/download-count.json";
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

  function updateDownloadLinks(release) {
    const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
    const assets = Array.isArray(release?.assets) ? release.assets : [];

    document.querySelectorAll("[data-download-arch]").forEach((link) => {
      const arch = link.dataset.downloadArch;
      const asset = assets.find((candidate) =>
        typeof candidate?.name === "string"
        && candidate.name.toLowerCase().endsWith(`-${arch}.dmg`)
        && isHttpsUrl(candidate.browser_download_url)
      );
      link.href = asset?.browser_download_url || releasePage;
    });
    document.querySelectorAll("[data-version]").forEach((node) => {
      node.textContent = tag || "最新稳定版";
    });
  }

  function applyDownloadCount(total) {
    if (!Number.isFinite(total) || total <= 0) return;
    document.querySelectorAll("[data-download-count]").forEach((node) => {
      const value = node.querySelector("[data-download-count-value]");
      if (value) value.textContent = total.toLocaleString("en-US");
    });
  }

  function totalDmgDownloads(releases) {
    if (!Array.isArray(releases)) return 0;
    return releases.reduce((releaseTotal, release) => {
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      return releaseTotal + assets.reduce((assetTotal, asset) => {
        const name = typeof asset?.name === "string" ? asset.name : "";
        const downloads = Number(asset?.download_count);
        return assetTotal + (/\.dmg$/i.test(name) && Number.isFinite(downloads) ? downloads : 0);
      }, 0);
    }, 0);
  }

  function normalizeMirrorManifest(manifest) {
    if (!manifest || typeof manifest !== "object") return null;
    const version = typeof manifest.version === "string" ? manifest.version : "";
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    const macAssets = assets.filter((asset) =>
      asset?.platform === "macos"
      && /-(arm64|x64)\.dmg$/i.test(asset.name || "")
      && isHttpsUrl(asset.url)
    );
    if (macAssets.length === 0) return null;

    return {
      tag_name: version,
      assets: macAssets.map(({ name, url }) => ({ name, browser_download_url: url }))
    };
  }

  async function loadLatestRelease() {
    try {
      const config = await getJson(configUrl, 1200);
      const manifestUrl = config?.mirrorManifestUrl;
      if (isHttpsUrl(manifestUrl)) {
        const mirrorRelease = normalizeMirrorManifest(await getJson(manifestUrl, 2500));
        if (mirrorRelease?.assets.length === 2) {
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

  async function loadDownloadCount() {
    try {
      const local = await getJson(downloadCountUrl, 1200);
      applyDownloadCount(Number(local?.total));
    } catch {
      // The static number in the page remains visible.
    }

    try {
      const releases = await getJson(releasesApi, 2500, { Accept: "application/vnd.github+json" });
      applyDownloadCount(totalDmgDownloads(releases));
    } catch {
      // Keep the local count when GitHub is unavailable.
    }
  }

  window.WorkIslandDownloads = { loadLatestRelease, loadDownloadCount };
  loadLatestRelease();
  loadDownloadCount();
})();
