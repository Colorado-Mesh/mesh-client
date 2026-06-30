/** Nomad Network wire types (Reticulum-only). */

export interface NomadNodeRow {
  destination_hash: string;
  display_name?: string | null;
  last_seen?: number | null;
  favorited?: boolean;
  status?: string | null;
}

export interface NomadPageResponse {
  ok: boolean;
  content?: string;
  content_type?: string;
  error?: string;
}
