"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const nextTheme =
    theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  const icon =
    theme === "light" ? (
      <Sun className="size-4" />
    ) : theme === "dark" ? (
      <Moon className="size-4" />
    ) : (
      <Monitor className="size-4" />
    );

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(nextTheme)}
      title="Theme: light / dark / system"
      className="text-muted-foreground hover:text-foreground"
    >
      {icon}
      <span className="sr-only">Switch theme</span>
    </Button>
  );
}