import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_INTERNAL_URL, REFRESH_COOKIE } from "@/lib/server-config";
import { clearAuthCookies } from "@/lib/auth-cookies";

export async function POST() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    await fetch(`${API_INTERNAL_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {
      // Best-effort server-side revocation — cookies are cleared regardless.
    });
  }

  const response = NextResponse.json({ success: true });
  clearAuthCookies(response);
  return response;
}
