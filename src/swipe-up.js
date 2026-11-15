// The swipe-up screen's rules (iOS SwipeUpToSendScrollView / SendProgressScreen, KaPay 953b255),
// with no screen code, so tools/test-send-steps.mjs runs them in node. send-steps.js draws the
// screen itself.

import { SEND_OUTCOME_UNKNOWN_MESSAGE } from "../shared/engine/transactions.js";

/** How far the bar is pushed up before letting go sends: about a third of the screen (KaPay
 *  953b255; it was half). */
export function swipeUpThreshold(height) {
  return Math.max(120, Number(height || 0) * 0.3);
}

/**
 * How a swipe-up ended, from what the screen knows: `done` (sent, or a claim started) and the
 * failure text shown (null while there is none). "unknown" is a send the network never confirmed
 * (SEND_OUTCOME_UNKNOWN): it may have gone through, so there's nothing to try again and it ends
 * on Done (KaPay 953b255 outcomeUnknown). Returns { kind: "done" | "unknown" | "failed" | null,
 * title, final: "done" | "retry" | null }; `title` is null while it is still going.
 */
export function swipeUpEnding({ done = false, failure = null, doneTitle = "Sent" } = {}) {
  if (done) return { kind: "done", title: doneTitle, final: "done" };
  if (failure == null) return { kind: null, title: null, final: null };
  if (failure === SEND_OUTCOME_UNKNOWN_MESSAGE) return { kind: "unknown", title: "Not confirmed", final: "done" };
  return { kind: "failed", title: "Failed", final: "retry" };
}

// On a computer the bar is a tap, not a swipe (owner, 2026-11-15): pushing a bar up with a mouse is
// awkward. A tap plays the same rise a swipe would - the review lifts past the threshold, then
// sends - so the screen still looks like iOS's. A drag still works too (touchscreens).

/** iOS's "Swipe up to Send" / "Swipe up to Buy" ... as the extension's "Tap to Send" / "Tap to Buy". */
export function tapBarTitle(barTitle) {
  return String(barTitle || "").replace(/^Swipe up to /i, "Tap to ");
}

/** How far the pointer may move between press and release and still count as a tap, in px. */
export const TAP_SLOP_PX = 6;

/** How long a tap's rise takes, in ms (shorter with reduced motion). */
export function tapRiseMs(reducedMotion = false) {
  return reducedMotion ? 200 : 520;
}

/** Where a tap's rise is at `t` (0..1) of `riseMs`, as a lift in px that ends a little past the
 *  threshold, eased in and out like a hand pushing it up. */
export function tapRiseLift(t, threshold) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  const eased = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  return eased * threshold * 1.15;
}
