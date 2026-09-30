  (function () {
    var root = document.getElementById("faq");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    var items = [].slice.call(root.querySelectorAll(".nt-faq-item"));
    function setOpen(item, on) {
      item.classList.toggle("is-open", on);
      item.querySelector("button").setAttribute("aria-expanded", on ? "true" : "false");
    }
    items.forEach(function (item) {
      item.querySelector("button").addEventListener("click", function () {
        var willOpen = !item.classList.contains("is-open");
        items.forEach(function (other) { setOpen(other, other === item && willOpen); });
      });
    });
  })();
