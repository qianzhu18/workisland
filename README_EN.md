<p align="center">
  <a href="README.md">🇨🇳 中文</a> ·
  <a href="README_EN.md">🇺🇸 English</a>
</p>

<p align="center">
  <img src="website/icon.png" width="112" alt="WorkIsland app icon">
</p>

<h1 align="center">WorkIsland</h1>

<p align="center"><strong>Keep your AI coding agents moving, without losing your own flow.</strong></p>

<p align="center">
  A local-first macOS task monitor for Claude Code, Codex, Cursor, and other coding agents. See what needs attention, approve or answer it, then return to the exact source session in one step.
</p>

<p align="center">
  <a href="https://workisland.yanglaishe.cn/">Website</a> ·
  <a href="https://workisland.yanglaishe.cn/guide/">Guide</a> ·
  <a href="https://github.com/qianzhu18/workisland/releases">Download</a> ·
  <a href="https://github.com/qianzhu18/workisland/issues/new/choose">Feedback</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white" alt="macOS Apple Silicon">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0 license"></a>
  <a href="https://workisland.yanglaishe.cn/"><img src="https://img.shields.io/badge/website-workisland.yanglaishe.cn-0ea5e9" alt="WorkIsland website"></a>
</p>

![WorkIsland shows multiple coding-agent tasks in a real macOS interface](website/assets/demo/overview.png)

## Why WorkIsland

When several AI coding tasks run in the background, the expensive part is not starting them. It is noticing the one that needs a decision, then finding the right terminal or IDE session again.

WorkIsland keeps that loop in one local macOS surface. It watches task state, raises only the work that needs you, and brings you back to the originating conversation when you are ready to continue.

## Install

**For users:** download the Apple Silicon DMG from [GitHub Releases](https://github.com/qianzhu18/workisland/releases), move `WorkIsland.app` to Applications, then launch it. No cloud account is required.

**For contributors:** WorkIsland requires an Apple Silicon Mac and Node.js 22 or later.

```bash
git clone https://github.com/qianzhu18/workisland.git
cd workisland
npm run setup
npm run dev:isolated
```

Use `npm run dev` only when you deliberately want to connect the app to your real local Agent Hook configuration. The isolated mode keeps development data inside the repository.

## What You Can Do

- **See the state that matters** - running, approval needed, question waiting, completed, or failed tasks stay visible near the macOS notch.
- **Handle approvals and questions in place** - respond when an agent needs a decision instead of polling every terminal.
- **Return to the right source session** - jump back to the matching Terminal, iTerm2, Ghostty, or Warp conversation.
- **Monitor through two local signals** - Hooks and transcript watching complement each other, so task completion remains observable when one channel is unavailable.
- **Keep the workflow local-first** - task content stays on the Mac; the app does not require a cloud account to monitor local work.
- **Make notifications fit your attention** - choose the island, desktop companion, sounds, shortcuts, and notification timing that suit your workflow.

## Agent Compatibility

WorkIsland has first-party adapters for Claude Code, Codex, Coco, Cursor, TraeCode, ZCode, WorkBuddy / CodeBuddy, OpenCode, Sara, Kimi Code, Gemini CLI, GitHub Copilot CLI, Hermes, Aiden, DeepSeek Harness, and TRAE CLI. MiMo, Trae Work, Trae CN, and generic custom-Hook connections are not advertised because they have not passed a real end-to-end integration test. TraeCode requires its in-app Hooks switch and local automatic execution mode to be enabled before events can reach WorkIsland.

## Product Links

| Resource | Use it for |
| --- | --- |
| [WorkIsland Website](https://workisland.yanglaishe.cn/) | Product overview, real interface, and latest download |
| [Product Guide](https://workisland.yanglaishe.cn/guide/) | Install, first agent task, privacy, and feedback |
| [GitHub Releases](https://github.com/qianzhu18/workisland/releases) | Apple Silicon DMG and release notes |
| [GitHub Issues](https://github.com/qianzhu18/workisland/issues/new/choose) | Bug reports and publicly discussable suggestions |
| [Security policy](SECURITY.md) | Private way to report security issues |

## Privacy

WorkIsland is designed for local workflows. It does not upload Agent sessions, project files, or terminal content. Installed releases can check GitHub Releases for updates. Anonymous usage telemetry is on by default, is disclosed in Settings → About, and can be turned off at any time; turning it off clears unsent events immediately. Read the [telemetry guide](docs/TELEMETRY.md) for the complete event whitelist and privacy guarantees.

## Community and Support

For a reproducible bug, open a [GitHub Issue](https://github.com/qianzhu18/workisland/issues/new/choose). For feedback, compatibility questions, or a QR code refresh, email [its.qianzhu@gmail.com](mailto:its.qianzhu@gmail.com?subject=WorkIsland%20feedback).

<table>
  <tr>
    <td align="center" width="33%">
      <img src="website/assets/community/qianzhu-wechat.png" width="190" alt="Author Qianzhu WeChat QR code"><br>
      <strong>Contact the author: Qianzhu</strong><br>
      Scan to add WeChat, please note “WorkIsland”
    </td>
    <td align="center" width="33%">
      <img src="website/assets/community/workisland-community-group.png" width="190" alt="WorkIsland community QR code"><br>
      <strong>Join the WorkIsland community</strong><br>
      Scan to join next-version discussions and agent compatibility feedback
    </td>
    <td align="center" width="33%">
      <a href="https://workisland.yanglaishe.cn/#support">Website feedback & community</a><br><br>
      You decide whether to export logs or screenshots. Before public feedback, remove project code, keys, and other sensitive info.
    </td>
  </tr>
</table>

## Support the Project

WorkIsland is free, open source, and has no subscription or in-app purchase. If it saves you a context switch, you can **Buy Me a Coffee** with WeChat Pay. This is voluntary support, not a purchase of features or priority support.

<p align="center">
  <img src="website/assets/community/qianzhu-wechat-pay.jpg" width="260" alt="WeChat Pay QR code for supporting WorkIsland">
</p>

## Build, Contribute, and Release

Run the complete local check before submitting a change:

```bash
npm run check
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md) for the signed, notarized macOS release flow.

## License and Trademark

Source code is licensed under [Apache License 2.0](LICENSE). WorkIsland's name, trademark, and logo are not granted under that license. Third-party dependencies, images, fonts, audio, and companion assets retain their respective licenses; see [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

If WorkIsland helps your AI coding workflow, a GitHub star makes the project easier for the next person to find.
