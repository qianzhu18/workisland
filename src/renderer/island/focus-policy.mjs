/**
 * Return whether a visible Island surface should collapse after window focus
 * moves to another application.
 *
 * Follow-up input is deliberately excluded: the user may be switching focus
 * between controls while completing an answer, so that surface must remain
 * available until its own interaction is resolved.
 */
export function shouldCollapseOnFocusLoss({ isOpen, enabled, followUpFocused }) {
  return Boolean(isOpen && enabled && !followUpFocused);
}
