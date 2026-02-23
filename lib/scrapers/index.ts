import { scrapeTheKallang } from "./thekallang";
import { scrapeEventbrite } from "./eventbrite";
import { scrapeEsplanade } from "./esplanade";
import { scrapeSportPlus } from "./sportplus";

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
  ];

  for (const scraper of scrapers) {
    try {
      const count = await scraper.fn();
      bySource[scraper.name] = count;
      total += count;

      if (count === 0) {
        console.warn(`[scrapers] Warning: ${scraper.name} returned 0 new events`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors[scraper.name] = message;
      console.error(`[scrapers] ${scraper.name} failed:`, message);
    }
  }

  return { total, bySource, errors };
}
