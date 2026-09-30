(function () {
  var root = document.querySelector(".nt-built");
  if (!root) return;
  var slides = [].slice.call(root.querySelectorAll(".nt-built-slide"));
  var viewport = root.querySelector(".nt-built-viewport");
  var dots = root.querySelector(".nt-built-dots");
  var allBtn = root.querySelector(".nt-built-all-btn");
  var all = root.querySelector(".nt-built-all");
  var index = 0;
  var count = slides.length;
  if (!count) return;

  slides.forEach(function (slide, i) {
    var dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", "Case study " + (i + 1));
    dot.addEventListener("click", function () { go(i); });
    dots.appendChild(dot);
    slide.addEventListener("click", function (event) {
      if (event.target.closest("a")) return;
      if (!slide.classList.contains("is-active")) go(i);
    });
  });

  function go(next) {
    index = (next % count + count) % count;
    paint();
  }

  function deltaFor(i) {
    var delta = i - index;
    if (delta > count / 2) delta -= count;
    if (delta < -count / 2) delta += count;
    return delta;
  }

  function paint() {
    slides.forEach(function (slide, i) {
      var delta = deltaFor(i);
      slide.classList.remove("is-active", "is-prev", "is-next", "is-far");
      slide.style.setProperty("--nt-shift", String(delta));
      if (delta === 0) slide.classList.add("is-active");
      else if (delta === -1) slide.classList.add("is-prev");
      else if (delta === 1) slide.classList.add("is-next");
      else slide.classList.add("is-far");
      if (delta === 0) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", "true");
    });
    [].forEach.call(dots.children, function (dot, i) {
      var on = i === index;
      dot.setAttribute("aria-selected", on ? "true" : "false");
      dot.tabIndex = on ? 0 : -1;
    });
  }

  root.querySelector(".is-prev").addEventListener("click", function () { go(index - 1); });
  root.querySelector(".is-next").addEventListener("click", function () { go(index + 1); });
  viewport.addEventListener("keydown", function (event) {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
  });

  var startX = 0;
  var dragging = false;
  viewport.addEventListener("pointerdown", function (event) {
    if (event.target.closest("a, button")) return;
    dragging = true;
    startX = event.clientX;
  });
  viewport.addEventListener("pointerup", function (event) {
    if (!dragging) return;
    dragging = false;
    var move = event.clientX - startX;
    if (move > 40) go(index - 1);
    else if (move < -40) go(index + 1);
  });

  allBtn.addEventListener("click", function () {
    var open = all.hasAttribute("hidden");
    if (open) all.removeAttribute("hidden");
    else all.setAttribute("hidden", "");
    allBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  root.classList.add("is-ready");
  paint();
})();
