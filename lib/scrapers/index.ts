import { initializeDb, insertScraperRun } from "../db";
import { scrapeTheKallang } from "./thekallang";
import { scrapeEventbrite } from "./eventbrite";
import { scrapeEsplanade } from "./esplanade";
import { scrapePeatix } from "./peatix";
import { scrapeFever } from "./fever";
import { scrapeTessera } from "./tessera";
import { scrapeScape } from "./scape";
import { scrapeSrt } from "./srt";
import { scrapeBookMyShow } from "./bookmyshow";
import { scrapeFilmhouse } from "./filmhouse";
import { scrapeSingaporegp } from "./singaporegp";
import { scrapeTicketmaster } from "./ticketmaster";
import { scrapeSistic } from "./sistic";
import { scrapeActivesg } from "./activesg";
import { scrapeJustrunlah } from "./justrunlah";
import { scrapeRa } from "./ra";
import { scrapeSagg } from "./sagg";
import { scrapeFoodeditorial } from "./foodeditorial";
import { scrapeLamc } from "./lamc";

// A single scraper must not be able to eat the whole serverless budget. Vercel
// kills the function at 60s; cap each scraper below that so the slow ones fail
// loudly instead of starving the rest. Scrapers run in parallel, so the whole
// phase is bounded by this. Slowest today is eventbrite at ~44s.
const SCRAPER_TIMEOUT_MS = 50_000;

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export async function runAllScrapers(): Promise<{
  total: number;
  bySource: Record<string, number>;
  errors: Record<string, string>;
}> {
  const bySource: Record<string, number> = {};
  const errors: Record<string, string> = {};
  let total = 0;

  const scrapers: { name: string; fn: () => Promise<number> }[] = [
    { name: "thekallang", fn: scrapeTheKallang },
    { name: "eventbrite", fn: scrapeEventbrite },
    { name: "esplanade", fn: scrapeEsplanade },
    // sportplus retired Sep 2026: 1 published event in its lifetime, nothing
    // new since June, and the site moved off its scrapable Wix feed. activesg
    // and justrunlah cover the sport lane properly now. Existing rows keep
    // their source value; lib/scrapers/sportplus.ts is left in place in case
    // the site becomes scrapable again.
    { name: "peatix", fn: scrapePeatix },
    { name: "fever", fn: scrapeFever },
    { name: "tessera", fn: scrapeTessera },
    { name: "scape", fn: scrapeScape },
    { name: "srt", fn: scrapeSrt },
    { name: "bookmyshow", fn: scrapeBookMyShow },
    { name: "filmhouse", fn: scrapeFilmhouse },
    { name: "singaporegp", fn: scrapeSingaporegp },
    { name: "ticketmaster", fn: scrapeTicketmaster },
    { name: "sistic", fn: scrapeSistic },
    { name: "activesg", fn: scrapeActivesg },
    { name: "justrunlah", fn: scrapeJustrunlah },
    { name: "ra", fn: scrapeRa },
    { name: "sagg", fn: scrapeSagg },
    { name: "foodeditorial", fn: scrapeFoodeditorial },
    { name: "lamc", fn: scrapeLamc },
  ];

  await initializeDb();

  // Run all scrapers in parallel for speed (critical for Vercel 60s timeout),
  // and record each run the moment it settles rather than after the whole batch.
  // Logging at the end meant a timeout killed the function before anything was
  // written, which is how broken scrapers went unnoticed for months.
  const results = await Promise.allSettled(
    scrapers.map(async (scraper) => {
      try {
        const count = await withTimeout(scraper.fn(), SCRAPER_TIMEOUT_MS, scraper.name);
        await insertScraperRun({ source: scraper.name, events_found: count, error: null });
        return { name: scraper.name, count };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await insertScraperRun({ source: scraper.name, events_found: 0, error: message }).catch(
          (logError) => console.error(`[scrapers] Could not log ${scraper.name} failure:`, logError)
        );
        throw error;
      }
    })
  );

  for (let i = 0; i < scrapers.length; i++) {
    const result = results[i];
    const name = scrapers[i].name;
    if (result.status === "fulfilled") {
      bySource[name] = result.value.count;
      total += result.value.count;
      if (result.value.count === 0) {
        console.warn(`[scrapers] Warning: ${name} returned 0 new events`);
      }
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors[name] = message;
      console.error(`[scrapers] ${name} failed:`, message);
    }
  }

  return { total, bySource, errors };
}
