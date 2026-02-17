export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotesListResponse {
  items: Note[];
  page: number;
  limit: number;
  total: number;
}

export interface SessionStatus {
  authenticated: boolean;
}

export interface NotePayload {
  title: string;
  content: string;
  tags: string[];
  is_favorite: boolean;
}