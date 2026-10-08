import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import vesaErrorReporter from "../../.vesa/vite-error-plugin.js";

describe("vite-error-plugin: transformIndexHtml", () => {
  const plugin = vesaErrorReporter();

  it("should have the correct plugin name", () => {
    expect(plugin.name).toBe("vesa-error-reporter");
  });

  it("should inject both error and route scripts before </head>", () => {
    const html = `<!doctype html><html><head><meta charset="UTF-8" /></head><body></body></html>`;
    const result = plugin.transformIndexHtml(html);
    expect(result).toContain("<script data-vesa-error-reporter>");
    expect(result).toContain("<script data-vesa-route-reporter>");
    expect(result).toContain("</script></head>");
  });

  it("should inject __VESA_RUNTIME_ERROR__ postMessage handler", () => {
    const html = "<html><head></head><body></body></html>";
    const result = plugin.transformIndexHtml(html);
    expect(result).toContain("__VESA_RUNTIME_ERROR__");
    expect(result).toContain("window.parent.postMessage");
  });

  it("should inject __VESA_ROUTE_CHANGE__ postMessage handler", () => {
    const html = "<html><head></head><body></body></html>";
    const result = plugin.transformIndexHtml(html);
    expect(result).toContain("__VESA_ROUTE_CHANGE__");
    expect(result).toContain("history.pushState");
    expect(result).toContain("history.replaceState");
    expect(result).toContain("popstate");
  });

  it("should listen for both error and unhandledrejection events", () => {
    const html = "<html><head></head><body></body></html>";
    const result = plugin.transformIndexHtml(html);
    expect(result).toContain("addEventListener('error'");
    expect(result).toContain("addEventListener('unhandledrejection'");
  });

  it("should preserve the rest of the HTML unchanged", () => {
    const html =
      '<!doctype html><html><head><title>Test</title></head><body><div id="root"></div></body></html>';
    const result = plugin.transformIndexHtml(html);
    expect(result).toContain("<title>Test</title>");
    expect(result).toContain('<div id="root"></div>');
    expect(result).toContain("<!doctype html>");
  });

  it("should work with the actual template index.html", () => {
    const templateHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vesa App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
    const result = plugin.transformIndexHtml(templateHtml);
    expect(result).toContain("<script data-vesa-error-reporter>");
    expect(result).toContain("<script data-vesa-route-reporter>");
    expect(result).toContain("</script></head>");
    expect(result).toContain('<script type="module" src="/src/main.tsx">');
  });

  it("should not break when </head> is missing", () => {
    const html = "<html><body></body></html>";
    const result = plugin.transformIndexHtml(html);
    expect(result).toBe(html);
  });
});

describe("vite-error-plugin: error script runtime behavior", () => {
  let originalParent: typeof window.parent;
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let listeners: Record<string, ((event: any) => void)[]>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    originalParent = window.parent;

    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      writable: true,
      configurable: true,
    });

    listeners = {};
    vi.spyOn(window, "addEventListener").mockImplementation((type: string, handler: any) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    });

    const plugin = vesaErrorReporter();
    const html = "<html><head></head><body></body></html>";
    const injectedHtml = plugin.transformIndexHtml(html);

    const scriptMatch = injectedHtml.match(/<script data-vesa-error-reporter>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();

    const scriptContent = scriptMatch![1];
    eval(scriptContent);
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", {
      value: originalParent,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("should send postMessage on window error event", () => {
    const errorHandler = listeners["error"]?.[0];
    expect(errorHandler).toBeDefined();

    errorHandler({
      message: "Test error",
      filename: "app.js",
      lineno: 42,
      colno: 10,
      error: { stack: "Error: Test error\n    at app.js:42:10" },
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "__VESA_RUNTIME_ERROR__",
        error: {
          message: "Test error",
          filename: "app.js",
          lineno: 42,
          colno: 10,
          stack: "Error: Test error\n    at app.js:42:10",
        },
      },
      "*"
    );
  });

  it("should send postMessage on unhandledrejection event", () => {
    const rejectionHandler = listeners["unhandledrejection"]?.[0];
    expect(rejectionHandler).toBeDefined();

    rejectionHandler({
      reason: {
        message: "Promise rejected",
        stack: "Error: Promise rejected\n    at async.js:1:1",
      },
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "__VESA_RUNTIME_ERROR__",
        error: {
          message: "Promise rejected",
          filename: "",
          lineno: 0,
          colno: 0,
          stack: "Error: Promise rejected\n    at async.js:1:1",
        },
      },
      "*"
    );
  });

  it("should handle unhandledrejection with non-Error reason", () => {
    const rejectionHandler = listeners["unhandledrejection"]?.[0];

    rejectionHandler({ reason: "simple string error" });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "__VESA_RUNTIME_ERROR__",
        error: {
          message: "simple string error",
          filename: "",
          lineno: 0,
          colno: 0,
          stack: "",
        },
      },
      "*"
    );
  });

  it("should handle unhandledrejection with null/undefined reason", () => {
    const rejectionHandler = listeners["unhandledrejection"]?.[0];

    rejectionHandler({ reason: undefined });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "__VESA_RUNTIME_ERROR__",
        error: {
          message: "[object Object]",
          filename: "",
          lineno: 0,
          colno: 0,
          stack: "",
        },
      },
      "*"
    );
  });

  it("should deduplicate identical errors", () => {
    const errorHandler = listeners["error"]?.[0];

    const event = {
      message: "Duplicate error",
      filename: "dup.js",
      lineno: 1,
      colno: 1,
      error: { stack: "" },
    };

    errorHandler(event);
    errorHandler(event);
    errorHandler(event);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("should report different errors separately", () => {
    const errorHandler = listeners["error"]?.[0];

    errorHandler({
      message: "Error A",
      filename: "a.js",
      lineno: 1,
      colno: 1,
      error: { stack: "" },
    });

    errorHandler({
      message: "Error B",
      filename: "b.js",
      lineno: 2,
      colno: 2,
      error: { stack: "" },
    });

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
  });

  it("should handle error event where error object is null", () => {
    const errorHandler = listeners["error"]?.[0];

    errorHandler({
      message: "Script error",
      filename: "",
      lineno: 0,
      colno: 0,
      error: null,
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "__VESA_RUNTIME_ERROR__",
        error: {
          message: "Script error",
          filename: "",
          lineno: 0,
          colno: 0,
          stack: "",
        },
      },
      "*"
    );
  });

  it("should not throw when parent.postMessage fails", () => {
    postMessageSpy.mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const errorHandler = listeners["error"]?.[0];

    expect(() => {
      errorHandler({
        message: "Test",
        filename: "x.js",
        lineno: 1,
        colno: 1,
        error: null,
      });
    }).not.toThrow();
  });
});

