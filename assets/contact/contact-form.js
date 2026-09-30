  (function () {
    var form = document.getElementById("contact-form");
    var summary = document.getElementById("form-errors");
    var summaryList = summary.querySelector("ul");
    var alertBox = document.getElementById("form-alert");
    var alertText = document.getElementById("form-alert-text");
    var status = document.getElementById("form-status");
    var success = document.getElementById("contact-success");
    var successText = document.getElementById("contact-success-text");
    var again = document.getElementById("contact-again");
    var button = form.querySelector("button[type=submit]");
    var buttonLabel = button.textContent;
    // Mirrors CONTACT_LIMITS and the email and phone rules in server/src/validate.js.
    var EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
    var PHONE_CHARS = /^\+?[0-9 ()./-]+$/;
    var RETRY_MS = 2000;
    var TIMEOUT_MS = 20000;
    var startedAt = Date.now();
    var submissionKey = "";
    var lifecycle = "IDLE";
    form.setAttribute("data-contact-state", lifecycle);

    function required(label, max) {
      return function (v) {
        if (!v) return "Enter a " + label;
        return v.length > max ? "Keep the " + label + " under " + max + " characters" : "";
      };
    }

    var fields = [
      { id: "first-name", name: "firstName", label: "First Name", test: required("first name", 80) },
      { id: "last-name", name: "lastName", label: "Last Name", test: required("last name", 80) },
      { id: "email", name: "email", label: "Email", test: function (v) {
        if (!v) return "Enter an email address";
        return v.length > 160 || !EMAIL.test(v) ? "Enter a valid email address, like name@company.com" : "";
      } },
      { id: "phone", name: "phone", label: "Phone", test: function (v) {
        if (!v) return "Enter a phone number";
        var digits = v.replace(/\D/g, "").length;
        return v.length > 40 || !PHONE_CHARS.test(v) || digits < 7 || digits > 15 ? "Enter a valid phone number with 7 to 15 digits" : "";
      } },
      { id: "city", name: "city", label: "City", test: required("city", 80) },
      { id: "state", name: "state", label: "State/Province", test: required("state or province", 80) },
      { id: "company", name: "company", label: "Company", test: function (v) {
        return v.length > 160 ? "Keep the company name under 160 characters" : "";
      } },
      { id: "message", name: "message", label: "Message/Queries", test: function (v) {
        if (v.length < 10) return "Enter a message of at least 10 characters";
        return v.length > 4000 ? "Keep the message under 4000 characters" : "";
      } }
    ];

    function newKey() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    /** idle | submitting | success | error */
    function setState(state, message, nextLifecycle) {
      if (nextLifecycle) lifecycle = nextLifecycle;
      var displayState = lifecycle === "SPAM_DETECTED" ? "success" : state;
      form.setAttribute("data-state", displayState);
      form.setAttribute("data-contact-state", lifecycle === "SPAM_DETECTED" ? "SUCCESS" : lifecycle);
      var busy = displayState === "submitting";
      form.setAttribute("aria-busy", busy ? "true" : "false");
      button.disabled = busy;
      button.textContent = busy ? "Sending..." : buttonLabel;
      status.hidden = !busy;
      status.textContent = busy ? "Sending your message..." : "";
      alertBox.hidden = displayState !== "error" || !message;
      alertText.textContent = displayState === "error" ? message || "" : "";
      form.hidden = displayState === "success";
      success.hidden = displayState !== "success";
      if (displayState === "error" && message) alertBox.focus();
      if (displayState === "success") success.focus();
    }

    function errorLifecycle(error) {
      if (error && (error.code === "VALIDATION_ERROR" || error.fields)) return "VALIDATION_ERROR";
      if (error && error.code === "RATE_LIMITED") return "RATE_LIMITED";
      if (!error || !error.code || error.code === "network") return "NETWORK_ERROR";
      return "SERVER_ERROR";
    }

    function clearField(input) {
      var field = input.closest(".nt-field");
      field.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      var note = field.querySelector(".nt-field-error");
      if (note) note.remove();
    }

    function clearProblems() {
      summaryList.textContent = "";
      summary.hidden = true;
      summary.removeAttribute("role");
      fields.forEach(function (item) { clearField(document.getElementById(item.id)); });
    }

    function showProblems(problems) {
      problems.forEach(function (problem) {
        var input = document.getElementById(problem.id);
        var field = input.closest(".nt-field");
        var note = document.createElement("p");
        note.className = "nt-field-error";
        note.id = problem.id + "-error";
        note.textContent = problem.message;
        field.appendChild(note);
        field.classList.add("is-invalid");
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", note.id);
        var item = document.createElement("li");
        var link = document.createElement("a");
        link.href = "#" + problem.id;
        link.textContent = problem.label + ": " + problem.message;
        item.appendChild(link);
        summaryList.appendChild(item);
      });
      summary.hidden = false;
      summary.setAttribute("role", "alert");
      summary.setAttribute("aria-labelledby", "form-errors-title");
      summary.focus();
    }

    fields.forEach(function (item) {
      document.getElementById(item.id).addEventListener("input", function () {
        clearField(this);
        submissionKey = "";
        if (lifecycle !== "IDLE" && lifecycle !== "SUBMITTING") setState("idle", "", "IDLE");
      });
    });

    function wait(ms) {
      return new Promise(function (done) { setTimeout(done, ms); });
    }

    function post(payload, tries) {
      var challenge = window.ntTurnstile ? window.ntTurnstile.token(document.getElementById("contact-turnstile"), "contact") : Promise.resolve("");
      return challenge.then(function (turnstileToken) {
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : 0;
        return fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": submissionKey },
          body: JSON.stringify(Object.assign({ turnstileToken: turnstileToken }, payload)),
          signal: controller ? controller.signal : undefined
        }).finally(function () { clearTimeout(timer); });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok && body.success !== false) return body;
          if (body.code === "SUBMISSION_IN_PROGRESS" && tries > 1) {
            return wait(RETRY_MS).then(function () { return post(payload, tries - 1); });
          }
          var error = new Error(body.message || "Something went wrong. Please try again.");
          error.code = body.code || "SERVER";
          error.fields = body.fields || null;
          throw error;
        });
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (form.getAttribute("data-state") === "submitting") return;
      clearProblems();
      var values = {};
      var problems = [];
      fields.forEach(function (item) {
        var input = document.getElementById(item.id);
        var value = input.value.trim();
        values[item.name] = value;
        var message = item.test(value);
        if (message) problems.push({ id: item.id, label: item.label, message: message });
      });
      if (problems.length) {
        setState("idle", "", "VALIDATION_ERROR");
        showProblems(problems);
        return;
      }

      if (!submissionKey) submissionKey = newKey();
      values.website = form.elements.website ? form.elements.website.value : "";
      values.elapsedMs = Date.now() - startedAt;
      setState("submitting", "", "SUBMITTING");
      post(values, 3).then(function () {
        successText.textContent = "Thanks — your message has been received. Our team will get back to you shortly.";
        form.reset();
        submissionKey = "";
        var spamDetected = Boolean(values.website) || values.elapsedMs < 2000;
        setState("success", "", spamDetected ? "SPAM_DETECTED" : "SUCCESS");
      }).catch(function (error) {
        if (error && error.fields) {
          var serverProblems = fields.filter(function (item) { return error.fields[item.name]; }).map(function (item) {
            return { id: item.id, label: item.label, message: error.fields[item.name] };
          });
          if (serverProblems.length) {
            setState("error", "", "VALIDATION_ERROR");
            showProblems(serverProblems);
            return;
          }
        }
        var offline = !error || !error.code;
        setState("error", offline ? "We could not reach the server. Check your connection and try again. Your message is still here." : error.message, errorLifecycle(error));
      });
    });

    again.addEventListener("click", function () {
      startedAt = Date.now();
      setState("idle", "", "IDLE");
      document.getElementById("first-name").focus();
    });
  })();
