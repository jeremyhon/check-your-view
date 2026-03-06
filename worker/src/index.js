const ALLOWED_PREFIXES = [
  "/omapi/tilesets/sg_noterrain_tiles/",
  "/maps/tiles/OrthoJPG/",
  "/maps/tiles/DefaultRoad/",
  "/api/common/elastic/search",
];

const ALLOWED_METHODS = "GET,HEAD,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization,Range,If-Modified-Since,If-None-Match";
const TRANSPARENT_PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const TRANSPARENT_PIXEL_BYTES = base64ToUint8Array(TRANSPARENT_PIXEL_BASE64);

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

function createTransparentTileResponse(requestMethod, corsHeaders) {
  const headers = new Headers({
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=300",
  });
  if (corsHeaders) {
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  }
  if (requestMethod === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(TRANSPARENT_PIXEL_BYTES, { status: 200, headers });
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

function isSearchPath(pathname) {
  return pathname.startsWith("/api/common/elastic/search");
}

function isImageryPath(pathname) {
  return pathname.startsWith("/maps/tiles/");
}

function buildUpstreamUrl(env, url) {
  return `${env.ONEMAP_BASE_URL}${url.pathname}${url.search}`;
}

function buildUpstreamHeaders(request, pathname, env) {
  const headers = new Headers();
  const forwardableHeaders = ["accept", "range", "if-modified-since", "if-none-match"];
  forwardableHeaders.forEach((name) => {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  });

  headers.set("Referer", env.ONEMAP_REFERER);
  if (isSearchPath(pathname) && env.ONEMAP_API_TOKEN) {
    headers.set("Authorization", env.ONEMAP_API_TOKEN);
  }
  return headers;
}

async function fetchUpstream(request, upstreamUrl, upstreamHeaders) {
  return fetch(upstreamUrl, {
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
}

async function handleImageryRoute(request, env, url, corsHeaders) {
  const upstreamUrl = buildUpstreamUrl(env, url);
  const upstreamHeaders = buildUpstreamHeaders(request, url.pathname, env);
  let upstreamResponse;
  try {
    upstreamResponse = await fetchUpstream(request, upstreamUrl, upstreamHeaders);
  } catch {
    return createTransparentTileResponse(request.method, corsHeaders);
  }

  const responseHeaders = copyResponseHeaders(upstreamResponse.headers, corsHeaders, url.pathname);
  if (!upstreamResponse.ok) {
    return createTransparentTileResponse(request.method, corsHeaders);
  }
  if (request.method === "GET") {
    if (!upstreamResponse.body) {
      return createTransparentTileResponse(request.method, corsHeaders);
    }
    // Probe for truly empty chunked bodies without buffering whole tiles.
    const [probeStream, passthroughStream] = upstreamResponse.body.tee();
    const reader = probeStream.getReader();
    const firstChunk = await reader.read();
    try {
      await reader.cancel();
    } catch {
      // ignore reader cancel failures
    }
    if (firstChunk.done) {
      return createTransparentTileResponse(request.method, corsHeaders);
    }
    return new Response(passthroughStream, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function handleProxyRoute(request, env, url, corsHeaders) {
  const upstreamUrl = buildUpstreamUrl(env, url);
  const upstreamHeaders = buildUpstreamHeaders(request, url.pathname, env);
  let upstreamResponse;
  try {
    upstreamResponse = await fetchUpstream(request, upstreamUrl, upstreamHeaders);
  } catch (error) {
    return createJsonResponse(
      502,
      { error: "Upstream fetch failed", detail: String(error) },
      corsHeaders,
    );
  }

  const responseHeaders = copyResponseHeaders(upstreamResponse.headers, corsHeaders, url.pathname);
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
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

    if (isImageryPath(url.pathname)) {
      return handleImageryRoute(request, env, url, corsHeaders);
    }

    return handleProxyRoute(request, env, url, corsHeaders);
  },
};