describe("vite-error-plugin: route script runtime behavior", () => {
  let originalParent: typeof window.parent;
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let listeners: Record<string, ((event: any) => void)[]>;
  let origPushState: typeof history.pushState;
  let origReplaceState: typeof history.replaceState;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    originalParent = window.parent;
    origPushState = history.pushState;
    origReplaceState = history.replaceState;

    // Simulate being inside an iframe (window !== window.parent)
    const fakeParent = { postMessage: postMessageSpy };
    Object.defineProperty(window, "parent", {
      value: fakeParent,
      writable: true,
      configurable: true,
    });

    listeners = {};
    vi.spyOn(window, "addEventListener").mockImplementation((type: string, handler: any) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    });

    const plugin = vesaErrorReporter();
    const html = "<html><head></head><body></body></html>";
    const injectedHtml = plugin.transformIndexHtml(html);

    const scriptMatch = injectedHtml.match(
      /<script data-vesa-route-reporter>([\s\S]*?)<\/script>/
    );
    expect(scriptMatch).not.toBeNull();

    const scriptContent = scriptMatch![1];
    eval(scriptContent);
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", {
      value: originalParent,
      writable: true,
      configurable: true,
    });
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
    vi.restoreAllMocks();
  });

  it("should send initial route on script load", () => {
    const routeCalls = postMessageSpy.mock.calls.filter(
      (c: any[]) => c[0]?.type === "__VESA_ROUTE_CHANGE__"
    );
    expect(routeCalls.length).toBe(1);
    expect(routeCalls[0][0].path).toBe(location.pathname);
  });

  it("should send route change on pushState", () => {
    postMessageSpy.mockClear();
    history.pushState({}, "", "/about");
    const routeCalls = postMessageSpy.mock.calls.filter(
      (c: any[]) => c[0]?.type === "__VESA_ROUTE_CHANGE__"
    );
    expect(routeCalls.length).toBe(1);
    expect(routeCalls[0][0].path).toBe("/about");
  });

  it("should send route change on replaceState", () => {
    postMessageSpy.mockClear();
    history.replaceState({}, "", "/settings");
    const routeCalls = postMessageSpy.mock.calls.filter(
      (c: any[]) => c[0]?.type === "__VESA_ROUTE_CHANGE__"
    );
    expect(routeCalls.length).toBe(1);
    expect(routeCalls[0][0].path).toBe("/settings");
  });

  it("should register popstate listener", () => {
    const popHandler = listeners["popstate"]?.[0];
    expect(popHandler).toBeDefined();
    expect(typeof popHandler).toBe("function");
  });

  it("should report path change when popstate fires after URL change", () => {
    // Simulate: navigate to /foo via pushState (lastPath becomes /foo)
    history.pushState({}, "", "/foo");
    postMessageSpy.mockClear();

    // In a real browser, back/forward changes URL before popstate fires.
    // We simulate by using the original pushState (now monkey-patched) to go to /bar,
    // then clear and manually fire popstate (which re-reads location.pathname).
    // Since pushState already set lastPath to /bar, popstate won't re-send.
    // Instead, directly use origPushState to change URL without triggering notify:
    origPushState.call(history, {}, "", "/bar");
    const popHandler = listeners["popstate"]![0];
    popHandler({});

    const routeCalls = postMessageSpy.mock.calls.filter(
      (c: any[]) => c[0]?.type === "__VESA_ROUTE_CHANGE__"
    );
    expect(routeCalls.length).toBe(1);
    expect(routeCalls[0][0].path).toBe("/bar");
  });

  it("should not send duplicate when path unchanged", () => {
    postMessageSpy.mockClear();
    history.pushState({}, "", location.pathname);
    const routeCalls = postMessageSpy.mock.calls.filter(
      (c: any[]) => c[0]?.type === "__VESA_ROUTE_CHANGE__"
    );
    expect(routeCalls.length).toBe(0);
  });

  it("should not throw when parent.postMessage fails", () => {
    postMessageSpy.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => {
      history.pushState({}, "", "/safe");
    }).not.toThrow();
  });
});
