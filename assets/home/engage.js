  (function () {
    var root = document.currentScript && document.currentScript.closest(".nt-engage");
    if (!root) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var cards = root.querySelectorAll(".nt-engage-card");
    if (reduce) {
      root.classList.add("is-in");
      return;
    }
    root.classList.add("is-ready");
    if ("IntersectionObserver" in window) {
      var watch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          root.classList.add("is-in");
          watch.disconnect();
        });
      }, { threshold: 0.18 });
      watch.observe(root);
    } else {
      root.classList.add("is-in");
    }
    cards.forEach(function (card) {
      card.addEventListener("pointermove", function (event) {
        var box = card.getBoundingClientRect();
        card.style.setProperty("--mx", (event.clientX - box.left) + "px");
        card.style.setProperty("--my", (event.clientY - box.top) + "px");
      });
    });
  })();
