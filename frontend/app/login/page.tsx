"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login, sessionStatus } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await sessionStatus();
        if (session.authenticated) {
          router.replace("/notes");
        }
      } catch {
        // Ignore here, normal flow is login form.
      }
    };

    void checkSession();
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) {
      toast.error("Enter password");
      return;
    }

    setSubmitting(true);
    try {
      await login(password);
      router.replace("/notes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-background/95 p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg border border-border bg-muted p-2">
            <Lock className="size-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Markdown Notes</h1>
            <p className="text-xs text-muted-foreground">Private access by shared password</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter access password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}