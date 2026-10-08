/**
 * Vesa error + route reporter plugin.
 *
 * Injects two small inline scripts into index.html:
 *   1. __VESA_RUNTIME_ERROR__  — forwards window "error" / "unhandledrejection"
 *      events to the embedding host via postMessage (used by the Vesa preview).
 *   2. __VESA_ROUTE_CHANGE__   — forwards SPA route changes (pushState /
 *      replaceState / popstate) so the host can highlight the active view.
 *
 * Both scripts are defensive: postMessage is wrapped in try/catch so a hostile
 * parent (or a sandboxed iframe) can never break the app.
 */

const ERROR_SCRIPT = `<script data-vesa-error-reporter>
(function () {
  var seen = {};
  function report(message, filename, lineno, colno, stack) {
    var sig = message + "|" + filename + "|" + lineno + "|" + colno;
    if (seen[sig]) return;
    seen[sig] = true;
    try {
      window.parent.postMessage(
        {
          type: "__VESA_RUNTIME_ERROR__",
          error: {
            message: message,
            filename: filename,
            lineno: lineno,
            colno: colno,
            stack: stack
          }
        },
        "*"
      );
    } catch (e) {}
  }
  window.addEventListener('error', function (event) {
    var err = event.error || {};
    report(
      event.message || "Script error",
      event.filename || "",
      event.lineno || 0,
      event.colno || 0,
      err.stack || ""
    );
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason || {};
    report(
      reason.message || String(reason),
      "",
      0,
      0,
      reason.stack || ""
    );
  });
})();
</script>`;

const ROUTE_SCRIPT = `<script data-vesa-route-reporter>
(function () {
  var lastPath = null;
  function notify() {
    var path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    try {
      window.parent.postMessage({ type: "__VESA_ROUTE_CHANGE__", path: path }, "*");
    } catch (e) {}
  }
  var origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    notify();
  };
  var origReplace = history.replaceState;
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    notify();
  };
  window.addEventListener('popstate', notify);
  notify();
})();
</script>`;

export default function vesaErrorReporter() {
  return {
    name: "vesa-error-reporter",
    transformIndexHtml(html) {
      if (!html.includes("</head>")) return html;
      return html.replace("</head>", `${ERROR_SCRIPT}${ROUTE_SCRIPT}</head>`);
    },
  };
}
