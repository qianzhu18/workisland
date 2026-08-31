# Performance Hover Details Design

Issue: [#67](https://github.com/qianzhu18/workisland/issues/67)

## Problem

The performance popover begins process sampling only after it becomes visible. On the first hover, the renderer therefore receives an empty `processes` array and renders only CPU and memory. The process list appears several seconds later without any loading feedback. A 140 ms delayed close also makes it easy to lose the popover while moving the pointer from the trigger to the floating layer.

The process sampler and process-management actions still work. This change addresses the presentation gap without introducing continuous background process scanning.

## Desired experience

- Opening the performance popover always gives immediate feedback.
- The first open shows a clear process-loading state until the first on-demand sample completes.
- Later opens show the most recent successful process list immediately while requesting a fresh sample.
- Moving the pointer between the performance button and popover does not close the popover under normal movement.
- Clicking the button still pins and unpins the popover.
- CPU/memory sorting, process selection, and terminate/force actions remain unchanged.

## Design

### Service state

`PerformanceService` will keep the most recent successful process sample in a dedicated in-memory cache. Hiding the details will continue to publish an empty active `processes` array so normal background updates remain lightweight, but opening the details will publish the cached list immediately before starting a fresh sample.

The cache is process-local, is never persisted, and contains only the same bounded process records already exposed by the service. No additional background timer or filesystem storage is introduced.

### Renderer state

The popover will distinguish three process states:

1. `loading`: details are visible and no process sample has completed yet.
2. `ready`: at least one process record is available, including a cached record set while refresh is in flight.
3. `empty`: sampling completed successfully but produced no visible processes.

The renderer will show a compact loading row for the first state and an explicit empty row for the third. Existing process list rendering remains the ready state.

### Hover behavior

The close grace period will increase from 140 ms to 350 ms. Entering either the trigger or floating layer cancels the timer. Pinning remains independent of hover and continues to keep the layer open.

## Error handling

If process sampling fails, CPU and memory remain available. The process area exits the indefinite loading state and shows an unavailable/empty message. A failed refresh does not erase a previously successful cached list.

## Testing

- Service test: reopening details emits the previous successful process list before the fresh sample completes.
- Service test: a failed refresh preserves the last successful cache.
- Renderer contract test: the popover has explicit loading/empty feedback and uses the longer close delay.
- Existing process action, IPC, syntax, and full project checks must remain green.
- macOS manual verification: first open shows loading feedback; subsequent open shows cached processes immediately; pointer transfer remains stable.

## Non-goals

- Continuous process sampling while the popover is hidden.
- Changes to process termination permissions or protected-process rules.
- Redesigning the performance visuals or toolbox drag-and-drop interaction.
- Persisting process information across application restarts.
