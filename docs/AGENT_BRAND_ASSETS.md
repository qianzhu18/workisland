# Agent brand assets

WorkIsland renders Agent logos from local files so Settings works offline and does not
leak usage information to third-party image hosts. The mapping is centralized in
`src/renderer/settings-app.js`.

## Source inventory

| WorkIsland Agent ID | Display asset | Upstream source | Notes |
| --- | --- | --- | --- |
| `claude` | `claude.svg` | Lobe Icons `ClaudeCode.Color` | Claude Code brand artwork |
| `codex` | `codex.png` | User-provided release artwork | Used in Settings and the Island quota marker |
| `coco`, `trae`, `trae-cn`, `traex` | `trae.svg` | Lobe Icons `TRAE.Color` | These connectors belong to the TRAE product family |
| `cursor` | `cursor.svg` | Lobe Icons `Cursor` | Cursor brand artwork |
| `zcode` | `zcode.svg` | Lobe Icons `ZAI` | ZCode is distributed by Z.ai |
| `workbuddy` | `codebuddy.svg` | Lobe Icons `CodeBuddy.Color` | WorkBuddy uses Tencent CodeBuddy artwork |
| `opencode` | `opencode.svg` | Lobe Icons `OpenCode` | OpenCode brand artwork |
| `sara` | `sara.svg` | `Nexvisora-Research/sara-agent` desktop asset | Upstream Sara artwork |
| `kimi` | `kimi.svg` | Lobe Icons `Kimi.Color` | Kimi brand artwork |
| `gemini` | `gemini.svg` | Lobe Icons `GeminiCLI.Color` | Gemini CLI brand artwork |
| `copilot-cli` | `copilot.svg` | Lobe Icons `Copilot.Color` | GitHub Copilot brand artwork |
| `hermes` | `hermes.svg` | Lobe Icons `HermesAgent` | Hermes Agent brand artwork |
| `aiden` | `agent.svg` | Lucide `bot` | Neutral fallback; no verified public Aiden logo was found |
| `plugin:omp`, `plugin:pi` | `pi.svg` | Lobe Icons `Pi` | Pi/OMP plugin artwork |

The Lobe Icons assets were obtained from `@lobehub/icons-static-svg@1.94.0` after
cross-checking the corresponding upstream product identities. Lobe Icons is MIT
licensed. The generic Lucide icon is ISC licensed. See `THIRD_PARTY_NOTICES.md`.

Product names and logos remain trademarks of their respective owners. Their presence
only identifies a compatible local connector and does not imply endorsement. When an
official brand cannot be verified, use `agent.svg`; do not invent a letter badge or
reuse an unrelated logo.
