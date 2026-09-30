(function () {
  var section = document.getElementById("nt-process");
  if (!section) return;
  var sticky = section.firstElementChild;
  var svg = sticky.querySelector("svg");
  var draw = svg ? svg.querySelectorAll("circle")[1] : null;
  var buttons = sticky.querySelectorAll("button");
  var icons = sticky.children[2] ? sticky.children[2].children : [];
  var phases = sticky.children[3] ? sticky.children[3].children : [];
  var count = buttons.length;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var circumference = 2 * Math.PI * 455.68;
  var stepDeg = 19;

  sticky.classList.add("nt-process-stage");

  function pin() {
    var rect = section.getBoundingClientRect();
    var view = window.innerHeight;
    var hold = rect.top <= 0 && rect.bottom >= view;
    sticky.style.height = view + "px";
    if (hold) {
      if (sticky.parentElement !== document.body) document.body.appendChild(sticky);
      sticky.style.position = "fixed";
      sticky.style.zIndex = "6";
      sticky.style.top = "0px";
      sticky.style.bottom = "auto";
      sticky.style.left = "0px";
      sticky.style.width = "100%";
      sticky.style.background = "linear-gradient(118deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.08) 38%, rgba(255, 255, 255, 0) 58%), linear-gradient(180deg, #f4f4f7 0%, #e6e6ec 100%)";
    } else {
      if (sticky.parentElement !== section) {
        if (rect.top > 0) section.insertBefore(sticky, section.firstChild);
        else section.appendChild(sticky);
      }
      sticky.style.background = "transparent";
      sticky.style.zIndex = "5";
      sticky.style.position = "absolute";
      sticky.style.left = "0px";
      sticky.style.width = "100%";
      if (rect.top > 0) {
        sticky.style.top = "0px";
        sticky.style.bottom = "auto";
      } else {
        sticky.style.top = "auto";
        sticky.style.bottom = "0px";
      }
    }
  }

  function paint(index) {
    var k = window.innerWidth / 1440;
    var cx = -170.88 * k;
    var cy = 430 * (window.innerHeight / 900);
    var rad = 455.68 * k;
    if (svg) {
      var size = 911.36 * k;
      svg.style.left = (cx - size / 2) + "px";
      svg.style.top = (cy - size / 2) + "px";
      svg.style.width = size + "px";
      svg.style.height = size + "px";
    }
    if (draw) {
      var drawn = (stepDeg * index) / 360 * circumference;
      draw.setAttribute("stroke-dasharray", drawn.toFixed(2) + " " + circumference.toFixed(2));
      draw.setAttribute("stroke-dashoffset", (-drawn).toFixed(2));
    }
    var nearest = Math.round(index);
    var changed = section._ntPhase !== nearest;
    if (changed) section._ntPhase = nearest;
    Array.prototype.forEach.call(phases, function (el, i) {
      var on = i === nearest;
      el.style.pointerEvents = on ? "auto" : "none";
      if (!on) {
        el.style.transition = reduceMotion ? "none" : "opacity 0.4s ease-out, transform 0.4s ease-out";
        el.style.opacity = "0";
        el.style.transform = reduceMotion ? "translateY(-50%)" : "translateY(calc(-50% + 15px))";
        return;
      }
      if (changed && !reduceMotion) {
        el.style.transition = "none";
        el.style.opacity = "0";
        el.style.transform = "translateY(calc(-50% + 15px))";
        void el.offsetWidth;
      }
      el.style.transition = reduceMotion ? "none" : "opacity 0.4s ease-out, transform 0.4s ease-out";
      el.style.opacity = "1";
      el.style.transform = "translateY(calc(-50% + 0px))";
    });
    Array.prototype.forEach.call(icons, function (el, i) {
      var on = i === nearest;
      el.style.transition = reduceMotion ? "none" : "opacity 0.4s ease-out, transform 0.4s ease-out";
      el.style.opacity = on ? "1" : "0";
      el.style.transform = on ? "scale(1)" : "scale(0.94)";
      el.style.pointerEvents = on ? "auto" : "none";
    });
    Array.prototype.forEach.call(buttons, function (btn, i) {
      var slot = i - index;
      var ang = (-stepDeg * slot) * Math.PI / 180;
      var amount = Math.max(0, 1 - Math.abs(slot));
      var scale = Math.max(0.72, 1.2 - Math.abs(slot) * 0.2);
      var x = cx + Math.cos(ang) * rad;
      var y = cy + Math.sin(ang) * rad;
      btn.style.left = "0px";
      btn.style.top = "0px";
      btn.style.transform = "translate(" + x.toFixed(2) + "px, " + y.toFixed(2) + "px) translate(-50%, -50%) rotate(" + (16.15 * slot).toFixed(2) + "deg) scale(" + scale.toFixed(3) + ")";
      var kids = btn.children;
      if (kids[0]) kids[0].style.background = "#ffffff";
      if (kids[1]) {
        kids[1].style.background = "#111";
        kids[1].style.opacity = amount.toFixed(3);
        kids[1].style.boxShadow = "0 12px 28px rgba(17, 17, 17, " + (0.18 * amount).toFixed(3) + ")";
      }
      if (kids[2]) kids[2].style.opacity = (0.22 + (1 - amount) * 0.35).toFixed(3);
      if (kids[3]) kids[3].style.opacity = (1 - amount).toFixed(3);
      if (kids[4]) {
        kids[4].style.opacity = amount.toFixed(3);
        kids[4].style.color = "#f4f4f7";
      }
      btn.setAttribute("aria-current", amount > 0.65 ? "true" : "false");
    });
  }

  function progress() {
    var rect = section.getBoundingClientRect();
    var total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, -rect.top / total));
  }

  function frame() {
    pin();
    paint(progress() * (count - 1));
  }

  Array.prototype.forEach.call(buttons, function (btn, i) {
    btn.addEventListener("click", function () {
      var rect = section.getBoundingClientRect();
      var total = rect.height - window.innerHeight;
      var top = window.pageYOffset + rect.top + total * (i / (count - 1));
      window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
    });
  });

  var scheduled = false;
  function onScroll() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      frame();
    });
  }
  frame();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
})();
