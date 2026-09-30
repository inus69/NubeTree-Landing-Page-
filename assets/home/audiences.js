  (function () {
    var root = document.currentScript && document.currentScript.closest(".nt-audiences");
    if (!root) return;

    var items = [
      { n: "01", name: "Startups", title: "Startups", kicker: "Startups", copy: "Bringing new products to market quickly without massive upfront hiring overhead.", tags: ["Rapid Launch", "Cost Efficient", "MVP Build"], image: "assets/audiences/audience-startups.png", alt: "Matte white rocket on a mechanical launch cradle" },
      { n: "02", name: "SaaS", title: "SaaS\nCompanies", kicker: "SaaS Companies", copy: "Scaling features, optimizing codebases, and expanding technical capacity.", tags: ["Codebase Scaling", "Feature Dev", "Tech Capacity"], image: "assets/audiences/audience-saas.png", alt: "Stacked matte white server modules on a round pedestal" },
      { n: "03", name: "Growing", title: "Growing\nBusinesses", kicker: "Growing Businesses", copy: "Modernizing legacy applications and automating internal workflows.", tags: ["Legacy Modernization", "Workflow Automation", "System Upgrade"], image: "assets/audiences/audience-growing.png", alt: "Matte white gears and a valve on a round pedestal" },
      { n: "04", name: "Enterprise", title: "Enterprises &\nTech Leaders", kicker: "Enterprises & Tech Leaders", copy: "Managing complex systems, backlogs, and specialized Salesforce requirements.", tags: ["Enterprise Architecture", "Salesforce Integration", "Backlog Execution"], image: "assets/audiences/audience-enterprise.png", alt: "Connected white cubes on a round pedestal" },
      { n: "05", name: "Agencies", title: "Software\nAgencies", kicker: "Software Agencies", copy: "Partnering for reliable, confidential white-label development capacity.", tags: ["White-Label Dev", "On-Demand Scale", "Confidential Partner"], image: "assets/audiences/audience-agencies.png", alt: "Two matte robotic hands in a handshake above a pedestal" }
    ];

    var VIEW_W = 1000;
    var VIEW_H = 84;
    var BASELINE = 68;
    var AMP = 40;
    var HALF = 138;
    var STIFFNESS = 180;
    var DAMPING = 20;

    var floatEl = root.querySelector(".nt-audiences-float");
    var card = root.querySelector(".nt-audiences-card");
    var swap = root.querySelector(".nt-audiences-swap");
    var wave = root.querySelector(".nt-audiences-wave");
    var dot = root.querySelector(".nt-audiences-dot");
    var nodeEls = root.querySelectorAll(".nt-audiences-nodes span");
    var picks = root.querySelector(".nt-audiences-picks");
    var buttons = root.querySelectorAll(".nt-audiences-pick");
    var stage = root.querySelector(".nt-audiences-stage");
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    var pos = 2;
    var vel = 0;
    var target = 2;
    var committed = 2;
    var running = false;
    var seq = 0;
    var hoverTimer = 0;

    function liftAt(x, centerX) {
      var dist = Math.abs(x - centerX);
      if (dist >= HALF) return 0;
      return 0.5 * (1 + Math.cos((Math.PI * dist) / HALF));
    }

    function wavePath(centerX) {
      var d = "";
      var steps = 80;
      for (var s = 0; s <= steps; s++) {
        var x = (s / steps) * VIEW_W;
        var y = BASELINE - AMP * liftAt(x, centerX);
        d += (s === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(2) + " ";
      }
      return d;
    }

    function layout() {
      if (!floatEl || !card) return;
      floatEl.style.height = (card.offsetHeight + 22) + "px";
    }

    function render() {
      var fraction = (pos + 0.5) / items.length;
      var centerX = fraction * VIEW_W;
      if (wave) wave.setAttribute("d", wavePath(centerX));
      if (dot) {
        dot.style.left = (centerX / VIEW_W) * 100 + "%";
        dot.style.top = ((BASELINE - AMP) / VIEW_H) * 100 + "%";
      }
      for (var n = 0; n < nodeEls.length; n++) {
        var nx = ((n + 0.5) / items.length) * VIEW_W;
        var ny = BASELINE - AMP * liftAt(nx, centerX);
        nodeEls[n].style.left = (nx / VIEW_W) * 100 + "%";
        nodeEls[n].style.top = (ny / VIEW_H) * 100 + "%";
        nodeEls[n].style.opacity = Math.abs(nx - centerX) < 42 ? "0" : "1";
      }
      if (card && floatEl) {
        var width = floatEl.clientWidth || 1;
        var centerPx = fraction * width;
        if (width < 760) {
          var half = card.offsetWidth / 2;
          centerPx = Math.max(half, Math.min(width - half, centerPx));
        }
        card.style.left = "0px";
        card.style.transform = "translate3d(" + (centerPx - card.offsetWidth / 2) + "px, 0, 0)";
      }
      var nearest = Math.round(pos);
      if (nearest < 0) nearest = 0;
      if (nearest > items.length - 1) nearest = items.length - 1;
      buttons.forEach(function (button, i) {
        var dist = pos - i;
        var influence = Math.exp(-(dist * dist) / 0.18);
        var name = button.querySelector(".nt-audiences-pick-name");
        if (name) name.style.transform = "scale(" + (0.9 + 0.22 * influence).toFixed(3) + ")";
        button.classList.toggle("is-active", i === nearest);
      });
    }

    function fillPane(pane, item) {
      var image = pane.querySelector("img");
      if (image) {
        image.src = item.image;
        image.alt = item.alt;
      }
      var badge = pane.querySelector(".nt-audiences-badge");
      var kicker = pane.querySelector(".nt-audiences-card-kicker");
      var title = pane.querySelector(".nt-audiences-card-title");
      var copy = pane.querySelector(".nt-audiences-copy");
      var tags = pane.querySelector(".nt-audiences-tags");
      if (badge) badge.textContent = item.n;
      if (kicker) kicker.textContent = item.kicker;
      if (title) title.textContent = item.title;
      if (copy) copy.textContent = item.copy;
      if (tags) {
        tags.textContent = "";
        item.tags.forEach(function (tag) {
          var pill = document.createElement("span");
          pill.className = "nt-audiences-tag";
          pill.textContent = tag;
          tags.appendChild(pill);
        });
      }
      card.setAttribute("aria-label", item.kicker + ". " + item.copy);
    }

    function showContent(index, direction, animate) {
      var item = items[index];
      var current = swap.querySelector(".nt-audiences-pane:not(.is-leave)") || swap.querySelector(".nt-audiences-pane");
      if (!current) return;
      if (!animate) {
        fillPane(current, item);
        var extras = swap.querySelectorAll(".nt-audiences-pane");
        for (var i = 0; i < extras.length; i++) {
          if (extras[i] !== current && extras[i].parentNode) extras[i].parentNode.removeChild(extras[i]);
        }
        current.classList.remove("is-leave");
        current.style.opacity = "";
        current.style.transform = "";
        swap.style.minHeight = "";
        layout();
        return;
      }
      var token = ++seq;
      var oldH = current.offsetHeight;
      var next = current.cloneNode(true);
      fillPane(next, item);
      next.classList.remove("is-leave");
      next.style.transition = "none";
      next.style.opacity = "0";
      next.style.transform = "translateX(" + (-direction * 28) + "px)";
      swap.appendChild(next);
      current.classList.add("is-leave");
      swap.style.minHeight = Math.max(oldH, next.offsetHeight) + "px";
      void next.offsetWidth;
      next.style.transition = "";
      current.style.opacity = "0";
      current.style.transform = "translateX(" + (direction * 28) + "px)";
      next.style.opacity = "1";
      next.style.transform = "translateX(0px)";
      layout();
      window.setTimeout(function () {
        if (token !== seq) return;
        var stale = swap.querySelectorAll(".nt-audiences-pane.is-leave");
        for (var s = 0; s < stale.length; s++) {
          if (stale[s].parentNode) stale[s].parentNode.removeChild(stale[s]);
        }
        next.style.opacity = "";
        next.style.transform = "";
        swap.style.minHeight = "";
        layout();
      }, 560);
    }

    function syncAria() {
      buttons.forEach(function (button, i) {
        var on = i === committed;
        button.setAttribute("aria-selected", on ? "true" : "false");
        button.tabIndex = on ? 0 : -1;
      });
    }

    function kick() {
      if (running) return;
      running = true;
      var last = performance.now();
      function frame(now) {
        var remaining = Math.min(0.05, (now - last) / 1000);
        last = now;
        while (remaining > 0) {
          var step = Math.min(0.016, remaining);
          var acc = -STIFFNESS * (pos - target) - DAMPING * vel;
          vel += acc * step;
          pos += vel * step;
          remaining -= step;
        }
        var settled = Math.abs(pos - target) < 0.0006 && Math.abs(vel) < 0.01;
        if (settled) {
          pos = target;
          vel = 0;
          running = false;
        }
        render();
        if (!settled) window.requestAnimationFrame(frame);
      }
      window.requestAnimationFrame(frame);
    }

    function setTarget(index, commit) {
      if (index < 0 || index >= items.length) return;
      if (commit) committed = index;
      if (index === target) {
        syncAria();
        return;
      }
      var direction = index > target ? 1 : -1;
      target = index;
      showContent(index, direction, !reduce);
      syncAria();
      if (reduce) {
        pos = target;
        vel = 0;
        render();
        return;
      }
      kick();
    }

    buttons.forEach(function (button) {
      var index = Number(button.getAttribute("data-nt-index"));
      button.addEventListener("click", function () {
        window.clearTimeout(hoverTimer);
        setTarget(index, true);
      });
      if (canHover) {
        button.addEventListener("mouseenter", function () {
          window.clearTimeout(hoverTimer);
          hoverTimer = window.setTimeout(function () {
            setTarget(index, false);
          }, 70);
        });
      }
    });

    if (canHover && stage) {
      stage.addEventListener("mouseleave", function () {
        window.clearTimeout(hoverTimer);
        if (target !== committed) setTarget(committed, false);
      });
    }

    if (picks) {
      picks.addEventListener("keydown", function (event) {
        var next;
        if (event.key === "ArrowRight") next = Math.min(items.length - 1, committed + 1);
        else if (event.key === "ArrowLeft") next = Math.max(0, committed - 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else return;
        event.preventDefault();
        setTarget(next, true);
        if (buttons[next]) buttons[next].focus();
      });
    }

    if (typeof ResizeObserver === "function" && floatEl) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = floatEl.clientWidth;
        if (w === lastW) return;
        lastW = w;
        render();
      }).observe(floatEl);
    }

    syncAria();
    render();
    layout();
    window.addEventListener("load", function () {
      layout();
      render();
    });
  })();
