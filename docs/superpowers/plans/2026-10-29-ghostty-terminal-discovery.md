# Ghostty external terminal discovery

Goal: list and focus existing Ghostty 1.3+ windows, tabs and split terminals through its native macOS automation API. Preserve opaque stable identity, handle missing TTY and permissions explicitly, avoid creating or closing user terminals. Existing internal terminals and Terminal/iTerm behavior remain unchanged.

1. Test stable Ghostty identity, separate split panes, stale focus, unsupported/denied host and other hosts.
2. Extend current metadata-only discovery with native IDs and exact focus, without introducing a background poll or new dependency.
3. Update the list label and user-facing capability limits; validate unit tests and real host when permission permits.
4. Investigate whether arbitrary existing PTYs can be transferred; do not claim app switching or duplicate shell is a live import. Propose managed sessions as a future route if supported.

Additional app-level fallback: discover running Warp, WezTerm, kitty and Alacritty via macOS application metadata; explicitly label the fallback and never pretend it identifies a specific pane. Reject stale process identities. Future precise integrations can adopt each host API when available and permitted.
