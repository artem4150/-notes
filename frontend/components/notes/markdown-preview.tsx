"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
}

export function MarkdownPreview({ markdown, className }: MarkdownPreviewProps) {
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string>("<p class='text-muted-foreground'>Nothing to preview yet.</p>");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const theme = useMemo(() => (resolvedTheme === "dark" ? "dark" : "light"), [resolvedTheme]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/markdown/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown, theme }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to render markdown preview");
        }

        const payload = (await response.json()) as { html: string };
        setHtml(payload.html || "");
        setError(null);
      } catch (renderError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(renderError instanceof Error ? renderError.message : "Preview error");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [markdown, theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const preBlocks = Array.from(container.querySelectorAll("pre"));
    preBlocks.forEach((pre) => {
      if (pre.parentElement?.getAttribute("data-enhanced") === "true") {
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className =
        "group relative my-4 overflow-hidden rounded-xl border border-border bg-muted/30";
      wrapper.setAttribute("data-enhanced", "true");

      const toolbar = document.createElement("div");
      toolbar.className =
        "absolute inset-x-0 top-0 flex items-center justify-between border-b border-border/60 bg-background/85 px-3 py-2 text-xs text-muted-foreground backdrop-blur";

      const label = document.createElement("span");
      const codeEl = pre.querySelector("code");
      const className = codeEl?.className || "";
      const languageFromClass = className.match(/language-([a-zA-Z0-9_-]+)/)?.[1];
      const language = pre.getAttribute("data-language") || languageFromClass || "text";
      label.textContent = language;
      label.className = "uppercase tracking-wide";

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Copy";
      button.className =
        "rounded border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent";
      button.addEventListener("click", async () => {
        const code = codeEl?.textContent || "";
        try {
          await navigator.clipboard.writeText(code);
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 1200);
        } catch {
          button.textContent = "Error";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 1200);
        }
      });

      toolbar.appendChild(label);
      toolbar.appendChild(button);

      pre.classList.add("m-0", "overflow-x-auto", "px-4", "pb-4", "pt-10", "text-sm", "leading-6");

      const parent = pre.parentElement;
      if (!parent) {
        return;
      }

      parent.replaceChild(wrapper, pre);
      wrapper.appendChild(toolbar);
      wrapper.appendChild(pre);
    });
  }, [html]);

  if (error) {
    return (
      <div className={cn("rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm", className)}>
        {error}
      </div>
    );
  }

  return (
    <div className={cn("relative min-h-[220px]", className)}>
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-xl border border-border/50 bg-background/70 p-4 backdrop-blur-[1px]">
          <Skeleton className="h-full w-full" />
        </div>
      )}
      <div
        ref={containerRef}
        className="prose prose-zinc dark:prose-invert prose-headings:tracking-tight prose-pre:font-mono max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}