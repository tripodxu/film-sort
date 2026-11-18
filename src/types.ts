export type { Locale } from "./data/mediaKinds";

export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export interface Movie {
  /** Stable, URL-safe identifier scoped to the built-in catalogue. */
  readonly id: string;
  readonly title: LocalizedText;
  readonly year?: number;
  readonly posterUrl?: string;
  readonly tmdbId?: number;
}

export type FilmListKind = "category" | "director" | "actor" | "genre";
export type FilmListStatus = "active" | "candidate";

export interface FilmList {
  readonly id: string;
  readonly name: LocalizedText;
  readonly tagline: LocalizedText;
  readonly recommendation: LocalizedText;
  readonly kind: FilmListKind;
  readonly status: FilmListStatus;
  readonly tags: readonly LocalizedText[];
  readonly topK: number;
  readonly featuredMovieId: string;
  readonly posterUrl?: string;
  readonly movies: readonly Movie[];
}
