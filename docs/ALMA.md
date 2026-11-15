# Alma

WorkIsland connects to the desktop Alma agent through Alma's file-based lifecycle hooks.

Alma reads `~/.config/alma/hooks.json`. Connecting Alma in WorkIsland settings adds one command rule for each of these events, without removing rules you already configured:

- `thread.created` / `thread.deleted` — session open and close
- `chat.message.willSend` — the user message that starts a turn
- `chat.message.didReceive` — the finished assistant turn, including token usage when Alma provides it
- `tool.willExecute` / `tool.didExecute` / `tool.onError` — tool activity

The hook command receives Alma's JSON on stdin (`hook`, `input`, `matcher`) and exits immediately. Alma does not have a separate permission event, so approvals stay in Alma. A click on the Island focuses the Alma app (`com.yetone.alma`).

The connection stays off until you enable it. WorkIsland marks it verified only after a real Alma event arrives. If Alma is not installed, the card stays unavailable and nothing is written.
