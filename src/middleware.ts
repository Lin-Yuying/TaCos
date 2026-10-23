import { NextResponse, type NextRequest } from "next/server";

// Mirrors DEVICE_COOKIE in src/lib/auth.ts. Minted here because a render cannot
// set cookies, and the account-switcher needs every browser to carry an id.
const DEVICE_COOKIE = "tacos_device";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.has(DEVICE_COOKIE)) {
    response.cookies.set(DEVICE_COOKIE, crypto.randomUUID().replaceAll("-", ""), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 730,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
