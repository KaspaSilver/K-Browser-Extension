// Swipe left to hide (K iOS b0f0a4e6, Manage Addresses' swipeActions, like marking mail read): a
// partial swipe leaves the orange Hide button showing, a full swipe hides at once. On a PC the
// swipe is a drag with the mouse or a two-finger sideways swipe on a trackpad; the row's own menu
// keeps Hide Address for anyone who never swipes.
//
//   bindSwipeToHide(wrap, { onHide }) -> wrap is a .swipe-wrap holding the card (.swipe-card) and
//   its .swipe-hide button. Returns { wasSwiped() }: true right after a swipe or while the row is
//   open, so the card's click (open the address) can step aside; a click on an open row closes it.

const OPEN_WIDTH = 84;

/** Closes every row on the page left swiped open except `except`; true when one was. */
export function closeOpenSwipeRows(root, except = null) {
  let closed = false;
  for (const wrap of root.querySelectorAll(".swipe-wrap.open")) {
    if (wrap === except) continue;
    wrap._swipeSet?.(0, true);
    closed = true;
  }
  return closed;
}

export function bindSwipeToHide(wrap, { onHide }) {
  const card = wrap.querySelector(".swipe-card");
  const button = wrap.querySelector(".swipe-hide");
  let offset = 0;
  let start = null;
  let mode = null;          // null | "swipe" | "scroll"
  let swallow = false;      // the click that ends a swipe doesn't open the address
  let wheelTimer = 0;

  const width = () => wrap.clientWidth || 320;
  const set = (x, animate) => {
    offset = Math.max(-width(), Math.min(0, x));
    const transition = animate ? "transform .2s ease, width .2s ease" : "none";
    card.style.transition = transition;
    button.style.transition = animate ? "width .2s ease" : "none";
    card.style.transform = offset ? `translateX(${offset}px)` : "";
    button.style.width = `${-offset}px`;
    wrap.classList.toggle("open", offset < 0);
  };
  wrap._swipeSet = set;

  const hide = () => {
    set(-width(), true);
    setTimeout(() => onHide(), 180);
  };
  /** Where a let-go swipe settles: hidden past 60 %, open past 40 px, else closed. */
  const settle = () => {
    if (offset < -width() * 0.6) hide();
    else if (offset < -40) { set(-OPEN_WIDTH, true); closeOpenSwipeRows(document, wrap); }
    else set(0, true);
  };

  button.onclick = (event) => { event.stopPropagation(); hide(); };

  const onMove = (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) mode = "swipe";
      else if (Math.abs(dy) > 8) mode = "scroll";
    }
    if (mode === "swipe") set(start.base + dx, false);
  };
  const end = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (!start) return;
    start = null;
    if (mode === "swipe") {
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
      settle();
    }
  };
  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("[data-menu]")) return;
    start = { x: event.clientX, y: event.clientY, base: offset };
    mode = null;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  // a drag that selects text or drags the card as an image would fight the swipe
  card.addEventListener("dragstart", (event) => event.preventDefault());

  // Two fingers sideways on a trackpad: the row follows, and settles once the fingers stop.
  wrap.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    set(offset - event.deltaX, false);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(settle, 140);
  }, { passive: false });

  return {
    /** True when this click should not open the address: it ended a swipe, or closed an open row. */
    wasSwiped() {
      if (swallow) return true;
      if (offset < 0) { set(0, true); return true; }
      return closeOpenSwipeRows(document);
    },
  };
}
