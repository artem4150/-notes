import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const cookieName = process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME || "notes_session";
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get(cookieName)?.value);

  redirect(hasSession ? "/notes" : "/login");
}