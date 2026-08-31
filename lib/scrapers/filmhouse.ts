import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

// Filmhouse opened in Feb 2026 in the former Projector space at Golden Mile
// Tower, run by ex-Projector staff. It is Singapore's main independent/repertory
// cinema, and the reason jio had no film coverage at all: The Projector shut
// down in Aug 2025 and nothing replaced it as a source.
const LISTING_URLS = [
  "https://filmhouse.sg/films/",
  "https://filmhouse.sg/films/coming-soon/",
];
const VENUE = "Filmhouse, Golden Mile Tower";
const USER_AGENT = "SGEventsCuration/1.0";

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Screening headings read "Saturday 5th September" — no year. Resolve against
 * today, rolling into next year once the month has already passed, so a
 * January screening listed in December does not land 11 months in the past.
 */
export function parseScreeningDate(heading: string, today: Date): string | null {
  const match = heading
    .trim()
    .toLowerCase()
    .match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTHS[match[2]];
  if (!month || day < 1 || day > 31) return null;

  const todayMonth = today.getMonth() + 1;
  let year = today.getFullYear();
  // More than a couple of months in the past means it belongs to next year.
  if (month < todayMonth - 1) year++;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface FilmhouseFilm {
  title: string;
  url: string;
  description: string | null;
  dates: string[];
}

async function fetchListing(url: string, today: Date): Promise<FilmhouseFilm[]> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`[filmhouse] ${url} returned ${response.status}`);
  }

  const $ = cheerio.load(await response.text());
  const blocks = $(".jacro-event");
  if (blocks.length === 0) {
    throw new Error(`[filmhouse] No .jacro-event blocks found at ${url} — markup changed`);
  }

  const films: FilmhouseFilm[] = [];

  blocks.each((_, el) => {
    const block = $(el);
    const link = block.find("a.liveeventtitle").first();
    const title = link.text().trim();
    const href = link.attr("href");
    if (!title || !href) return;

    const dates = new Set<string>();
    block.find(".performance-list-items .heading").each((__, h) => {
      const parsed = parseScreeningDate($(h).text(), today);
      if (parsed) dates.add(parsed);
    });
    if (dates.size === 0) return;

    const meta = block.find(".running-time").text().replace(/\s+/g, " ").trim();
    const synopsis = block.find("p").text().replace(/\s+/g, " ").trim();
    const description = [meta, synopsis].filter(Boolean).join(" — ").slice(0, 1200) || null;

    films.push({
      title,
      // Listing links are http://; normalise so source_url dedup stays stable.
      url: href.replace(/^http:\/\//, "https://"),
      description,
      dates: [...dates].sort(),
    });
  });

  if (films.length === 0) {
    throw new Error(`[filmhouse] Found ${blocks.length} blocks at ${url} but parsed 0 films`);
  }

  return films;
}

export async function scrapeFilmhouse(): Promise<number> {
  await initializeDb();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // The two listings overlap; keep the union of screening dates per film.
  const byUrl = new Map<string, FilmhouseFilm>();
  for (const url of LISTING_URLS) {
    for (const film of await fetchListing(url, today)) {
      const existing = byUrl.get(film.url);
      if (existing) {
        existing.dates = [...new Set([...existing.dates, ...film.dates])].sort();
        if (!existing.description) existing.description = film.description;
      } else {
        byUrl.set(film.url, { ...film });
      }
    }
  }

  let newEvents = 0;

  for (const film of byUrl.values()) {
    const upcoming = film.dates.filter((d) => d >= todayIso);
    if (upcoming.length === 0) continue;

    const start = upcoming[0];
    const end = upcoming.length > 1 ? upcoming[upcoming.length - 1] : null;

    // A repertory run is a handful of scattered screenings, not a continuous
    // season, so record the real dates for the LLM and the admin panel.
    const description =
      upcoming.length > 1
        ? `${film.description ?? ""} — Screening dates: ${upcoming.join(", ")}`.trim()
        : film.description;

    const result = await upsertEvent({
      source: "filmhouse",
      source_url: film.url,
      raw_title: film.title,
      raw_description: description,
      venue: VENUE,
      event_date_start: start,
      event_date_end: end,
    });

    if (result.inserted) newEvents++;
  }

  console.log(`[filmhouse] Found ${byUrl.size} films, scraped ${newEvents} new events`);
  return newEvents;
}
