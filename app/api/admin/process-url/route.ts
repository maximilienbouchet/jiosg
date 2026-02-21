import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { isAdminAuthenticated } from "../../../../lib/admin-auth";
import { generateBlurbAndTags } from "../../../../lib/llm";

export const maxDuration = 30;

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return unauthorized();

  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { message: "Missing required field: url" },
        { status: 400 }
      );
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { message: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Fetch URL content
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let html: string;

    try {
      const response = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; jio-bot/1.0)",
        },
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return NextResponse.json(
          { message: `Unexpected content type: ${contentType}` },
          { status: 422 }
        );
      }

      html = await response.text();
    } catch (err: unknown) {
      const message = err instanceof Error && err.name === "AbortError"
        ? "URL fetch timed out (15s)"
        : "Failed to fetch URL";
      return NextResponse.json({ message }, { status: 502 });
    } finally {
      clearTimeout(timeout);
    }

    // Parse with cheerio
    const $ = cheerio.load(html);

    const rawTitle =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim() ||
      "Untitled Event";

    const rawDescription =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      $("body").text().replace(/\s+/g, " ").trim().slice(0, 2000) ||
      null;

    const venue =
      $('meta[property="og:site_name"]').attr("content") ||
      parsedUrl.hostname.replace("www.", "") ||
      "";

    // Skip filter step (admin IS the filter) — only generate blurb + tags
    const { blurb, tags } = await generateBlurbAndTags(
      rawTitle,
      rawDescription,
      venue
    );

    return NextResponse.json({
      rawTitle,
      rawDescription: rawDescription?.slice(0, 500) || null,
      venue,
      blurb,
      tags,
    });
  } catch {
    return NextResponse.json(
      { message: "Failed to process URL" },
      { status: 500 }
    );
  }
}
