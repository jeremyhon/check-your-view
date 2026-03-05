window.CHECK_YOUR_VIEW_CONFIG = Object.assign(
  {
    proxyBase:
      window.location.hostname === "localhost"
        ? "http://localhost:8787"
        : "https://check-your-view-proxy.jeremy-hon-gy.workers.dev",
  },
  window.CHECK_YOUR_VIEW_CONFIG || {},
);
