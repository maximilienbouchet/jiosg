import { scrapeTheKallang } from "./thekallang";
import { scrapeEventbrite } from "./eventbrite";
import { scrapeEsplanade } from "./esplanade";
import { scrapeSportPlus } from "./sportplus";
import { scrapePeatix } from "./peatix";
import { scrapeFever } from "./fever";
import { scrapeTessera } from "./tessera";
import { scrapeScape } from "./scape";
import { scrapeSrt } from "./srt";

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
    { name: "sportplus", fn: scrapeSportPlus },
    { name: "peatix", fn: scrapePeatix },
    { name: "fever", fn: scrapeFever },
    { name: "tessera", fn: scrapeTessera },
    { name: "scape", fn: scrapeScape },
    { name: "srt", fn: scrapeSrt },
  ];

  // Run all scrapers in parallel for speed (critical for Vercel 60s timeout)
  const results = await Promise.allSettled(
    scrapers.map(async (scraper) => {
      const count = await scraper.fn();
      return { name: scraper.name, count };
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
