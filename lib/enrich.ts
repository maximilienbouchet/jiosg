import * as cheerio from "cheerio";

/**
 * Fetch the actual event page and extract a richer description.
 * Returns null on any failure (graceful fallback).
 */
export async function enrichDescription(sourceUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "SGEventsCuration/1.0",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // For Eventbrite: try structured data first (most reliable)
    if (sourceUrl.includes("eventbrite")) {
      const ldJson = $('script[type="application/ld+json"]').first().html();
      if (ldJson) {
        try {
          const structured = JSON.parse(ldJson);
          const desc = structured.description || structured.about;
          if (desc && typeof desc === "string" && desc.length > 50) {
            return desc.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 2000);
          }
        } catch {
          // Fall through to meta tags
        }
      }
    }

    // Standard fallback chain: og:description → meta description → body text
    const ogDescription = $('meta[property="og:description"]').attr("content");
    if (ogDescription && ogDescription.length > 50) {
      return ogDescription.trim().slice(0, 2000);
    }

    const metaDescription = $('meta[name="description"]').attr("content");
    if (metaDescription && metaDescription.length > 50) {
      return metaDescription.trim().slice(0, 2000);
    }

    // Last resort: body text (strip scripts/styles first)
    $("script, style, nav, header, footer").remove();
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    if (bodyText.length > 50) {
      return bodyText.slice(0, 2000);
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
