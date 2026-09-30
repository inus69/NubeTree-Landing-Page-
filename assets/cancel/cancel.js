  (function () {
    var token = new URLSearchParams(window.location.search).get("token") || "";
    var button = document.getElementById("cancel-button");
    var status = document.getElementById("cancel-status");
    if (!/^[a-f0-9]{16,128}$/.test(token)) {
      button.hidden = true;
      status.textContent = "This cancellation link is not valid. Contact hr@nubetree.com and we will help.";
      return;
    }
    button.addEventListener("click", function () {
      button.disabled = true;
      status.textContent = "Cancelling...";
      fetch("/api/discovery-call/cancel/" + encodeURIComponent(token), {
        method: "POST",
        headers: { Accept: "application/json" }
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.success === false) throw new Error(body.message || "");
          button.hidden = true;
          status.textContent = "Your discovery call is cancelled.";
        });
      }).catch(function (error) {
        button.disabled = false;
        status.textContent = error && error.message ? error.message : "We couldn't reach the server. Try again in a moment.";
      });
    });
  })();
