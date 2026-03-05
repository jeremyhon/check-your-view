const ALLOWED_PREFIXES = [
  "/omapi/tilesets/sg_noterrain_tiles/",
  "/maps/tiles/OrthoJPG/",
  "/maps/tiles/DefaultRoad/",
];

const ALLOWED_METHODS = "GET,HEAD,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization,Range,If-Modified-Since,If-None-Match";

function isAllowedPath(pathname) {
  if (pathname.includes("..")) {
    return false;
  }
  return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function resolveOrigin(request, env) {
  const requestOrigin = request.headers.get("Origin");
  const configured = (env.ALLOWED_ORIGINS || "*").trim();
  if (configured === "*") {
    return requestOrigin || "*";
  }
  if (!requestOrigin) {
    return null;
  }
  const allowlist = configured
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return allowlist.includes(requestOrigin) ? requestOrigin : null;
}

function buildCorsHeaders(request, env) {
  const origin = resolveOrigin(request, env);
  if (!origin) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function createJsonResponse(status, payload, corsHeaders) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  if (corsHeaders) {
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function normalizeContentType(pathname, upstreamContentType) {
  if (pathname.startsWith("/maps/tiles/OrthoJPG/")) {
    return "image/jpeg";
  }
  if (pathname.startsWith("/maps/tiles/DefaultRoad/")) {
    return "image/png";
  }
  return upstreamContentType;
}

function copyResponseHeaders(upstreamHeaders, corsHeaders, pathname) {
  const passthrough = [
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
    "expires",
    "content-encoding",
    "content-length",
    "content-range",
    "accept-ranges",
  ];
  const headers = new Headers();
  passthrough.forEach((name) => {
    const value = upstreamHeaders.get(name);
    if (value) {
      headers.set(name, value);
    }
  });
  const normalizedType = normalizeContentType(pathname, headers.get("content-type"));
  if (normalizedType) {
    headers.set("content-type", normalizedType);
  }
  if (corsHeaders) {
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      if (!corsHeaders) {
        return createJsonResponse(403, { error: "Origin not allowed" }, null);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!corsHeaders) {
      return createJsonResponse(403, { error: "Origin not allowed" }, null);
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return createJsonResponse(
        405,
        { error: "Method not allowed. Use GET or HEAD." },
        corsHeaders,
      );
    }

    if (!isAllowedPath(url.pathname)) {
      return createJsonResponse(404, { error: "Path not allowed." }, corsHeaders);
    }

    const upstreamUrl = `${env.ONEMAP_BASE_URL}${url.pathname}${url.search}`;
    const upstreamHeaders = new Headers();

    const forwardableHeaders = ["accept", "range", "if-modified-since", "if-none-match"];
    forwardableHeaders.forEach((name) => {
      const value = request.headers.get(name);
      if (value) {
        upstreamHeaders.set(name, value);
      }
    });

    upstreamHeaders.set("Referer", env.ONEMAP_REFERER);

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          "200-299": 3600,
          404: 60,
          "500-599": 0,
        },
      },
    });

    const responseHeaders = copyResponseHeaders(upstreamResponse.headers, corsHeaders, url.pathname);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
