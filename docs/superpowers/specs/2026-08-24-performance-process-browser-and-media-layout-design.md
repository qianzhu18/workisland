# Performance Process Browser and Media Layout Design

## Goal

Make the workstation useful when either CPU or memory causes slowdown, while keeping the media player visually anchored to the left side of the expanded island.

## Performance interaction

- Turn the existing CPU and memory metric cards into accessible toggle buttons.
- Choose the initial metric adaptively: memory when memory pressure is warning/critical or memory usage is at least 75%; otherwise CPU.
- After a user chooses a metric, preserve that choice while the popover remains mounted.
- Sort processes by the chosen metric and show both CPU percentage and resident memory for every row.
- Show five rows as the compact summary. A `查看全部` control expands a scrollable list of every sampled process owned by the current macOS user.
- Do not include processes owned by other users because WorkIsland cannot terminate them. Keep WorkIsland itself visible but mark it protected and disable its management action.
- Keep the existing confirmation step, graceful terminate action, force-quit action, PID/fingerprint verification, and feedback messages.
- Process details continue to be sampled only while the performance popover is visible.

## Process data

The main process reads PID, UID, CPU percentage, memory percentage, resident bytes, and command from `ps`. It retains all current-user rows rather than discarding everything after the top five. The renderer owns sorting and summary/expanded presentation so changing the selected metric does not require another process invocation.

## Media layout

- When media and agent monitoring share the expanded island, use a stable 300px media column and let the agent pane consume the remaining width.
- Keep the media card centered within its own left column, not within the combined island.
- Preserve the single-column agent layout when no media is active.

## Verification

- Unit-test process parsing, UID filtering, resident-memory conversion, metric selection, sorting, and formatting.
- Contract-test the scrollable full-list controls and fixed media-column CSS.
- Run the full source and unit test suite, package the macOS application, install it locally, and inspect both CPU and memory modes before any push.
