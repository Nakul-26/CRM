import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL, NOTIFICATIONS_SERVICE_URL, ACCESS_COOKIE } from "@/lib/server-config";

/**
 * Thin BFF proxy (Section 16 of the brief): the browser only ever talks to
 * same-origin `/api/gateway/*`. Tokens live in httpOnly cookies and are
 * attached here as a Bearer header — they never reach client JS. This also
 * means the eventual API Gateway service (Phase 8+) is a drop-in swap for
 * `API_INTERNAL_URL` with no client code changes — exactly what Phase 18's
 * `notifications` path branch below is: the same swap, scoped to one path
 * prefix instead of the whole API, once that module is extracted into
 * apps/notifications-service. See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 */
async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  const search = request.nextUrl.search;
  const upstream = path[0] === "notifications" && NOTIFICATIONS_SERVICE_URL ? NOTIFICATIONS_SERVICE_URL : API_INTERNAL_URL;
  const targetUrl = `${upstream}/api/v1/${path.join("/")}${search}`;

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const body = hasBody ? await request.text() : undefined;

  const apiRes = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body,
    cache: "no-store",
  });

  const contentType = apiRes.headers.get("content-type") ?? "application/json";

  // SSE responses stay open indefinitely — pipe the stream through live instead of
  // buffering it below, which would just hang forever waiting for it to end.
  if (contentType.startsWith("text/event-stream")) {
    return new NextResponse(apiRes.body, {
      status: apiRes.status,
      headers: { "content-type": contentType, "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  const headers: Record<string, string> = { "content-type": contentType };
  const contentDisposition = apiRes.headers.get("content-disposition");
  if (contentDisposition) headers["content-disposition"] = contentDisposition;

  // Binary responses (e.g. PDF downloads) must not round-trip through .text() —
  // that re-encodes bytes as UTF-8 and corrupts them. Only JSON/text bodies do.
  const isText = contentType.startsWith("application/json") || contentType.startsWith("text/");
  const responseBody = isText ? await apiRes.text() : await apiRes.arrayBuffer();

  return new NextResponse(responseBody, { status: apiRes.status, headers });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}
export async function POST(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}
export async function PUT(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}
