import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL, ACCESS_COOKIE } from "@/lib/server-config";

/**
 * Thin BFF proxy (Section 16 of the brief): the browser only ever talks to
 * same-origin `/api/gateway/*`. Tokens live in httpOnly cookies and are
 * attached here as a Bearer header — they never reach client JS. This also
 * means the eventual API Gateway service (Phase 8+) is a drop-in swap for
 * `API_INTERNAL_URL` with no client code changes.
 */
async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  const search = request.nextUrl.search;
  const targetUrl = `${API_INTERNAL_URL}/api/v1/${path.join("/")}${search}`;

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

  const responseBody = await apiRes.text();
  return new NextResponse(responseBody, {
    status: apiRes.status,
    headers: { "content-type": apiRes.headers.get("content-type") ?? "application/json" },
  });
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
