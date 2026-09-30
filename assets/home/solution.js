(function () {
  var root = document.getElementById("solution");
  if (!root || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("is-ready");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      root.classList.add("is-in");
      io.disconnect();
    });
  }, { threshold: 0.16 });
  io.observe(root);
})();
