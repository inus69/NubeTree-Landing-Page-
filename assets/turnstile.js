(function (global) {
  var meta = document.querySelector('meta[name="nt-turnstile-site-key"]');
  var siteKey = meta ? meta.getAttribute("content") : "";
  var loading = null;

  function securityError() {
    var error = new Error("Please complete the security check and try again.");
    error.code = "SECURITY_CHECK_FAILED";
    return error;
  }

  function load() {
    if (global.turnstile) return Promise.resolve(global.turnstile);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = function () { resolve(global.turnstile); };
        script.onerror = function () {
          loading = null;
          script.remove();
          reject(securityError());
        };
        document.head.appendChild(script);
      });
    }
    return loading;
  }

  function token(container, action) {
    if (!siteKey) return Promise.resolve("");
    return load().then(function (turnstile) {
      return new Promise(function (resolve, reject) {
        if (container.ntWidget != null) {
          try { turnstile.remove(container.ntWidget); } catch { /* The old widget may already be gone. */ }
        }
        container.hidden = false;
        container.ntWidget = turnstile.render(container, {
          sitekey: siteKey,
          action: action,
          appearance: "interaction-only",
          callback: resolve,
          "error-callback": function () { reject(securityError()); return true; },
          "timeout-callback": function () { reject(securityError()); }
        });
      });
    });
  }

  if (siteKey) load().catch(function () {});

  global.ntTurnstile = { enabled: Boolean(siteKey), token: token };
})(window);
