(function () {
  var menu = document.getElementById("nt-menu");
  if (!menu) return;
  var buttons = [].slice.call(document.querySelectorAll('[data-framer-name="Menu"]'));
  function setOpen(on) {
    menu.hidden = !on;
    document.documentElement.classList.toggle("nt-menu-open", on);
    buttons.forEach(function (btn) {
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Close menu" : "Open menu");
    });
    if (on) {
      var closeBtn = menu.querySelector(".nt-menu-close");
      if (closeBtn) closeBtn.focus();
    }
  }
  buttons.forEach(function (btn) {
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "nt-menu");
    btn.setAttribute("aria-label", "Open menu");
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      setOpen(menu.hidden);
    });
    btn.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setOpen(menu.hidden);
    });
  });
  menu.addEventListener("click", function (event) {
    if (event.target.closest("[data-nt-menu-close]") || event.target.closest(".nt-menu-list a")) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !menu.hidden) setOpen(false);
  });
})();
