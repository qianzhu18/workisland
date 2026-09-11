# Toolbar Free Home Slot Design

## Outcome

The expanded Island toolbar gives every safe slot around the physical notch to user-arranged productivity tools. Agent Home remains the default workspace, but no longer occupies a permanent toolbar slot.

## Interaction

- Selecting an inactive productivity tool opens it.
- Selecting the active productivity tool again returns to Agent Home. While active, that tool's icon becomes the Home icon in the same slot, with an Agent Home tooltip and accessible label.
- Action-only tools such as Clear Sessions and Pet keep their existing one-shot behavior.
- More and Settings remain fixed system controls so every tool can be recovered or configured.
- Dragging, cross-bank placement, intentional gaps, overflow, and stored slot preferences continue to use the existing toolbar model.

## Layout

The camera exclusion zone already includes the physical-notch safety margin. The first right-bank tool may therefore begin at `cameraRight`; reserving another 32 px for Home is unnecessary. Removing that reservation restores one usable right-bank slot without reducing notch clearance.

## Acceptance

- No fixed Home button is rendered.
- A selected productivity tool exposes a visible Home icon without consuming another slot.
- The representative 640 px / 200 px notch layout gains a fourth right-bank slot.
- No tool overlaps the camera exclusion zone, More, or Settings.
- Re-clicking an active selectable tool returns to Agent Home.
