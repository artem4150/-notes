"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Menu,
  Plus,
  Search,
  Star,
  Trash2,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MarkdownPreview } from "@/components/notes/markdown-preview";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  createNote,
  deleteNote,
  favoriteNote,
  listNotes,
  logout,
  sessionStatus,
  updateNote,
} from "@/lib/api";
import { Note, NotePayload } from "@/lib/types";
import { cn } from "@/lib/utils";

type DraftState = {
  title: string;
  content: string;
  tagsInput: string;
  isFavorite: boolean;
};

function parseTags(input: string): string[] {
  const unique = new Set<string>();
  input
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .forEach((tag) => {
      if (!tag) return;
      unique.add(tag.slice(0, 32));
    });

  return Array.from(unique);
}

function tagsToInput(tags: string[]): string {
  return tags.join(", ");
}

function noteExcerpt(content: string): string {
  const text = content
    .replace(/[#>*`_~\-|\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Empty note";
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

function toPayload(draft: DraftState): NotePayload {
  return {
    title: draft.title.trim() || "Untitled",
    content: draft.content,
    tags: parseTags(draft.tagsInput),
    is_favorite: draft.isFavorite,
  };
}

function isDraftEqual(a: DraftState | null, b: DraftState | null): boolean {
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.tagsInput === b.tagsInput &&
    a.isFavorite === b.isFavorite
  );
}

export function NotesWorkspace() {
  const router = useRouter();

  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopView, setDesktopView] = useState<"split" | "editor" | "preview">("split");
  const [mobileView, setMobileView] = useState<"editor" | "preview">("editor");

  const [tick, setTick] = useState(Date.now());

  const selectedIdRef = useRef<string | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  const previousSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const handleUnauthorized = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const response = await listNotes({
        query: searchQuery || undefined,
        tag: tagFilter || undefined,
        favorite: favoriteOnly ? true : undefined,
        page: 1,
        limit: 100,
      });

      setNotes(response.items);

      if (response.items.length === 0) {
        setSelectedId(null);
        return;
      }

      const currentSelectedId = selectedIdRef.current;
      const stillExists = response.items.some((note) => note.id === currentSelectedId);
      if (currentSelectedId && stillExists) {
        setSelectedId(currentSelectedId);
      } else {
        setSelectedId(response.items[0].id);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to load notes");
    } finally {
      setLoadingNotes(false);
    }
  }, [favoriteOnly, handleUnauthorized, searchQuery, tagFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 260);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const boot = async () => {
      try {
        const session = await sessionStatus();
        if (!session.authenticated) {
          handleUnauthorized();
          return;
        }
      } catch {
        handleUnauthorized();
        return;
      }

      setInitialized(true);
    };

    void boot();
  }, [handleUnauthorized]);

  useEffect(() => {
    if (!initialized) {
      return;
    }
    void loadNotes();
  }, [initialized, loadNotes]);

  useEffect(() => {
    if (selectedId === previousSelectionRef.current) {
      return;
    }

    previousSelectionRef.current = selectedId;

    if (!selectedId) {
      setDraft(null);
      setDirty(false);
      setIsSaving(false);
      setLastSavedAt(null);
      return;
    }

    const note = notes.find((item) => item.id === selectedId);
    if (!note) {
      setDraft(null);
      return;
    }

    setDraft({
      title: note.title,
      content: note.content,
      tagsInput: tagsToInput(note.tags),
      isFavorite: note.is_favorite,
    });
    setDirty(false);
    setIsSaving(false);
    setLastSavedAt(new Date(note.updated_at));
  }, [selectedId, notes]);

  useEffect(() => {
    if (!selectedId || !draft || !dirty) {
      return;
    }

    const snapshot: DraftState = { ...draft };

    const timeout = setTimeout(async () => {
      setIsSaving(true);
      try {
        const updated = await updateNote(selectedId, toPayload(snapshot));
        setNotes((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setLastSavedAt(new Date(updated.updated_at));
        if (isDraftEqual(snapshot, draftRef.current)) {
          setDirty(false);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleUnauthorized();
          return;
        }
        toast.error(error instanceof Error ? error.message : "Failed to save");
      } finally {
        setIsSaving(false);
      }
    }, 720);

    return () => clearTimeout(timeout);
  }, [dirty, draft, handleUnauthorized, selectedId]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !isSaving) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, isSaving]);

  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const activeTags = useMemo(() => {
    const tags = new Set<string>();
    notes.forEach((note) => note.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort();
  }, [notes]);

  const selectedNote = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    return notes.find((note) => note.id === selectedId) ?? null;
  }, [notes, selectedId]);

  const saveStatusText = useMemo(() => {
    if (isSaving) {
      return "Saving...";
    }
    if (dirty) {
      return "Unsaved changes";
    }
    if (!lastSavedAt) {
      return "Not saved yet";
    }
    void tick;
    return `Saved ${formatDistanceToNowStrict(lastSavedAt, {
      addSuffix: true,
      locale: ru,
    })}`;
  }, [dirty, isSaving, lastSavedAt, tick]);

  const handleCreateNote = useCallback(async () => {
    try {
      const created = await createNote({
        title: "Untitled",
        content: "",
        tags: [],
        is_favorite: false,
      });

      setNotes((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setSelectedId(created.id);
      setMobileSidebarOpen(false);
      toast.success("New note created");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to create note");
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void handleCreateNote();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCreateNote]);

  async function handleDeleteCurrentNote() {
    if (!selectedId) {
      return;
    }
    const confirmed = window.confirm("Delete this note?");
    if (!confirmed) {
      return;
    }

    try {
      await deleteNote(selectedId);
      const newNotes = notes.filter((item) => item.id !== selectedId);
      setNotes(newNotes);
      setSelectedId(newNotes[0]?.id ?? null);
      toast.success("Note deleted");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to delete note");
    }
  }

  async function handleToggleFavorite(note: Note, explicit?: boolean) {
    const value = explicit ?? !note.is_favorite;
    try {
      const updated = await favoriteNote(note.id, value);
      setNotes((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      if (note.id === selectedId) {
        setDraft((prev) => (prev ? { ...prev, isFavorite: updated.is_favorite } : prev));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to change favorite");
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  function handleSelectNote(noteId: string) {
    if (dirty && noteId !== selectedId) {
      const confirmed = window.confirm("You have unsaved changes. Continue without waiting for autosave?");
      if (!confirmed) {
        return;
      }
    }
    setSelectedId(noteId);
    setMobileSidebarOpen(false);
  }

  async function handleCopyRaw() {
    if (!draft) {
      return;
    }

    try {
      await navigator.clipboard.writeText(draft.content);
      toast.success("Raw markdown copied");
    } catch {
      toast.error("Cannot access clipboard");
    }
  }

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col border-r border-border/70 bg-background/80">
      <div className="space-y-3 border-b border-border/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search notes"
              className="pl-9"
            />
          </div>
          <Button type="button" size="icon" variant="outline" onClick={handleCreateNote}>
            <Plus className="size-4" />
            <span className="sr-only">New note</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={favoriteOnly ? "default" : "outline"}
            onClick={() => setFavoriteOnly((prev) => !prev)}
          >
            Favorites
          </Button>
          {tagFilter && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setTagFilter("")}>
              Clear tag
            </Button>
          )}
        </div>

        <div className="flex max-h-16 flex-wrap gap-2 overflow-y-auto pr-1">
          {activeTags.length === 0 ? (
            <span className="text-xs text-muted-foreground">No tags yet</span>
          ) : (
            activeTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter((current) => (current === tag ? "" : tag))}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent",
                  tagFilter === tag && "border-primary bg-primary/10 text-primary"
                )}
              >
                #{tag}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loadingNotes ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <p className="text-sm text-muted-foreground">No notes found</p>
            <Button type="button" variant="ghost" className="mt-2" onClick={handleCreateNote}>
              Create first note
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => handleSelectNote(note.id)}
                className={cn(
                  "group w-full rounded-xl border px-3 py-2 text-left transition-colors hover:bg-accent/60",
                  note.id === selectedId
                    ? "border-primary/40 bg-primary/8"
                    : "border-transparent bg-transparent"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-semibold">{note.title || "Untitled"}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleToggleFavorite(note);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <Star className={cn("size-3.5", note.is_favorite && "fill-current text-amber-500")} />
                    <span className="sr-only">Favorite</span>
                  </button>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{noteExcerpt(note.content)}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(note.updated_at), {
                      addSuffix: true,
                      locale: ru,
                    })}
                  </span>
                  <div className="flex items-center gap-1">
                    {note.tags.slice(0, 2).map((tag) => (
                      <Badge key={`${note.id}-${tag}`} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        <Button type="button" variant="outline" className="w-full" onClick={handleLogout}>
          Logout
        </Button>
      </div>
    </div>
  );

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-background via-background to-muted/30 text-foreground">
      <div className="grid h-full md:grid-cols-[320px_1fr]">
        <aside className="hidden min-h-0 md:block">{sidebar}</aside>

        <main className="flex min-h-0 flex-col">
          <header className="flex items-center justify-between border-b border-border/60 px-3 py-2 md:hidden">
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetTrigger asChild>
                <Button type="button" size="icon" variant="outline">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full max-w-sm p-0">
                <SheetHeader className="border-b border-border/60">
                  <SheetTitle>Notes</SheetTitle>
                </SheetHeader>
                {sidebar}
              </SheetContent>
            </Sheet>

            <div className="text-sm font-semibold">Markdown Notes</div>
            <ThemeToggle />
          </header>

          {!draft || !selectedNote ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div className="max-w-sm rounded-2xl border border-border bg-background/90 p-8 text-center shadow-sm">
                <h2 className="text-lg font-semibold tracking-tight">No note selected</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create your first markdown paste and start syncing snippets.
                </p>
                <Button type="button" className="mt-4" onClick={handleCreateNote}>
                  <Plus className="size-4" />
                  New note
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 border-b border-border/60 px-4 py-3 md:px-5">
                <div className="flex items-center gap-2">
                  <Input
                    value={draft.title}
                    onChange={(event) => {
                      const title = event.target.value;
                      setDraft((prev) => (prev ? { ...prev, title } : prev));
                      setDirty(true);
                    }}
                    placeholder="Untitled"
                    className="h-10 border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                  />

                  <div className="ml-auto hidden items-center gap-1 md:flex">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleToggleFavorite(selectedNote, !draft.isFavorite)}
                    >
                      <Star className={cn("size-4", draft.isFavorite && "fill-current text-amber-500")} />
                      <span className="sr-only">Favorite</span>
                    </Button>

                    <Button type="button" size="icon" variant="ghost" onClick={handleCopyRaw}>
                      <Copy className="size-4" />
                      <span className="sr-only">Copy markdown</span>
                    </Button>

                    <Button type="button" size="icon" variant="ghost" onClick={handleDeleteCurrentNote}>
                      <Trash2 className="size-4" />
                      <span className="sr-only">Delete note</span>
                    </Button>

                    <ThemeToggle />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={draft.tagsInput}
                    onChange={(event) => {
                      const tagsInput = event.target.value;
                      setDraft((prev) => (prev ? { ...prev, tagsInput } : prev));
                      setDirty(true);
                    }}
                    placeholder="tags: backend, snippet, sql"
                    className="h-8 max-w-md text-xs"
                  />

                  <span className="text-xs text-muted-foreground">{saveStatusText}</span>

                  <div className="ml-auto flex items-center gap-1 md:hidden">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleToggleFavorite(selectedNote, !draft.isFavorite)}
                    >
                      <Star className={cn("size-4", draft.isFavorite && "fill-current text-amber-500")} />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" onClick={handleCopyRaw}>
                      <Copy className="size-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" onClick={handleDeleteCurrentNote}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="hidden items-center gap-1 md:flex">
                  <Button
                    type="button"
                    variant={desktopView === "split" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setDesktopView("split")}
                  >
                    {desktopView === "split" ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />} Split
                  </Button>
                  <Button
                    type="button"
                    variant={desktopView === "editor" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setDesktopView("editor")}
                  >
                    Editor
                  </Button>
                  <Button
                    type="button"
                    variant={desktopView === "preview" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setDesktopView("preview")}
                  >
                    Preview
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 p-3 md:p-4">
                <div className="hidden h-full min-h-0 md:block">
                  {desktopView === "split" && (
                    <div className="grid h-full min-h-0 grid-cols-2 gap-4">
                      <section className="flex min-h-0 flex-col rounded-xl border border-border bg-background/80 p-3">
                        <Textarea
                          value={draft.content}
                          onChange={(event) => {
                            const content = event.target.value;
                            setDraft((prev) => (prev ? { ...prev, content } : prev));
                            setDirty(true);
                          }}
                          className="h-full min-h-0 resize-none border-none bg-transparent p-1 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0"
                          placeholder="Write markdown here..."
                        />
                      </section>

                      <section className="min-h-0 overflow-y-auto rounded-xl border border-border bg-background/80 p-4">
                        <MarkdownPreview markdown={draft.content} />
                      </section>
                    </div>
                  )}

                  {desktopView === "editor" && (
                    <section className="h-full rounded-xl border border-border bg-background/80 p-3">
                      <Textarea
                        value={draft.content}
                        onChange={(event) => {
                          const content = event.target.value;
                          setDraft((prev) => (prev ? { ...prev, content } : prev));
                          setDirty(true);
                        }}
                        className="h-full min-h-0 resize-none border-none bg-transparent p-1 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0"
                        placeholder="Write markdown here..."
                      />
                    </section>
                  )}

                  {desktopView === "preview" && (
                    <section className="h-full min-h-0 overflow-y-auto rounded-xl border border-border bg-background/80 p-4">
                      <MarkdownPreview markdown={draft.content} />
                    </section>
                  )}
                </div>

                <div className="flex h-full min-h-0 flex-col md:hidden">
                  <Tabs
                    value={mobileView}
                    onValueChange={(value) => setMobileView(value as "editor" | "preview")}
                    className="h-full"
                  >
                    <TabsList className="mb-3 w-full">
                      <TabsTrigger value="editor" className="w-full">
                        Editor
                      </TabsTrigger>
                      <TabsTrigger value="preview" className="w-full">
                        Preview
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="editor" className="h-full">
                      <section className="h-full rounded-xl border border-border bg-background/80 p-3">
                        <Textarea
                          value={draft.content}
                          onChange={(event) => {
                            const content = event.target.value;
                            setDraft((prev) => (prev ? { ...prev, content } : prev));
                            setDirty(true);
                          }}
                          className="h-full min-h-0 resize-none border-none bg-transparent p-1 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0"
                          placeholder="Write markdown here..."
                        />
                      </section>
                    </TabsContent>

                    <TabsContent value="preview" className="h-full min-h-0 overflow-y-auto rounded-xl border border-border bg-background/80 p-4">
                      <MarkdownPreview markdown={draft.content} />
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
