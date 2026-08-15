import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { AuthResponse } from "@sales-platform/contracts";
import { API_INTERNAL_URL, REFRESH_COOKIE } from "@/lib/server-config";
import { clearAuthCookies, setAuthCookies } from "@/lib/auth-cookies";

export async function POST() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const apiRes = await fetch(`${API_INTERNAL_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  const data = await apiRes.json();
  if (!apiRes.ok) {
    const response = NextResponse.json(data, { status: apiRes.status });
    clearAuthCookies(response);
    return response;
  }

  const { tokens, user } = data as AuthResponse;
  const response = NextResponse.json({ user });
  setAuthCookies(response, tokens);
  return response;
}
