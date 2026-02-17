import { Note, NotePayload, NotesListResponse, SessionStatus } from "@/lib/types";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // No-op: fallback error message is enough.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function login(password: string): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/logout", {
    method: "POST",
  });
}

export async function sessionStatus(): Promise<SessionStatus> {
  return apiFetch<SessionStatus>("/auth/session");
}

export async function listNotes(params?: {
  query?: string;
  tag?: string;
  favorite?: boolean;
  page?: number;
  limit?: number;
}): Promise<NotesListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.query) searchParams.set("query", params.query);
  if (params?.tag) searchParams.set("tag", params.tag);
  if (typeof params?.favorite === "boolean") {
    searchParams.set("favorite", String(params.favorite));
  }
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.limit) searchParams.set("limit", String(params.limit));

  const suffix = searchParams.toString();
  return apiFetch<NotesListResponse>(`/notes${suffix ? `?${suffix}` : ""}`);
}

export async function createNote(payload: NotePayload): Promise<Note> {
  return apiFetch<Note>("/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getNote(id: string): Promise<Note> {
  return apiFetch<Note>(`/notes/${id}`);
}

export async function updateNote(id: string, payload: NotePayload): Promise<Note> {
  return apiFetch<Note>(`/notes/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteNote(id: string): Promise<void> {
  await apiFetch<void>(`/notes/${id}`, {
    method: "DELETE",
  });
}

export async function favoriteNote(id: string, value: boolean): Promise<Note> {
  return apiFetch<Note>(`/notes/${id}/favorite`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export { ApiError };