const ALLOWED_PREFIXES = [
  "/omapi/tilesets/sg_noterrain_tiles/",
  "/maps/tiles/OrthoJPG/",
  "/maps/tiles/DefaultRoad/",
  "/api/common/elastic/search",
];

const ALLOWED_METHODS = "GET,HEAD,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization,Range,If-Modified-Since,If-None-Match";
type CorsHeaders = Record<string, string>;
const TRANSPARENT_PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

type Env = {
  ONEMAP_BASE_URL: string;
  ONEMAP_REFERER: string;
  ALLOWED_ORIGINS?: string;
  ONEMAP_API_TOKEN?: string;
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const TRANSPARENT_PIXEL_BUFFER = base64ToArrayBuffer(TRANSPARENT_PIXEL_BASE64);

function isAllowedPath(pathname: string): boolean {
  if (pathname.includes("..")) {
    return false;
  }
  return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function resolveOrigin(request: Request, env: Env): string | null {
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

function buildCorsHeaders(request: Request, env: Env): CorsHeaders | null {
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

function createJsonResponse(
  status: number,
  payload: unknown,
  corsHeaders: CorsHeaders | null,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  if (corsHeaders) {
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function createTransparentTileResponse(
  requestMethod: string,
  corsHeaders: CorsHeaders | null,
): Response {
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
  return new Response(TRANSPARENT_PIXEL_BUFFER, { status: 200, headers });
}

function normalizeContentType(pathname: string, upstreamContentType: string | null): string | null {
  if (pathname.startsWith("/maps/tiles/OrthoJPG/")) {
    return "image/jpeg";
  }
  if (pathname.startsWith("/maps/tiles/DefaultRoad/")) {
    return "image/png";
  }
  return upstreamContentType;
}

function copyResponseHeaders(
  upstreamHeaders: Headers,
  corsHeaders: CorsHeaders | null,
  pathname: string,
): Headers {
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

function isSearchPath(pathname: string): boolean {
  return pathname.startsWith("/api/common/elastic/search");
}

function isImageryPath(pathname: string): boolean {
  return pathname.startsWith("/maps/tiles/");
}

function buildUpstreamUrl(env: Env, url: URL): string {
  return `${env.ONEMAP_BASE_URL}${url.pathname}${url.search}`;
}

function buildUpstreamHeaders(request: Request, pathname: string, env: Env): Headers {
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

async function fetchUpstream(
  request: Request,
  upstreamUrl: string,
  upstreamHeaders: Headers,
): Promise<Response> {
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

async function handleImageryRoute(
  request: Request,
  env: Env,
  url: URL,
  corsHeaders: CorsHeaders | null,
): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(env, url);
  const upstreamHeaders = buildUpstreamHeaders(request, url.pathname, env);
  let upstreamResponse: Response;
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

async function handleProxyRoute(
  request: Request,
  env: Env,
  url: URL,
  corsHeaders: CorsHeaders | null,
): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(env, url);
  const upstreamHeaders = buildUpstreamHeaders(request, url.pathname, env);
  let upstreamResponse: Response;
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
