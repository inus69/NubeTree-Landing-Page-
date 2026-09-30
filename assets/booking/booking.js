(function () {
  var config = window.NT_BOOKING_CONFIG;
  var service = window.ntBookingService;
  if (!config || !service) return;

  var SERVICES = [
    ["custom-software", "Custom Software Development"],
    ["salesforce", "Salesforce Development"],
    ["salesforce-integration", "Salesforce Integration"],
    ["ai", "AI & Automation"],
    ["web-app", "Web Application Development"],
    ["uiux", "UI/UX & Product Design"],
    ["api", "API / System Integration"],
    ["other", "Other"]
  ];
  var STAGES = ["Idea / Planning", "MVP", "Existing Product", "Scaling", "Modernization", "Enterprise System", "Other"];
  var BUDGETS = ["Under $10K", "$10K – $25K", "$25K – $50K", "$50K – $100K", "$100K+", "Not Sure Yet"];
  var ZONES = [
    ["America/New_York", "Eastern Time"],
    ["America/Chicago", "Central Time"],
    ["America/Denver", "Mountain Time"],
    ["America/Los_Angeles", "Pacific Time"],
    ["America/Toronto", "Toronto"],
    ["America/Vancouver", "Vancouver"],
    ["Europe/London", "London"],
    ["Asia/Kolkata", "India"],
    ["UTC", "UTC"]
  ];
  var WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Mirrors BOOKING_LIMITS, phoneProblem, and EMAIL in server/src/validate.js. The SERVICES labels,
  // STAGES, and BUDGETS above must match BOOKING_CHOICES there, or the server refuses the booking.
  var LIMITS = { name: 120, email: 160, company: 160, phone: 40, message: 4000 };
  var EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
  var PHONE_CHARS = /^\+?[0-9 ()./-]+$/;
  var SERVER_FIELDS = {
    name: { id: "nt-name" },
    email: { id: "nt-email" },
    company: { id: "nt-company" },
    phone: { id: "nt-phone" },
    message: { id: "nt-description" },
    services: { id: "services-set", note: "services-error" },
    projectStage: { id: "stage-set", note: "stage-error" },
    budget: { id: "budget-set", note: "budget-error" }
  };

  var detectedZone = "UTC";
  try { detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* Older browsers without Intl time zones keep UTC. */ }
  if (detectedZone === "Asia/Calcutta") detectedZone = "Asia/Kolkata";

  var BOOKING_LIFECYCLE = {
    IDLE: "IDLE",
    LOADING_AVAILABILITY: "LOADING_AVAILABILITY",
    AVAILABILITY_LOADED: "AVAILABILITY_LOADED",
    SUBMITTING: "SUBMITTING",
    SUCCESS: "SUCCESS",
    SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    RATE_LIMITED: "RATE_LIMITED",
    SERVER_ERROR: "SERVER_ERROR",
    NETWORK_ERROR: "NETWORK_ERROR"
  };

  var nowParts = service.zoneParts(new Date(), detectedZone);
  var state = blankState();
  var root;
  var dialog;
  var bodyEl;
  var progressEl;
  var challengeEl;
  var lastFocus;
  var pageMode = document.body.classList.contains("nt-book-page");
  var started = false;

  function blankState() {
    return {
      step: 1,
      name: "",
      email: "",
      company: "",
      phone: "",
      services: [],
      projectStage: "",
      budget: "",
      description: "",
      timezone: detectedZone,
      viewYear: +nowParts.year,
      viewMonth: +nowParts.month,
      days: [],
      needsDays: true,
      horizonDays: 0,
      website: "",
      selectedDate: "",
      selectedTime: "",
      booking: null,
      previousSlot: "",
      cta: "website_discovery_call",
      loading: "",
      lifecycle: BOOKING_LIFECYCLE.IDLE,
      error: "",
      errorMessage: "",
      bookingError: "",
      idempotencyKey: "",
      idempotencyTime: "",
      confirmCancel: false
    };
  }

  function setLifecycle(next) {
    state.lifecycle = next;
    if (root) root.setAttribute("data-booking-state", next);
    if (dialog) {
      dialog.setAttribute("data-booking-state", next);
      dialog.setAttribute("aria-busy", next === BOOKING_LIFECYCLE.LOADING_AVAILABILITY || next === BOOKING_LIFECYCLE.SUBMITTING ? "true" : "false");
    }
  }

  function lifecycleForError(error) {
    var code = error && error.code;
    var fields = error && error.fields || {};
    if (code === "taken" || fields.startTime) return BOOKING_LIFECYCLE.SLOT_UNAVAILABLE;
    if (code === "VALIDATION_ERROR" || Object.keys(fields).length) return BOOKING_LIFECYCLE.VALIDATION_ERROR;
    if (code === "RATE_LIMITED") return BOOKING_LIFECYCLE.RATE_LIMITED;
    if (code === "network") return BOOKING_LIFECYCLE.NETWORK_ERROR;
    return BOOKING_LIFECYCLE.SERVER_ERROR;
  }

  function track(name, detail) {
    var entry = { event: name, at: new Date().toISOString(), detail: detail || {} };
    window.ntBookingEvents = window.ntBookingEvents || [];
    window.ntBookingEvents.push(entry);
    if (window.dataLayer && window.dataLayer.push) window.dataLayer.push(entry);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function zoneChoices() {
    var list = ZONES.slice();
    var known = list.some(function (item) { return item[0] === state.timezone; });
    if (!known) list.unshift([state.timezone, state.timezone]);
    return list;
  }

  function mount() {
    root = document.getElementById("nt-booking");
    if (!root) {
      root = document.createElement("div");
      root.id = "nt-booking";
      root.hidden = true;
      document.body.appendChild(root);
    }
    root.innerHTML = pageMode ? "" : '<div class="nt-book-backdrop" data-nt-book-close></div>';
    dialog = document.createElement("div");
    dialog.className = "nt-book-dialog";
    dialog.setAttribute("role", pageMode ? "region" : "dialog");
    if (!pageMode) {
      dialog.setAttribute("aria-modal", "true");
    }
    dialog.setAttribute("aria-labelledby", "nt-book-title");
    dialog.setAttribute("data-booking-state", state.lifecycle);
    dialog.setAttribute("aria-busy", "false");
    dialog.innerHTML =
      (pageMode ? "" : '<button type="button" class="nt-book-close" data-nt-book-close>Close</button>') +
      '<ol class="nt-book-progress"></ol><div class="nt-book-body"></div><div class="nt-turnstile" hidden></div>';
    root.appendChild(dialog);
    root.setAttribute("data-booking-state", state.lifecycle);
    progressEl = dialog.querySelector(".nt-book-progress");
    bodyEl = dialog.querySelector(".nt-book-body");
    challengeEl = dialog.querySelector(".nt-turnstile");
    root.addEventListener("click", onRootClick);
    dialog.addEventListener("keydown", onKey);
  }

  function onKey(event) {
    if (event.key === "Escape" && !pageMode) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || pageMode) return;
    var nodes = dialog.querySelectorAll("a, button, input, textarea, select");
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].disabled && !nodes[i].closest("[hidden]")) list.push(nodes[i]);
    }
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onRootClick(event) {
    var closer = event.target.closest("[data-nt-book-close]");
    if (closer) close();
  }

  function open(options) {
    options = options || {};
    if (state.step === 3 || state.step === "cancelled") state = blankState();
    if (state.step === 1) state.needsDays = true;
    if (options.cta) state.cta = options.cta;
    if (options.serviceId && state.services.indexOf(options.serviceId) === -1 && SERVICES.some(function (item) { return item[0] === options.serviceId; })) {
      state.services.push(options.serviceId);
    }
    track("discovery_cta_clicked", { cta: state.cta });
    track("booking_form_opened", { cta: state.cta });
    if (!pageMode) {
      lastFocus = document.activeElement;
      root.hidden = false;
      document.documentElement.classList.add("nt-booking-open");
    }
    paint(true);
  }

  function close() {
    if (pageMode) {
      window.location.href = "index.html";
      return;
    }
    if (started && state.step !== 3 && state.step !== "cancelled") track("booking_abandoned", { step: state.step });
    root.hidden = true;
    document.documentElement.classList.remove("nt-booking-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function paint(moveFocus) {
    setLifecycle(state.lifecycle);
    if (state.step === 2 && !state.selectedTime) state.step = 1;
    var active = document.activeElement;
    var keepFocus = Boolean(active && active.id === "nt-book-title" && dialog.contains(active));
    progressEl.innerHTML = progressHtml();
    progressEl.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        rememberForm();
        showCalendar();
      });
    });
    if (state.step === 1) bodyEl.innerHTML = calendarHtml();
    else if (state.step === 2) bodyEl.innerHTML = formHtml();
    else if (state.step === "cancelled") bodyEl.innerHTML = cancelledHtml();
    else bodyEl.innerHTML = confirmHtml();
    bind();
    var title = document.getElementById("nt-book-title");
    if ((moveFocus || keepFocus) && title) title.focus();
    if (state.step === 1 && state.needsDays && !state.loading) loadMonth();
  }

  function showCalendar() {
    state.step = 1;
    state.needsDays = true;
    paint(true);
  }

  function rememberForm() {
    var form = bodyEl.querySelector("form");
    if (form) readForm(form);
  }

  function progressHtml() {
    var items = ["Choose Time", "Your Details", "Confirmed"];
    return items.map(function (label, index) {
      var number = index + 1;
      var cls = state.step === number ? "is-current" : (state.step > number || state.step === "cancelled" && number < 3 ? "is-done" : "");
      var text = (number < 10 ? "0" + number : number) + " " + label;
      if (cls === "is-done" && number === 1 && state.step === 2 && !state.loading) {
        return '<li><button type="button" class="is-done" data-step="1">' + text + "</button></li>";
      }
      return '<li><span class="' + cls + '">' + text + "</span></li>";
    }).join("");
  }

  function selectedLabel() {
    if (!state.selectedTime) return { when: "", zone: "" };
    var at = new Date(state.selectedTime);
    var when = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: state.timezone }).format(at) +
      " · " + new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: state.timezone }).format(at);
    var named = ZONES.filter(function (item) { return item[0] === state.timezone; })[0];
    return { when: when, zone: (named ? named[1] + " (" + state.timezone + ")" : state.timezone) + " · 30 minutes" };
  }

  function choice(type, name, value, label, pressed) {
    return '<label class="nt-book-choice"><input type="' + type + '" name="' + name + '" value="' + esc(value) + '"' + (pressed ? " checked" : "") + '><span>' + esc(label) + "</span></label>";
  }

  function formHtml() {
    var picked = selectedLabel();
    var busy = state.loading === "book";
    var note = state.bookingError ? '<p class="nt-book-banner" role="alert">' + esc(state.bookingError) + "</p>" : "";
    return '<div class="nt-book-step nt-book-split">' +
      '<div class="nt-book-copy"><p class="nt-book-kicker">Discovery call</p><h2 id="nt-book-title" tabindex="-1">Let’s Talk About Your Project</h2>' +
      '<p>Tell us a little about what you\'re building, improving, or trying to solve. This helps us make your discovery call more productive.</p>' +
      '<ul class="nt-book-trust"><li>30-minute conversation</li><li>No obligation</li><li>Talk directly with experienced engineers</li></ul>' +
      '<p class="nt-book-aside">Serving growing businesses, SaaS teams, and enterprise organizations across the USA and Canada.</p></div>' +
      '<form class="nt-book-form" novalidate>' + note +
      '<div class="nt-book-picked"><div><span class="nt-book-picked-label">Your call</span><strong>' + esc(picked.when) + '</strong><span>' + esc(picked.zone) + '</span></div>' +
      '<button type="button" class="nt-book-btn is-ghost" data-change' + (busy ? " disabled" : "") + '>Change</button></div>' +
      '<div id="nt-book-summary" class="nt-book-summary" hidden tabindex="-1"></div>' +
      '<h3>About You</h3>' +
      field("name", "Full Name", "text", "Your full name", state.name, "name", LIMITS.name) +
      field("email", "Work Email", "email", "you@company.com", state.email, "email", LIMITS.email) +
      field("company", "Company", "text", "Company name", state.company, "organization", LIMITS.company) +
      '<h3>About Your Project</h3>' +
      '<fieldset id="services-set"><legend>What do you need help with?</legend><div class="nt-book-choices">' +
      SERVICES.map(function (item) { return choice("checkbox", "service", item[0], item[1], state.services.indexOf(item[0]) !== -1); }).join("") +
      '</div><p class="nt-book-error" id="services-error" hidden></p></fieldset>' +
      '<fieldset id="stage-set"><legend>Project Stage</legend><div class="nt-book-choices">' +
      STAGES.map(function (item) { return choice("radio", "stage", item, item, state.projectStage === item); }).join("") +
      '</div><p class="nt-book-error" id="stage-error" hidden></p></fieldset>' +
      '<fieldset id="budget-set"><legend>Estimated Project Budget</legend><div class="nt-book-choices">' +
      BUDGETS.map(function (item) { return choice("radio", "budget", item, item, state.budget === item); }).join("") +
      '</div><p class="nt-book-error" id="budget-error" hidden></p></fieldset>' +
      '<div class="nt-book-field"><label for="nt-description">Tell us about your project</label><textarea id="nt-description" name="description" maxlength="' + LIMITS.message + '" placeholder="What are you trying to build, improve, integrate, or solve?">' + esc(state.description) + "</textarea></div>" +
      '<h3>Contact Preference</h3>' +
      field("phone", "Phone / WhatsApp (Optional)", "tel", "+1 (555) 000-0000", state.phone, "tel", LIMITS.phone) +
      '<p class="nt-book-hp"><label for="nt-website">Leave this field empty</label><input id="nt-website" name="website" tabindex="-1" autocomplete="off"></p>' +
      '<div class="nt-book-actions"><button type="button" class="nt-book-btn is-ghost" data-back' + (busy ? " disabled" : "") + '>Back</button><button type="submit" class="nt-book-btn"' + (busy ? " disabled" : "") + ">" + (busy ? "Booking your call..." : "Book Discovery Call") + "</button></div>" +
      "</form></div>";
  }

  function field(id, label, type, placeholder, value, auto, max) {
    return '<div class="nt-book-field" data-field="' + id + '"><label for="nt-' + id + '">' + label + '</label><input id="nt-' + id + '" name="' + id + '" type="' + type + '" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" autocomplete="' + auto + '" maxlength="' + max + '"></div>';
  }

  function loadingSkeleton() {
    var days = "";
    var slots = "";
    for (var dayIndex = 0; dayIndex < 35; dayIndex++) days += '<span class="nt-book-skeleton nt-book-skeleton-day"></span>';
    for (var slot = 0; slot < 4; slot++) slots += '<span class="nt-book-skeleton nt-book-skeleton-slot"></span>';
    return '<div class="nt-book-loading" role="status" aria-live="polite"><span>Checking availability...</span>' +
      '<div class="nt-book-week" aria-hidden="true">' + WEEK.map(function (day) { return "<span>" + day.charAt(0) + "</span>"; }).join("") + "</div>" +
      '<div class="nt-book-grid" aria-hidden="true">' + days + "</div>" +
      '<div class="nt-book-slots" aria-hidden="true">' + slots + "</div></div>";
  }

  function calendarHtml() {
    var title = "Choose a Time That Works for You";
    var monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(state.viewYear, state.viewMonth - 1, 1)));
    var zones = zoneChoices().map(function (item) {
      return '<option value="' + esc(item[0]) + '"' + (item[0] === state.timezone ? " selected" : "") + ">" + esc(item[1]) + "</option>";
    }).join("");
    var main = loadingSkeleton();
    if (state.error) {
      var errorText = state.errorMessage || "We couldn't load available times right now. Please try again in a moment.";
      main = '<div class="nt-book-error-panel" role="alert"><p class="nt-book-banner">' + esc(errorText) + '</p><div class="nt-book-actions"><button type="button" class="nt-book-btn" data-retry>Try Again</button><a class="nt-book-btn is-ghost" href="contact.html">Contact Us</a></div></div>';
    } else if (!state.loading) {
      var first = state.days[0];
      var offset = first ? WEEK.indexOf(first.weekday) : 0;
      if (offset < 0) offset = 0;
      var cells = "";
      for (var i = 0; i < offset; i++) cells += "<span></span>";
      state.days.forEach(function (day) {
        var dayNum = day.date.slice(-2).replace(/^0/, "");
        var selected = day.date === state.selectedDate;
        cells += '<button type="button" class="nt-book-day' + (selected ? " is-selected" : "") + '" data-date="' + day.date + '"' + (day.available ? "" : " disabled") + ' aria-pressed="' + (selected ? "true" : "false") + '" aria-label="' + day.date + (day.available ? ", available" : ", unavailable") + '">' + dayNum + "</button>";
      });
      var slots = "";
      var selectedDay = state.days.filter(function (day) { return day.date === state.selectedDate; })[0];
      if (selectedDay) {
        slots = '<div class="nt-book-slots">' + selectedDay.slots.map(function (slot) {
          var on = slot.startUtc === state.selectedTime;
          return '<button type="button" class="nt-book-slot' + (on ? " is-selected" : "") + '" data-slot="' + esc(slot.startUtc) + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(slot.label) + "</button>";
        }).join("") + "</div>";
      }
      main = '<div class="nt-book-cal-head"><h3>' + monthName + '</h3><div class="nt-book-nav"><button type="button" class="nt-book-btn is-ghost" data-month="-1">Previous</button><button type="button" class="nt-book-btn is-ghost" data-month="1">Next</button></div></div>' +
        '<div class="nt-book-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="nt-book-grid">' + cells + "</div>" + slots;
    }
    var note = state.bookingError ? '<p class="nt-book-banner" role="alert">' + esc(state.bookingError) + "</p>" : "";
    return '<div class="nt-book-step">' + note +
      '<p class="nt-book-kicker">30 minutes</p><h2 id="nt-book-title" tabindex="-1">' + title + "</h2>" +
      '<p class="nt-book-lead">Select a convenient time for a 30-minute discovery call. Times are shown in the timezone you choose.</p>' +
      '<div class="nt-book-field" style="max-width:320px;margin-top:16px"><label for="nt-zone">Your timezone: ' + esc(state.timezone) + '</label><select id="nt-zone">' + zones + "</select></div>" +
      main +
      (state.error ? "" : '<div class="nt-book-actions"><button type="button" class="nt-book-btn is-ghost" data-back>Back</button>' + calendarAction() + "</div>") +
      "</div>";
  }

  function calendarAction() {
    var ready = state.selectedTime && !state.loading ? "" : " disabled";
    if (state.previousSlot) {
      return '<button type="button" class="nt-book-btn" data-book' + ready + ">" + (state.loading === "book" ? "Booking your call..." : "Confirm new time") + "</button>";
    }
    return '<button type="button" class="nt-book-btn" data-next' + ready + ">Continue to Your Details →</button>";
  }

  function confirmHtml() {
    var booking = state.booking || {};
    var when = booking.selected_time ? new Date(booking.selected_time) : null;
    var dateLabel = when ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: booking.timezone }).format(when) : "";
    var timeLabel = when ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: booking.timezone }).format(when) : "";
    var emailLine = booking.confirmationEmailStatus === "FAILED"
      ? "<li>Your time is booked. The confirmation email could not be sent just now. The team still has the appointment.</li>"
      : "<li>You'll receive a confirmation email.</li>";
    return '<div class="nt-book-step nt-book-confirm"><p class="nt-book-kicker">Confirmed</p><h2 id="nt-book-title" tabindex="-1">You\'re All Set.</h2>' +
      '<p class="nt-book-lead">Thanks — your discovery call is booked.</p>' +
      '<div class="nt-book-card"><dl>' +
      row("Appointment", "Discovery Call") + row("Length", "30 minutes") + row("Date", dateLabel) + row("Time", timeLabel) +
      row("Timezone", booking.timezone || "") + row("Email", booking.email || "") +
      (booking.meeting_link ? row("Meeting", booking.meeting_link) : "") +
      "</dl></div>" +
      "<h3 class=\"nt-book-copy\" style=\"margin-top:22px;font-family:Instrument Serif,Georgia,serif;font-size:28px;font-weight:400\">What Happens Next</h3><ol class=\"nt-book-next\">" + emailLine +
      "<li>We'll review the information you shared.</li><li>We'll use the call to understand your goals, challenges, and requirements.</li><li>We'll discuss potential next steps if there's a good fit.</li></ol>" +
      '<div class="nt-book-actions"><button type="button" class="nt-book-btn" data-ics>Add to Calendar</button><button type="button" class="nt-book-btn is-ghost" data-reschedule>Reschedule</button><button type="button" class="nt-book-btn is-ghost" data-cancel>Cancel appointment</button><button type="button" class="nt-book-btn is-ghost" data-nt-book-close>Back to Website</button></div></div>';
  }

  function row(label, value) {
    return "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>";
  }

  function cancelledHtml() {
    return '<div class="nt-book-step"><h2 id="nt-book-title" tabindex="-1">This call has been cancelled.</h2><p class="nt-book-lead">The time has been released. You can book another conversation whenever you\'re ready.</p><div class="nt-book-actions"><button type="button" class="nt-book-btn" data-restart>Book a Free Discovery Call</button></div></div>';
  }

  function oneLine(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function readForm(form) {
    state.name = oneLine(form.name.value);
    state.email = oneLine(form.email.value);
    state.company = oneLine(form.company.value);
    state.phone = oneLine(form.phone.value);
    state.description = form.description.value.trim();
    state.services = [];
    form.querySelectorAll('input[name="service"]:checked').forEach(function (input) { state.services.push(input.value); });
    var stage = form.querySelector('input[name="stage"]:checked');
    var budget = form.querySelector('input[name="budget"]:checked');
    state.projectStage = stage ? stage.value : "";
    state.budget = budget ? budget.value : "";
    return form.website && form.website.value;
  }

  function showErrors(form, problems) {
    form.querySelectorAll(".nt-book-error").forEach(function (node) { node.hidden = true; node.textContent = ""; });
    form.querySelectorAll(".is-invalid").forEach(function (node) { node.classList.remove("is-invalid"); });
    var summary = document.getElementById("nt-book-summary");
    summary.hidden = false;
    summary.innerHTML = "<strong>There is a problem</strong><ul></ul>";
    var list = summary.querySelector("ul");
    problems.forEach(function (problem) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#" + problem.id;
      link.textContent = problem.message;
      item.appendChild(link);
      list.appendChild(item);
      var target = document.getElementById(problem.id);
      if (target) {
        var wrap = target.closest(".nt-book-field") || target;
        wrap.classList.add("is-invalid");
        var note = document.getElementById(problem.note);
        if (note) {
          note.hidden = false;
          note.textContent = problem.message;
        } else if (target.parentNode.classList.contains("nt-book-field")) {
          var p = document.createElement("p");
          p.className = "nt-book-error";
          p.textContent = problem.message;
          target.parentNode.appendChild(p);
        }
      }
    });
    summary.focus();
  }

  function phoneOk(phone) {
    if (!phone) return true;
    var digits = phone.replace(/\D/g, "").length;
    return phone.length <= LIMITS.phone && PHONE_CHARS.test(phone) && digits >= 7 && digits <= 15;
  }

  function validate(form) {
    var problems = [];
    if (state.name.length < 2) problems.push({ id: "nt-name", message: "Please enter your name." });
    else if (state.name.length > LIMITS.name) problems.push({ id: "nt-name", message: "Please keep your name under " + LIMITS.name + " characters." });
    if (state.email.length > LIMITS.email || !EMAIL.test(state.email)) problems.push({ id: "nt-email", message: "Please enter a valid work email." });
    if (state.company.length < 2) problems.push({ id: "nt-company", message: "Please enter your company." });
    else if (state.company.length > LIMITS.company) problems.push({ id: "nt-company", message: "Please keep the company name under " + LIMITS.company + " characters." });
    if (!phoneOk(state.phone)) problems.push({ id: "nt-phone", message: "Please enter a valid phone number, or leave it blank." });
    if (state.description.length > LIMITS.message) problems.push({ id: "nt-description", message: "Please keep project details under " + LIMITS.message + " characters." });
    if (!state.services.length) problems.push({ id: "services-set", note: "services-error", message: "Select at least one service." });
    if (!state.projectStage) problems.push({ id: "stage-set", note: "stage-error", message: "Select a project stage." });
    if (!state.budget) problems.push({ id: "budget-set", note: "budget-error", message: "Select an estimated budget." });
    if (problems.length) {
      setLifecycle(BOOKING_LIFECYCLE.VALIDATION_ERROR);
      showErrors(form, problems);
    }
    return !problems.length;
  }

  function applyAvailability(result) {
    state.days = result.days || [];
    if (result.horizonDays > 0) state.horizonDays = result.horizonDays;
    state.loading = "";
    setLifecycle(BOOKING_LIFECYCLE.AVAILABILITY_LOADED);
    if (state.selectedDate) {
      var still = state.days.filter(function (day) { return day.date === state.selectedDate && day.available; })[0];
      if (!still) {
        state.selectedDate = "";
        state.selectedTime = "";
      } else if (state.selectedTime && !still.slots.some(function (slot) { return slot.startUtc === state.selectedTime; })) {
        state.selectedTime = "";
      }
    }
    paint(false);
  }

  // Display only: the server re-checks the slot when the booking is submitted.
  function loadMonth() {
    state.needsDays = false;
    state.error = "";
    state.loading = "availability";
    setLifecycle(BOOKING_LIFECYCLE.LOADING_AVAILABILITY);
    paint(false);
    track("calendar_viewed", { timezone: state.timezone });
    service.getAvailability({ timezone: state.timezone, year: state.viewYear, month: state.viewMonth }).then(function (result) {
      applyAvailability(result);
    }).catch(function (error) {
      state.loading = "";
      state.error = "availability";
      setLifecycle(lifecycleForError(error));
      state.errorMessage = error && error.code === "NOT_CONFIGURED" ? error.message : "";
      if (state.lifecycle === BOOKING_LIFECYCLE.RATE_LIMITED) state.errorMessage = "Too many requests. Please wait a moment and try again.";
      if (state.lifecycle === BOOKING_LIFECYCLE.NETWORK_ERROR) state.errorMessage = "We couldn't load available times. Check your connection and try again.";
      if (state.lifecycle === BOOKING_LIFECYCLE.SERVER_ERROR && !state.errorMessage) state.errorMessage = "We couldn't load available times right now. Please try again in a moment.";
      state.days = [];
      paint(true);
    });
  }

  function shiftMonth(delta) {
    var month = state.viewMonth + delta;
    var year = state.viewYear;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    var todayParts = service.zoneParts(new Date(), state.timezone);
    var currentKey = todayParts.year + "-" + todayParts.month;
    var nextKey = year + "-" + (month < 10 ? "0" : "") + month;
    var horizon = new Date(Date.now() + (state.horizonDays || config.horizonDays) * 86400000);
    var horizonParts = service.zoneParts(horizon, state.timezone);
    var horizonKey = horizonParts.year + "-" + horizonParts.month;
    if (nextKey < currentKey || nextKey > horizonKey) return;
    state.viewYear = year;
    state.viewMonth = month;
    loadMonth();
  }

  function tooMany() {
    var now = Date.now();
    var hits = [];
    try { hits = JSON.parse(sessionStorage.getItem("nt-book-rate") || "[]"); } catch { /* Storage can be blocked; the server still rate limits. */ }
    hits = hits.filter(function (time) { return now - time < 3600000; });
    if (hits.length >= 5) return true;
    hits.push(now);
    try { sessionStorage.setItem("nt-book-rate", JSON.stringify(hits)); } catch { /* Storage can be blocked; the server still rate limits. */ }
    return false;
  }

  function readIdempotency() {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem("nt-book-idempotency") || "null");
      if (saved && typeof saved.key === "string" && typeof saved.selectedTime === "string") return saved;
    } catch { /* Storage can be blocked; in-memory retries still use the same key. */ }
    return null;
  }

  function clearIdempotency() {
    state.idempotencyKey = "";
    state.idempotencyTime = "";
    try { window.sessionStorage.removeItem("nt-book-idempotency"); } catch { /* Storage can be blocked. */ }
  }

  function ensureIdempotency() {
    if (state.idempotencyKey && state.idempotencyTime === state.selectedTime) return;
    var saved = readIdempotency();
    state.idempotencyKey = saved && saved.selectedTime === state.selectedTime
      ? saved.key
      : (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2));
    state.idempotencyTime = state.selectedTime;
    try {
      window.sessionStorage.setItem("nt-book-idempotency", JSON.stringify({ key: state.idempotencyKey, selectedTime: state.selectedTime }));
    } catch { /* Storage can be blocked; in-memory retries still use the same key. */ }
  }

  function book() {
    if (!state.selectedTime || state.loading || state.lifecycle === BOOKING_LIFECYCLE.SUBMITTING) return;
    if (tooMany()) {
      state.bookingError = "Please wait a little while before booking another time.";
      setLifecycle(BOOKING_LIFECYCLE.RATE_LIMITED);
      paint(false);
      return;
    }
    state.loading = "book";
    setLifecycle(BOOKING_LIFECYCLE.SUBMITTING);
    state.bookingError = "";
    ensureIdempotency();
    paint(false);
    attempt(0);
  }

  function attempt(tries) {
    var challenge = window.ntTurnstile ? window.ntTurnstile.token(challengeEl, "booking") : Promise.resolve("");
    challenge.then(function (turnstileToken) {
      return service.createBooking(bookingPayload(turnstileToken));
    }).then(function (booking) {
      state.booking = booking;
      state.previousSlot = "";
      clearIdempotency();
      state.bookingError = "";
      state.loading = "";
      state.step = 3;
      setLifecycle(BOOKING_LIFECYCLE.SUCCESS);
      track("booking_completed", { booking_id: booking.booking_id, mode: booking.mode });
      paint(true);
    }).catch(function (error) {
      if (error.code === "BOOKING_IN_PROGRESS" && tries < 3) {
        setTimeout(function () { attempt(tries + 1); }, 2000);
        return;
      }
      state.loading = "";
      track("booking_failed", { code: error.code || "network" });
      bookingFailed(error);
    });
  }

  function bookingFailed(error) {
    var fields = error.fields || {};
    setLifecycle(lifecycleForError(error));
    if (error.code === "taken" || fields.startTime) {
      clearIdempotency();
      state.bookingError = error.code === "taken"
        ? "This time slot is no longer available. Please select another time."
        : fields.startTime;
      state.selectedTime = "";
      showCalendar();
      return;
    }
    if (error.code === "IDEMPOTENCY_MISMATCH") clearIdempotency();
    if (error.code === "RATE_LIMITED") {
      state.bookingError = error.message || "Too many requests. Please try again later.";
    } else if (error.code === "network") {
      state.bookingError = "We couldn't reach the scheduling service. Check your connection and try again.";
    } else {
      state.bookingError = error.message || "Something went wrong while confirming your appointment. Your information has not been lost. Please try again.";
    }
    paint(false);
    var form = bodyEl.querySelector("form");
    var problems = Object.keys(fields).filter(function (key) { return SERVER_FIELDS[key]; }).map(function (key) {
      return { id: SERVER_FIELDS[key].id, note: SERVER_FIELDS[key].note, message: fields[key] };
    });
    if (form && problems.length) showErrors(form, problems);
    else {
      var banner = bodyEl.querySelector(".nt-book-banner");
      if (banner) {
        banner.setAttribute("tabindex", "-1");
        banner.focus();
      }
    }
  }

  function bookingPayload(turnstileToken) {
    return {
      name: state.name,
      email: state.email,
      company: state.company,
      phone: state.phone,
      services: state.services.map(serviceLabel),
      projectStage: state.projectStage,
      budget: state.budget,
      description: state.description,
      timezone: state.timezone,
      selectedDate: state.selectedDate,
      selectedTime: state.selectedTime,
      previousSlot: state.previousSlot,
      rescheduleToken: state.previousSlot && state.booking ? state.booking.reschedule_token : "",
      idempotencyKey: state.idempotencyKey,
      website: state.website,
      turnstileToken: turnstileToken,
      cta: state.cta
    };
  }

  function serviceLabel(id) {
    var match = SERVICES.filter(function (item) { return item[0] === id; })[0];
    return match ? match[1] : id;
  }

  function downloadIcs() {
    var booking = state.booking;
    if (!booking || !booking.selected_time) return;
    var start = booking.selected_time.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var endDate = new Date(new Date(booking.selected_time).getTime() + 30 * 60000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var description = [
      "Prospect: " + booking.name,
      "Company: " + booking.company,
      "Email: " + booking.email,
      "Phone: " + (booking.phone || ""),
      "Services: " + (booking.services || []).join(", "),
      "Stage: " + booking.project_stage,
      "Budget: " + booking.budget,
      "Project: " + (booking.project_description || "")
    ].join("\\n");
    var ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NubeTree//Discovery Call//EN",
      "BEGIN:VEVENT",
      "UID:" + booking.booking_id + "@nubetree.com",
      "DTSTAMP:" + start,
      "DTSTART:" + start,
      "DTEND:" + endDate,
      "SUMMARY:Nubetree — Discovery Call",
      "DESCRIPTION:" + description.replace(/\r?\n/g, "\\n"),
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    var blob = new Blob([ics], { type: "text/calendar" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "nubetree-discovery-call.ics";
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function bind() {
    var form = bodyEl.querySelector("form");
    if (form) {
      form.addEventListener("input", function () {
        if (!started) {
          started = true;
          track("booking_form_started", {});
        }
      });
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var honeypot = readForm(form);
        state.website = form.website ? form.website.value : "";
        if (honeypot) {
          state.bookingError = "Please check the highlighted fields.";
          paint(false);
          return;
        }
        if (!validate(form)) return;
        track("booking_form_completed", {});
        book();
      });
    }
    bodyEl.querySelectorAll("[data-back], [data-change]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (state.step === 1) {
          close();
          return;
        }
        rememberForm();
        state.bookingError = "";
        showCalendar();
      });
    });
    var next = bodyEl.querySelector("[data-next]");
    if (next) next.addEventListener("click", function () {
      if (!state.selectedTime || state.loading) return;
      state.bookingError = "";
      state.step = 2;
      paint(true);
    });
    var zone = document.getElementById("nt-zone");
    if (zone) {
      zone.addEventListener("change", function () {
        state.timezone = zone.value;
        state.selectedTime = "";
        loadMonth();
      });
    }
    bodyEl.querySelectorAll("[data-month]").forEach(function (button) {
      button.addEventListener("click", function () { shiftMonth(+button.getAttribute("data-month")); });
    });
    bodyEl.querySelectorAll("[data-date]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.selectedDate = button.getAttribute("data-date");
        state.selectedTime = "";
        paint(false);
        var chosen = bodyEl.querySelector('[data-date="' + state.selectedDate + '"]');
        if (chosen) chosen.focus();
      });
    });
    bodyEl.querySelectorAll("[data-slot]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.selectedTime = button.getAttribute("data-slot");
        state.idempotencyKey = "";
        state.bookingError = "";
        track("slot_selected", { slot: state.selectedTime });
        paint(false);
        var chosen = bodyEl.querySelector('[data-slot="' + state.selectedTime + '"]');
        if (chosen) chosen.focus();
      });
    });
    var bookBtn = bodyEl.querySelector("[data-book]");
    if (bookBtn) bookBtn.addEventListener("click", book);
    var retry = bodyEl.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", function () { loadMonth(); });
    var ics = bodyEl.querySelector("[data-ics]");
    if (ics) ics.addEventListener("click", downloadIcs);
    var reschedule = bodyEl.querySelector("[data-reschedule]");
    if (reschedule) reschedule.addEventListener("click", function () {
      state.previousSlot = state.booking ? state.booking.selected_time : "";
      state.selectedTime = "";
      state.bookingError = "";
      state.confirmCancel = false;
      showCalendar();
    });
    var cancel = bodyEl.querySelector("[data-cancel]");
    if (cancel) cancel.addEventListener("click", function () {
      if (!state.confirmCancel) {
        state.confirmCancel = true;
        cancel.textContent = "Confirm cancellation";
        return;
      }
      service.cancelBooking(state.booking).then(function () {
        state.step = "cancelled";
        state.confirmCancel = false;
        paint(true);
      }).catch(function () {
        state.bookingError = "Something went wrong while confirming your appointment. Your information has not been lost. Please try again.";
        paint(true);
      });
    });
    var restart = bodyEl.querySelector("[data-restart]");
    if (restart) restart.addEventListener("click", function () {
      var kept = { name: state.name, email: state.email, company: state.company, phone: state.phone, timezone: state.timezone };
      clearIdempotency();
      state = blankState();
      state.name = kept.name;
      state.email = kept.email;
      state.company = kept.company;
      state.phone = kept.phone;
      state.timezone = kept.timezone;
      started = true;
      paint(true);
    });
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-nt-book]");
    if (!trigger || trigger.closest("#nt-booking")) return;
    event.preventDefault();
    open({
      cta: trigger.getAttribute("data-nt-book") || "website_discovery_call",
      serviceId: trigger.getAttribute("data-service") || ""
    });
  });

  window.ntOpenBooking = open;
  mount();
  if (pageMode) {
    state.cta = "discovery_page";
    track("booking_form_opened", { cta: state.cta });
    paint(true);
  }
})();
