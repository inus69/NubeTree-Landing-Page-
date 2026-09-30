(function () {
  var root = document.querySelector(".nt-services-root");
  if (!root || root.getAttribute("data-nt-services") === "ready") return;
  root.setAttribute("data-nt-services", "ready");

  var SERVICES = [
    {
      file: "custom-software-development.mp4",
      name: "Custom Software Development",
      does: "Design, architect, and build scalable web applications tailored specifically to your business workflows.",
      solves: "Eliminates rigid out-of-the-box software constraints and automates manual business bottlenecks.",
      who: "Growing businesses and enterprises needing bespoke software systems.",
      serviceId: "custom-software",
      cta: "Discuss Custom Development"
    },
    {
      file: "saas-product-development.mp4",
      name: "SaaS Product Development",
      does: "Build robust, multi-tenant SaaS products from the ground up or scale existing platforms for high user growth.",
      solves: "Accelerates time-to-market without inflating internal headcount costs.",
      who: "Startups and SaaS companies looking to ship features faster.",
      serviceId: "web-app",
      cta: "Scale Your SaaS Product"
    },
    {
      file: "salesforce-development-integration.mp4",
      name: "Salesforce Development & Integration",
      does: "Custom Apex development, Lightning Web Components (LWC), CPQ implementation, and enterprise CRM architecture.",
      solves: "Turns underutilized CRM environments into streamlined operational engines.",
      who: "Enterprises, CRM managers, and companies requiring deep Salesforce customization.",
      serviceId: "salesforce",
      cta: "Explore Salesforce Expertise"
    },
    {
      file: "mobile-application-development.mp4",
      name: "Mobile Application Development",
      does: "Native and cross-platform mobile app development focused on performance, security, and intuitive user experiences.",
      solves: "Extends your digital product ecosystem into the hands of mobile users.",
      who: "Companies launching new mobile solutions or scaling existing apps.",
      serviceId: "custom-software",
      cta: "Build Your Mobile App"
    },
    {
      file: "api-backend.jpg",
      name: "API & Backend Development",
      does: "Build secure, high-performance backend systems, REST/SOAP APIs, and complex third-party system integrations.",
      solves: "Removes data silos and connects disparate software platforms cleanly.",
      who: "Organizations needing reliable data pipelines and secure backend architecture.",
      serviceId: "api",
      cta: "Strengthen Your Backend"
    },
    {
      file: "crm-implementation.mp4",
      name: "CRM Implementation",
      does: "Full-cycle CRM setup, data migration, user workflow optimization, and custom dashboard creation.",
      solves: "Replaces messy spreadsheets with a centralized, reliable source of truth for sales and operations.",
      who: "Growing businesses upgrading their customer relationship operations.",
      serviceId: "salesforce",
      cta: "Optimize Your CRM"
    },
    {
      file: "maintenance-modernization.mp4",
      name: "Maintenance & Modernization",
      does: "Refactor legacy codebases, optimize database performance, resolve persistent bugs, and implement continuous updates.",
      solves: "Protects existing software investments from system degradation and unexpected downtime.",
      who: "Companies with legacy software that requires constant care.",
      serviceId: "other",
      cta: "Secure Your Application Support"
    },
    {
      file: "dedicated-engineering-support.mp4",
      name: "Dedicated Engineering Support",
      does: "Embed vetted senior developers directly into your existing workflow to act as your extended engineering team.",
      solves: "Instantly clears product backlogs and scales output without full-time hiring liabilities.",
      who: "CTOs, VPs of Engineering, and software agencies needing immediate extra capacity.",
      serviceId: "other",
      cta: "Hire Dedicated Engineers"
    },
    {
      file: "ai-automation.mp4",
      name: "AI Automation",
      does: "Design and build automation for the repeatable work inside your operations and product workflows.",
      solves: "Takes manual handoffs off the team so people spend time on the work that needs judgment.",
      who: "Teams losing senior time to the same process, again and again.",
      serviceId: "other",
      cta: "Discuss AI Automation"
    },
    {
      file: "cloud.mp4",
      name: "Cloud",
      does: "Design, migrate, and run applications on cloud infrastructure with a clear owner for each environment.",
      solves: "Replaces fragile hosting with infrastructure that can grow with the product.",
      who: "Companies moving off local servers or tightening how cloud environments are run.",
      serviceId: "other",
      cta: "Plan Your Cloud Move"
    },
    {
      file: "erp.mp4",
      name: "ERP",
      does: "Implement and connect ERP workflows so finance, operations, and delivery share one system of record.",
      solves: "Replaces disconnected back-office tools with a process the business can actually run.",
      who: "Organizations that have outgrown spreadsheets and standalone operational tools.",
      serviceId: "other",
      cta: "Talk Through an ERP Build"
    },
    {
      file: "uiux-design.mp4",
      name: "UI/UX Design",
      does: "Shape product interfaces, flows, and the interface system before and alongside engineering.",
      solves: "Gives development a clear product to build, instead of assembling screens as the work proceeds.",
      who: "Teams launching a product or repairing an interface people struggle to use.",
      serviceId: "web-app",
      cta: "Start a UI/UX Project"
    },
    {
      file: "website-development.mp4",
      name: "Website Development",
      does: "Design and build marketing and product websites that stay fast, clear, and straightforward to update.",
      solves: "Replaces a site that cannot keep up with the offer, the brand, or the campaign.",
      who: "Companies that need a site their team can trust in front of customers.",
      serviceId: "web-app",
      cta: "Build Your Website"
    }
  ];

  var COUNT = SERVICES.length;
  var PANEL_W = 860;
  var PANEL_H = 600;
  var GLIDE = 0.72;
  var INTERVAL = 6.4;
  var SHADOW = "0px 28px 80px 0px rgba(28, 32, 60, 0.22)";
  var available = [];
  var activeScene = 0;
  var sceneTime = 0;
  var sceneLast = 0;
  var sceneRaf = 0;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function circ(a, b, n) {
    if (n < 1) return 0;
    var r = (a - b) % n;
    if (r > n / 2) r -= n;
    if (r < -n / 2) r += n;
    return r;
  }
  function mod(v, n) {
    return ((v % n) + n) % n;
  }
  function pad(index) {
    var n = index + 1;
    return n < 10 ? "0" + n : String(n);
  }
  function computeSeats(panelW, panelH, count, sideW, ratio, taper, gap, spanCount) {
    var list = [];
    var edge = panelW / 2;
    var span = panelW / 2;
    var i, scale, w, h;
    for (i = 1; i <= count; i++) {
      scale = Math.pow(taper, i - 1);
      w = Math.max(14, sideW * scale);
      h = Math.max(28, panelH * ratio * scale);
      edge = edge + gap + w;
      list.push({ w: w, h: h, centre: edge - w / 2 });
      if (i <= spanCount) span = edge;
    }
    return { seats: list, span: span };
  }
  function ringFor(depth) {
    return COUNT * Math.max(1, Math.ceil((2 * depth + 3) / COUNT));
  }
  function layoutFrom(width, height) {
    var pagerSpace = 64;
    var vPad = clamp(height * 0.04, 8, 28);
    var availH = Math.max(220, height - vPad * 2 - pagerSpace);
    var hPad = clamp(width * 0.03, 8, 36);
    var availW = Math.max(160, width - hPad * 2);
    var depth, pack, k;
    if (width < 720) {
      k = clamp(Math.min(availW / 420, availH / 760), 0.42, 1.05);
      return {
        stacked: true,
        k: k,
        depth: 0,
        seats: computeSeats(420, 760, 1, 64, 0.72, 0.66, 14, 0).seats,
        ring: ringFor(0),
        dW: 420,
        dH: 760
      };
    }
    depth = Math.min(2, Math.floor((COUNT - 1) / 2));
    if (width < 1180) depth = Math.min(depth, 1);
    pack = computeSeats(PANEL_W, PANEL_H, depth + 1, 112, 0.72, 0.66, 14, depth);
    k = clamp(Math.min(availW / (pack.span * 2), availH / PANEL_H), 0.2, 1.15);
    while (k < 0.62 && depth > 0) {
      depth -= 1;
      pack = computeSeats(PANEL_W, PANEL_H, depth + 1, 112, 0.72, 0.66, 14, depth);
      k = clamp(Math.min(availW / (pack.span * 2), availH / PANEL_H), 0.2, 1.15);
    }
    return { stacked: false, k: k, depth: depth, seats: pack.seats, ring: ringFor(depth), dW: PANEL_W, dH: PANEL_H };
  }
  function depthScale(t) {
    if (t <= 0) return 1.04;
    if (t <= 1) return 1.04 - t * 0.16;
    if (t <= 2) return 0.88 - (t - 1) * 0.18;
    return 0.7;
  }
  function depthOpacity(t, depth) {
    if (t <= 0) return 1;
    if (t > depth + 0.15) return 0;
    if (t <= 1) return 1 - t * 0.22;
    return Math.max(0, 0.78 - (t - 1) * 0.38);
  }
  function place(offset, L) {
    var t = Math.abs(offset);
    var M = L.k;
    var w = L.dW * M;
    var h = L.dH * M;
    var radius = L.stacked ? 24 : 28;
    var spread = w * (L.stacked ? 0.62 : 0.46);
    var x = offset === 0 ? 0 : (offset > 0 ? 1 : -1) * (t <= 1 ? t * spread : spread + (t - 1) * spread * 0.62);
    return {
      x: x,
      w: w,
      h: h,
      scale: depthScale(t),
      r: radius * M,
      pad: 0,
      op: depthOpacity(t, L.stacked ? 0.2 : L.depth)
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function paintPanel(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  function packet(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(236, 226, 210, 0.95)";
    ctx.fill();
  }

  var scenes = [
    function (ctx, w, h, t) {
      var nodes = 4;
      var i, y, nx, ny, px, py, u;
      px = w * 0.62;
      py = h * 0.22;
      paintPanel(ctx, px, py, w * 0.28, h * 0.56);
      for (i = 0; i < 3; i++) {
        ctx.fillStyle = "rgba(255,255,255," + (0.08 + i * 0.04) + ")";
        roundRect(ctx, px + 14, py + 36 + i * 28, w * 0.16 * (0.55 + 0.15 * Math.sin(t + i)), 8, 3);
        ctx.fill();
      }
      for (i = 0; i < nodes; i++) {
        y = h * (0.22 + i * 0.16);
        nx = w * 0.16;
        ny = y;
        paintPanel(ctx, nx, ny, w * 0.22, h * 0.1);
        u = (t * 0.18 + i * 0.17) % 1;
        ctx.strokeStyle = "rgba(236,226,210,0.45)";
        ctx.beginPath();
        ctx.moveTo(nx + w * 0.22, ny + h * 0.05);
        ctx.bezierCurveTo(w * 0.46, ny, w * 0.5, py + h * 0.28, px, py + h * 0.28);
        ctx.stroke();
        packet(ctx, nx + w * 0.22 + (px - nx - w * 0.22) * u, ny + (py + h * 0.2 - ny) * u);
      }
    },
    function (ctx, w, h, t) {
      var cx = w * 0.5;
      var cy = h * 0.5;
      var i, a, rad, x, y;
      paintPanel(ctx, cx - w * 0.12, cy - h * 0.1, w * 0.24, h * 0.2);
      for (i = 0; i < 6; i++) {
        a = t * 0.35 + (i / 6) * Math.PI * 2;
        rad = Math.min(w, h) * (0.28 + (i % 2) * 0.06);
        x = cx + Math.cos(a) * rad;
        y = cy + Math.sin(a) * rad * 0.72;
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
        paintPanel(ctx, x - 16, y - 10, 32, 20);
      }
    },
    function (ctx, w, h, t) {
      var i, y, u;
      paintPanel(ctx, w * 0.1, h * 0.18, w * 0.28, h * 0.64);
      for (i = 0; i < 4; i++) {
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        roundRect(ctx, w * 0.14, h * (0.28 + i * 0.12), w * 0.2, 10, 3);
        ctx.fill();
      }
      for (i = 0; i < 3; i++) {
        y = h * (0.22 + i * 0.22);
        paintPanel(ctx, w * 0.64, y, w * 0.24, h * 0.14);
        ctx.strokeStyle = "rgba(236,226,210,0.4)";
        ctx.beginPath();
        ctx.moveTo(w * 0.38, h * 0.5);
        ctx.bezierCurveTo(w * 0.5, h * 0.5, w * 0.52, y + h * 0.07, w * 0.64, y + h * 0.07);
        ctx.stroke();
        u = (t * 0.22 + i * 0.2) % 1;
        packet(ctx, w * 0.38 + (w * 0.26) * u, h * 0.5 + (y + h * 0.07 - h * 0.5) * u);
      }
    },
    function (ctx, w, h, t) {
      var x = w * 0.34;
      var y = h * 0.08;
      var pw = w * 0.32;
      var ph = h * 0.84;
      var phase = (Math.sin(t * 0.7) + 1) / 2;
      var i;
      roundRect(ctx, x, y, pw, ph, 28);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fill();
      for (i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.25 + phase * 0.55;
        ctx.fillStyle = i === 0 ? "rgba(236,226,210,0.85)" : "rgba(255,255,255,0.14)";
        roundRect(ctx, x + 16, y + 28 + i * (ph * 0.16), pw - 32, ph * 0.1, 6);
        ctx.fill();
        if (phase < 0.45) {
          ctx.strokeStyle = "rgba(255,255,255,0.35)";
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },
    function (ctx, w, h, t) {
      var layers = 4;
      var i, y, u, x;
      for (i = 0; i < layers; i++) {
        y = h * (0.14 + i * 0.2);
        paintPanel(ctx, w * (0.18 + (i % 2) * 0.08), y, w * 0.56, h * 0.12);
        if (i < layers - 1) {
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.beginPath();
          ctx.moveTo(w * 0.5, y + h * 0.12);
          ctx.lineTo(w * 0.5, y + h * 0.2);
          ctx.stroke();
          u = (t * 0.45 + i * 0.15) % 1;
          packet(ctx, w * 0.5, y + h * 0.12 + h * 0.08 * u);
        }
      }
      for (i = 0; i < 3; i++) {
        x = w * (0.12 + i * 0.32);
        ctx.strokeStyle = "rgba(236,226,210,0.25)";
        ctx.beginPath();
        ctx.moveTo(x, h * 0.2);
        ctx.lineTo(w * 0.46, h * 0.78);
        ctx.stroke();
      }
    },
    function (ctx, w, h, t) {
      var u = (Math.sin(t * 0.55) + 1) / 2;
      var i, col, row, sx, sy, tx, ty, x, y;
      for (i = 0; i < 8; i++) {
        col = i % 4;
        row = Math.floor(i / 4);
        sx = w * (0.08 + ((i * 37) % 70) / 100);
        sy = h * (0.12 + ((i * 53) % 60) / 100);
        tx = w * (0.12 + col * 0.2);
        ty = h * (0.22 + row * 0.34);
        x = sx + (tx - sx) * u;
        y = sy + (ty - sy) * u;
        paintPanel(ctx, x, y, w * 0.16, h * 0.22);
      }
    },
    function (ctx, w, h, t) {
      var u = (Math.sin(t * 0.5) + 1) / 2;
      var i, x, y0, y1;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (i = 0; i <= 8; i++) {
        x = w * (0.12 + i * 0.09);
        y0 = h * (0.3 + Math.sin(i * 1.7 + 2) * 0.22);
        y1 = h * (0.25 + (i % 3) * 0.16);
        if (i === 0) ctx.moveTo(x, y0 + (y1 - y0) * u);
        else ctx.lineTo(x, y0 + (y1 - y0) * u);
      }
      ctx.stroke();
      for (i = 0; i < 3; i++) {
        paintPanel(ctx, w * (0.18 + i * 0.22), h * (0.58 - u * 0.08), w * 0.16, h * (0.12 + u * 0.12));
      }
    },
    function (ctx, w, h, t) {
      var cols = 3;
      var i, c, x, y, shift;
      for (c = 0; c < cols; c++) {
        x = w * (0.1 + c * 0.28);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.strokeRect(x, h * 0.12, w * 0.22, h * 0.76);
      }
    for (i = 0; i < 4; i++) {
      shift = (t * 0.16 + i * 0.2) % 1;
      c = Math.min(2, Math.floor(shift * 3));
      y = h * (0.22 + (i % 3) * 0.2);
      paintPanel(ctx, w * (0.1 + c * 0.3), y, w * 0.2, h * 0.12);
    }
  }
  ];

  function drawScene(time) {
    var canvas = mediaCanvas;
    var rect, dpr, ctx;
    if (!canvas || canvas.hidden) return;
    rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#12161d";
    ctx.fillRect(0, 0, rect.width, rect.height);
    scenes[activeScene](ctx, rect.width, rect.height, time);
  }

  function motionOn() {
    return !motionPaused && onScreen && tabOpen;
  }

  function sceneFrame(now) {
    var dt = sceneLast ? Math.min(0.05, (now - sceneLast) / 1000) : 0.016;
    sceneLast = now;
    if (motionOn() && mediaCanvas && !mediaCanvas.hidden) sceneTime += dt;
    drawScene(reduced || motionPaused ? 0.6 : sceneTime);
    if (motionOn() && mediaCanvas && !mediaCanvas.hidden) sceneRaf = requestAnimationFrame(sceneFrame);
    else sceneRaf = 0;
  }

  function kickScene() {
    if (!sceneRaf) {
      sceneLast = 0;
      sceneRaf = requestAnimationFrame(sceneFrame);
    }
  }

  var stage = document.createElement("div");
  stage.className = "nt-services-stage";
  var pager = document.createElement("div");
  pager.className = "nt-services-pager";
  root.appendChild(stage);
  root.appendChild(pager);

  var panel = document.createElement("div");
  panel.className = "nt-services-panel";
  var copy = document.createElement("div");
  copy.className = "nt-services-copy";
  var numEl = document.createElement("p");
  numEl.className = "nt-services-num";
  var nameEl = document.createElement("h3");
  nameEl.className = "nt-services-name";
  var doesLabel = document.createElement("p");
  doesLabel.className = "nt-services-label";
  doesLabel.textContent = "What we do";
  var doesEl = document.createElement("p");
  doesEl.className = "nt-services-text";
  var solvesLabel = document.createElement("p");
  solvesLabel.className = "nt-services-label";
  solvesLabel.textContent = "Solves";
  var solvesEl = document.createElement("p");
  solvesEl.className = "nt-services-text";
  var whoLabel = document.createElement("p");
  whoLabel.className = "nt-services-label";
  whoLabel.textContent = "For";
  var whoEl = document.createElement("p");
  whoEl.className = "nt-services-text";
  var ctaEl = document.createElement("a");
  ctaEl.className = "nt-services-cta";
  ctaEl.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  ctaEl.addEventListener("click", function (event) {
    if (!window.ntOpenBooking) return;
    event.preventDefault();
    event.stopPropagation();
    window.ntOpenBooking({ cta: "services", serviceId: SERVICES[activeScene].serviceId });
  });
  copy.appendChild(numEl);
  copy.appendChild(nameEl);
  copy.appendChild(doesLabel);
  copy.appendChild(doesEl);
  copy.appendChild(solvesLabel);
  copy.appendChild(solvesEl);
  copy.appendChild(whoLabel);
  copy.appendChild(whoEl);
  copy.appendChild(ctaEl);

  var media = document.createElement("div");
  media.className = "nt-services-media";
  var mediaCanvas = document.createElement("canvas");
  mediaCanvas.className = "nt-services-canvas";
  mediaCanvas.setAttribute("aria-hidden", "true");
  var video = document.createElement("video");
  video.className = "nt-services-video";
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.preload = "metadata";
  video.hidden = true;
  var still = document.createElement("img");
  still.className = "nt-services-still";
  still.alt = "";
  still.hidden = true;
  var playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "nt-services-toggle";
  playBtn.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  media.appendChild(mediaCanvas);
  media.appendChild(video);
  media.appendChild(still);
  media.appendChild(playBtn);
  panel.appendChild(copy);
  panel.appendChild(media);

  var numButtons = [];
  var fill = null;
  var s;
  for (s = 0; s < COUNT; s++) {
    (function (index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nt-services-dot";
      btn.setAttribute("aria-label", "Service " + pad(index) + ", " + SERVICES[index].name);
      btn.addEventListener("click", function () {
        goStory(index);
      });
      pager.appendChild(btn);
      numButtons.push(btn);
    })(s);
  }

  var slots = [];
  var photos = [];
  var layout = layoutFrom(1200, 760);
  var ring = layout.ring;
  var pos = 0;
  var target = 0;
  var progress = 0;
  var panelSlot = -1;
  var raf = 0;
  var last = 0;
  var onScreen = false;
  var tabOpen = document.visibilityState !== "hidden";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hovering = false;
  var motionPaused = false;
  var drag = { active: false, from: 0, moved: 0, origin: 0, lastAt: 0, speed: 0 };

  function dragRange() {
    var centre = layout.seats[0] ? layout.seats[0].centre : layout.dW * 0.6;
    return Math.max(60, centre * layout.k * 0.8);
  }
  function carouselOn() {
    return COUNT > 1 && onScreen && tabOpen && !motionPaused && !drag.active && !hovering;
  }
  function syncToggle() {
    var playing = motionOn() || (!reduced && !motionPaused && video && !video.hidden);
    playBtn.textContent = motionPaused || reduced ? "Play" : "Pause";
    playBtn.setAttribute("aria-label", (motionPaused || reduced ? "Play" : "Pause") + " service motion");
    playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
  }
  function showStory(index) {
    var story = SERVICES[index];
    numEl.textContent = pad(index);
    nameEl.textContent = story.name;
    doesEl.textContent = story.does;
    solvesEl.textContent = story.solves;
    whoEl.textContent = story.who;
    ctaEl.textContent = story.cta;
    ctaEl.href = "discovery-call.html";
    ctaEl.setAttribute("data-nt-book", "services");
    ctaEl.setAttribute("data-service", story.serviceId);
    activeScene = index;
    mountVideo(story);
  }
  function mountVideo(story) {
    var has = available.indexOf(story.file) !== -1;
    var image = has && /\.(jpe?g|png|webp)$/i.test(story.file);
    if (!has) {
      if (video.getAttribute("src")) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      video.hidden = true;
      still.hidden = true;
      mediaCanvas.hidden = false;
      kickScene();
      return;
    }
    if (image) {
      if (video.getAttribute("src")) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      video.hidden = true;
      mediaCanvas.hidden = true;
      still.hidden = false;
      if (still.getAttribute("data-file") !== story.file) {
        still.setAttribute("data-file", story.file);
        still.src = "assets/videos/services/" + story.file;
      }
      return;
    }
    still.hidden = true;
    mediaCanvas.hidden = true;
    video.hidden = false;
    if (video.getAttribute("data-file") !== story.file) {
      video.setAttribute("data-file", story.file);
      video.src = "assets/videos/services/" + story.file;
    }
    if (motionOn()) {
      video.play().catch(function () {});
    } else {
      video.pause();
    }
  }
  function updateSteps(story) {
    var i, btn, active, bar;
    for (i = 0; i < numButtons.length; i++) {
      btn = numButtons[i];
      active = i === story;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "true" : "false");
      bar = btn.querySelector(".nt-services-dot-fill");
      if (active) {
        if (!bar) {
          bar = document.createElement("span");
          bar.className = "nt-services-dot-fill";
          btn.appendChild(bar);
        }
        fill = bar;
        fill.style.transform = "scaleX(" + clamp(progress / INTERVAL, 0, 1) + ")";
      } else if (bar) {
        bar.remove();
        if (fill === bar) fill = null;
      }
    }
  }
  function setScale() {
    var h = layout.dH * layout.k;
    stage.style.height = h + "px";
    pager.style.marginTop = clamp(h * 0.045, 16, 28) + "px";
    root.classList.toggle("is-stacked", layout.stacked);
    panel.style.fontSize = Math.max(12.5, (h / (layout.stacked ? 760 : 600)) * 15.5) + "px";
  }
  function buildSlots() {
    var i, slot, photo, story, mark;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    stage.textContent = "";
    slots = [];
    photos = [];
    panelSlot = -1;
    for (i = 0; i < ring; i++) {
      story = i % COUNT;
      slot = document.createElement("div");
      slot.className = "nt-services-slot";
      photo = document.createElement("div");
      photo.className = "nt-services-poster is-scene-" + story;
      mark = document.createElement("span");
      mark.className = "nt-services-poster-num";
      mark.textContent = pad(story);
      var title = document.createElement("span");
      title.className = "nt-services-poster-name";
      title.textContent = SERVICES[story].name;
      photo.appendChild(mark);
      photo.appendChild(title);
      slot.appendChild(photo);
      (function (index) {
        slot.addEventListener("click", function () {
          if (Math.abs(drag.moved) > 6) return;
          if (index === mod(Math.round(pos), ring)) return;
          goTo(index);
        });
      })(i);
      stage.appendChild(slot);
      slots.push(slot);
      photos.push(photo);
    }
  }
  function apply() {
    var e = pos;
    var base = Math.floor(e);
    var frac = e - base;
    var from = mod(base, ring);
    var to = (from + 1) % ring;
    var i, el, fromOff, toOff, a, b, x, w, h, r, inset, op, scale, dist, shadow, rounded;
    for (i = 0; i < ring; i++) {
      el = slots[i];
      if (!el) continue;
      fromOff = circ(i, from, ring);
      toOff = circ(i, to, ring);
      a = place(fromOff, layout);
      x = a.x;
      w = a.w;
      h = a.h;
      r = a.r;
      inset = a.pad;
      op = a.op;
      scale = a.scale;
      if (Math.abs(fromOff - toOff) > 1.5) op = 0;
      else if (frac > 0) {
        b = place(toOff, layout);
        x = a.x + (b.x - a.x) * frac;
        w = a.w + (b.w - a.w) * frac;
        h = a.h + (b.h - a.h) * frac;
        r = a.r + (b.r - a.r) * frac;
        inset = a.pad + (b.pad - a.pad) * frac;
        op = a.op + (b.op - a.op) * frac;
        scale = a.scale + (b.scale - a.scale) * frac;
      }
      el.style.width = w + "px";
      el.style.height = h + "px";
      el.style.transformOrigin = "center center";
      el.style.transform = "translate3d(" + (x - w / 2) + "px, " + (-h / 2) + "px, 0) scale(" + scale + ")";
      el.style.opacity = String(op);
      el.style.borderRadius = r + "px";
      el.style.padding = inset + "px";
      dist = Math.abs(circ(i, e, ring));
      el.style.zIndex = String(dist < 0.45 ? 30 : dist < 1.45 ? 20 : 10);
      el.style.pointerEvents = op > 0.32 ? "auto" : "none";
      el.style.cursor = dist < 0.5 ? "inherit" : "pointer";
      shadow = dist < 0.5 ? SHADOW : "none";
      if (el.getAttribute("data-shadow") !== shadow) {
        el.setAttribute("data-shadow", shadow);
        el.style.boxShadow = shadow;
      }
      if (photos[i]) photos[i].style.borderRadius = Math.max(8, r - inset) + "px";
    }
    rounded = mod(Math.round(e), ring);
    if (panelSlot !== rounded && slots[rounded]) {
      panelSlot = rounded;
      slots[rounded].appendChild(panel);
      showStory(rounded % COUNT);
    }
    panel.style.opacity = String(clamp(1 - Math.abs(circ(panelSlot, e, ring)) * 2, 0, 1));
    updateSteps(rounded % COUNT);
    if (fill && carouselOn()) fill.style.transform = "scaleX(" + clamp(progress / INTERVAL, 0, 1) + ")";
  }
  function ensure() {
    if (!(onScreen && tabOpen)) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      drag.active = false;
      root.classList.remove("is-dragging");
      if (video && !video.hidden) video.pause();
      return;
    }
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    kickScene();
    if (video && !video.hidden && motionOn()) video.play().catch(function () {});
  }
  function frame(now) {
    var dt, delta;
    if (!onScreen || !tabOpen) {
      raf = 0;
      last = 0;
      return;
    }
    if (!last) last = now;
    dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    if (!drag.active) {
      delta = target - pos;
      if (Math.abs(delta) < 0.0008 || reduced) pos = target;
      else pos += delta * (1 - Math.pow(0.0016, dt / GLIDE));
    }
    if (carouselOn()) {
      progress += dt;
      if (progress >= INTERVAL) {
        progress = 0;
        target = Math.round(target) + 1;
      }
    }
    apply();
    if (!drag.active && Math.abs(target - pos) < 0.0008 && !carouselOn()) {
      pos = mod(Math.round(pos), ring);
      target = pos;
      apply();
      raf = 0;
      last = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  function resetProgress() {
    progress = 0;
    if (fill) fill.style.transform = "scaleX(0)";
  }
  function goTo(index) {
    resetProgress();
    target = Math.round(pos + circ(index, pos, ring));
    ensure();
  }
  function goStory(story) {
    var best = story;
    var bestD = Infinity;
    var r, d;
    for (r = story; r < ring; r += COUNT) {
      d = Math.abs(circ(r, pos, ring));
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    goTo(best);
  }
  function step(dir) {
    if (COUNT < 2) return;
    resetProgress();
    target = Math.round(target) + dir;
    ensure();
  }
  function onMove(e) {
    var now, dt, delta, next, velocity;
    if (!drag.active) return;
    now = performance.now();
    dt = Math.max(8, now - drag.lastAt) / 1000;
    drag.moved = e.clientX - drag.from;
    delta = -drag.moved / dragRange();
    if (Math.abs(delta) > 1) delta = Math.sign(delta) * Math.min(1.16, 1 + (Math.abs(delta) - 1) * 0.14);
    next = drag.origin + delta;
    velocity = (next - pos) / dt;
    drag.speed = drag.speed * 0.72 + velocity * 0.28;
    drag.lastAt = now;
    pos = next;
    target = next;
    apply();
  }
  function onUp() {
    var flick, steps;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (!drag.active) return;
    drag.active = false;
    root.classList.remove("is-dragging");
    flick = clamp(drag.speed * 0.2, -1, 1);
    steps = clamp(Math.round(pos - drag.origin + flick), -1, 1);
    target = Math.round(drag.origin) + steps;
    resetProgress();
    ensure();
  }

  playBtn.addEventListener("click", function () {
    motionPaused = !motionPaused;
    syncToggle();
    if (!motionOn()) {
      if (!video.hidden) video.pause();
      drawScene(0.6);
    } else {
      if (!video.hidden) video.play().catch(function () {});
      kickScene();
    }
    ensure();
  });

  stage.addEventListener("pointerdown", function (e) {
    if (COUNT < 2) return;
    if (e.button != null && e.button !== 0) return;
    drag.active = true;
    drag.from = e.clientX;
    drag.moved = 0;
    drag.origin = pos;
    drag.lastAt = performance.now();
    drag.speed = 0;
    resetProgress();
    root.classList.add("is-dragging");
    ensure();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
  stage.addEventListener("dragstart", function (e) {
    e.preventDefault();
  });
  root.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  });
  root.addEventListener("mouseenter", function () {
    hovering = true;
  });
  root.addEventListener("mouseleave", function () {
    hovering = false;
    ensure();
  });

  function syncLayout() {
    var rect = root.getBoundingClientRect();
    var next, keep;
    if (rect.width < 2 || rect.height < 2) return;
    next = layoutFrom(rect.width, rect.height);
    keep = mod(Math.round(pos), COUNT);
    layout = next;
    setScale();
    if (next.ring !== ring) {
      ring = next.ring;
      pos = keep;
      target = keep;
      buildSlots();
    }
    apply();
    kickScene();
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        onScreen = entries.some(function (entry) {
          return entry.isIntersecting;
        });
        ensure();
        if (!onScreen && video && !video.hidden) video.pause();
      },
      { rootMargin: "120px", threshold: 0.01 }
    );
    io.observe(root);
  } else {
    onScreen = true;
  }

  document.addEventListener("visibilitychange", function () {
    tabOpen = document.visibilityState !== "hidden";
    if (!tabOpen) {
      drag.active = false;
      root.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!video.hidden) video.pause();
    }
    ensure();
  });

  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function onMotion() {
    reduced = motion.matches;
    motionPaused = reduced;
    syncToggle();
    if (!video.hidden) {
      if (motionOn()) video.play().catch(function () {});
      else video.pause();
    }
    ensure();
  }
  if (motion.addEventListener) motion.addEventListener("change", onMotion);
  else if (motion.addListener) motion.addListener(onMotion);

  if ("ResizeObserver" in window) new ResizeObserver(syncLayout).observe(root);
  else window.addEventListener("resize", syncLayout);

  fetch("assets/videos/services/manifest.json")
    .then(function (res) {
      return res.ok ? res.json() : { available: [] };
    })
    .then(function (data) {
      available = data && data.available ? data.available : [];
      if (panelSlot >= 0) mountVideo(SERVICES[panelSlot % COUNT]);
    })
    .catch(function () {});

  if (reduced) motionPaused = true;
  syncToggle();
  buildSlots();
  setScale();
  syncLayout();
  if (onScreen) ensure();
  kickScene();
})();
