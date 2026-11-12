# WorkIsland for Atoll (macOS)

WorkIsland is the extension provider. Run a WorkIsland build that includes this integration alongside Atoll. No patched Atoll binary or second monitoring engine is required. The integration is off by default.

1. In Atoll Settings, enable third-party extensions, notch tabs, interactive web content and live activities. Allow WorkIsland when prompted.
2. In WorkIsland Settings → General, enable Atoll integration and choose Atoll as the Agent display target. Keep WorkIsland running for live updates.
3. Open Atoll’s link-symbol tab to view the WorkIsland monitor. Select **Open full monitor** to borrow the native WorkIsland island on that screen; **Return to Atoll** closes it.
4. To stop, switch the display target back to WorkIsland or disable the integration. If you dismissed or revoked the extension, reconnect explicitly after restoring its permissions.

Atoll shows the official WorkIsland app icon in image-capable surfaces. Atoll 2.3.3 uses only an SF Symbol in its toolbar. Its compact tab has a host-owned header and height; use the full monitor for longer lists. The full monitor runs in WorkIsland's own window. Successful tasks show the reported result, and questions and approvals can open an actionable card. Codex Desktop questions link back to Codex for answers. Quotas are shown when the local provider has data.

The extension uses Atoll’s local RPC service and a loopback web view with a per-run token. No remote reporting service is required. The feature on main does not imply a signed release or a Marketplace listing.
