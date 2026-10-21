cask "workisland" do
  version "1.5.1"
  sha256 "32d542317a32b467b62c6c9a74b3625a76eb149fa463834eb124bb197d183def"

  url "https://github.com/qianzhu18/workisland/releases/download/v#{version}/WorkIsland-#{version}-arm64.dmg"
  name "WorkIsland"
  desc "Session monitor, approval and productivity island for local AI agents"
  homepage "https://workisland.yanglaishe.cn/"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "WorkIsland.app"
end
