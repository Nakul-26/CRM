import { NextResponse } from "next/server";
import type { AuthResponse } from "@sales-platform/contracts";
import { API_INTERNAL_URL } from "@/lib/server-config";
import { setAuthCookies } from "@/lib/auth-cookies";

export async function POST(request: Request) {
  const body = await request.json();

  const apiRes = await fetch(`${API_INTERNAL_URL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await apiRes.json();
  if (!apiRes.ok) {
    return NextResponse.json(data, { status: apiRes.status });
  }

  const { tokens, user } = data as AuthResponse;
  const response = NextResponse.json({ user });
  setAuthCookies(response, tokens);
  return response;
}
