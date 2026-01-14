"use client";

type AnimeModule = typeof import("animejs");

let animePromise: Promise<AnimeModule> | null = null;

export function loadAnime(): Promise<AnimeModule> {
  if (!animePromise) {
    animePromise = import("animejs");
  }
  return animePromise;
}
