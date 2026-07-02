/** Nomad Network wire types (Reticulum-only). */

export interface NomadNodeRow {
  destination_hash: string;
  display_name?: string | null;
  last_seen?: number | null;
  favorited?: boolean;
  hops?: number | null;
  status?: string | null;
}

export interface NomadPageResponse {
  ok: boolean;
  content?: string;
  content_type?: string;
  error?: string;
}

export interface NomadFileResponse {
  ok: boolean;
  file_name?: string;
  content_base64?: string;
  error?: string;
}
