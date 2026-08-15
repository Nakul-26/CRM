import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_INTERNAL_URL, ACCESS_COOKIE } from "@/lib/server-config";

export async function GET() {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const apiRes = await fetch(`${API_INTERNAL_URL}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const data = await apiRes.json();
  return NextResponse.json(data, { status: apiRes.status });
}
