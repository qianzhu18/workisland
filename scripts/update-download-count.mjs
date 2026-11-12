import fs from "node:fs/promises";

const repository = "qianzhu18/workisland";
const endpoint = `https://api.github.com/repos/${repository}/releases?per_page=100`;
const output = new URL("../website/download-count.json", import.meta.url);

async function main() {
  let releases;
  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "workisland-website",
      },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    releases = await response.json();
  } catch (error) {
    console.warn(`Keeping the existing download count: ${error.message}`);
    return;
  }

  const total = releases.reduce((releaseTotal, release) => {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    return releaseTotal + assets.reduce((assetTotal, asset) => {
      const name = typeof asset?.name === "string" ? asset.name : "";
      const downloads = Number(asset?.download_count);
      return assetTotal + (/\.dmg$/i.test(name) && Number.isFinite(downloads) ? downloads : 0);
    }, 0);
  }, 0);

  if (total <= 0) {
    console.warn("Keeping the existing download count: no DMG downloads reported");
    return;
  }

  await fs.writeFile(output, `${JSON.stringify({ total }, null, 2)}\n`);
  console.log(`Updated download count to ${total}`);
}

await main();
