# Claude Code notifications on macOS

> For an individual developer using Claude Code on a Mac who wants to stop polling terminals for the next task that needs attention.

WorkIsland does not replace Claude Code, a terminal, or an editor. It reads local task signals from a connected Claude Code workflow and shows clear running, attention, completed, or failed states. When needed, the Island can return the user to the source session.

## Verify with one real task

1. Install and open WorkIsland from the [official release](https://github.com/qianzhu18/workisland/releases/latest).
2. Connect the Claude Code workflow you already use in Agent Settings. Until that connection is complete, WorkIsland does not show a fabricated completed state.
3. Run a real Claude Code task in the existing terminal. Watch the Island while it runs, waits for an action, or completes; select the relevant signal to return to the matching terminal or app context.

## Fit and limits

Use it for long-running work, parallel sessions, or a workflow where repeated terminal polling gets in the way. WorkIsland does not decide what to approve or automatically complete actions that require the user.

Session content, code, paths, project names, host names, and user names stay on the Mac. Include the app version and redacted reproduction steps when reporting a problem.
