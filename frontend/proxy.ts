import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const sessionCookieName = process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME || "notes_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(sessionCookieName)?.value);

  if (pathname.startsWith("/notes") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/login") && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/notes";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/notes/:path*", "/login"],
};
