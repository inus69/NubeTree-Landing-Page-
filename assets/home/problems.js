(function () {
  var root = document.getElementById("problems");
  if (!root) return;
  var viewport = root.querySelector(".nt-problems-viewport");
  var grid = root.querySelector(".nt-problems-grid");
  if (!viewport || !grid) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var originals = [].slice.call(grid.children);
  originals.forEach(function (node) {
    var copy = node.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    grid.appendChild(copy);
  });
  var paused = false;
  var hold = 0;
  var speed = 0.65;
  viewport.addEventListener("pointerenter", function () { paused = true; });
  viewport.addEventListener("pointerleave", function () { paused = false; });
  viewport.addEventListener("wheel", function () { hold = 80; }, { passive: true });
  function frame() {
    if (hold > 0) hold -= 1;
    if (!paused && hold <= 0) {
      var span = grid.scrollWidth / 2;
      if (span > 8) {
        var next = viewport.scrollLeft + speed;
        if (next >= span) next -= span;
        viewport.scrollLeft = next;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
