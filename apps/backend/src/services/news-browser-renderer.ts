import { chromium, type Browser } from "playwright";
import { runtimeConfig } from "../config/env.js";
import { assertPublicHostname, validateRssUrl } from "./news-rss-service.js";

const NAVIGATION_TIMEOUT_MS = 15_000;
const MAX_BROWSER_HTML_BYTES = 4 * 1024 * 1024;
const MAX_CONCURRENT_BROWSER_JOBS = 1;

export type BrowserRenderResult = {
  html: string;
  finalUrl: string;
  contentType: string;
};

export type BrowserExtractedEntry = {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
};

export type BrowserExtractionSelectors = {
  item: string;
  title: string;
  link: string;
  summary?: string;
  date?: string;
};

export interface NewsBrowserRenderer {
  render(url: string): Promise<BrowserRenderResult>;
  extract?(url: string, selectors: BrowserExtractionSelectors): Promise<{ entries: BrowserExtractedEntry[]; finalUrl: string; sourceName: string }>;
  close?: () => Promise<void>;
}

function isChallengePage(value: string): boolean {
  return /just a moment|checking your browser|cf-chl-|challenge-platform|captcha|access denied|automated access/i.test(value);
}

class PlaywrightNewsBrowserRenderer implements NewsBrowserRenderer {
  private browser: Browser | null = null;
  private activeJobs = 0;
  private queue: Array<{
    url: string;
    resolve: (result: BrowserRenderResult) => void;
    reject: (error: unknown) => void;
  }> = [];

  async render(url: string): Promise<BrowserRenderResult> {
    validateRssUrl(url);
    if (runtimeConfig.newsTestMode) {
      throw new Error("browser_rendering_disabled_in_test_mode");
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ url, resolve, reject });
      void this.drain();
    });
  }

  async extract(url: string, selectors: BrowserExtractionSelectors): Promise<{ entries: BrowserExtractedEntry[]; finalUrl: string; sourceName: string }> {
    validateSelectors(selectors);
    if (runtimeConfig.newsTestMode) throw new Error("browser_rendering_disabled_in_test_mode");
    const rendered = await this.render(url);
    const browser = this.browser ?? await chromium.launch({ headless: true });
    this.browser = browser;
    const context = await browser.newContext({ javaScriptEnabled: true });
    try {
      const page = await context.newPage();
      await page.setContent(rendered.html, { waitUntil: "domcontentloaded" });
      const entries = await page.locator(selectors.item).evaluateAll((items, fields) => items.slice(0, 25).map((item) => {
        const getElement = (selector?: string) => selector ? item.querySelector(selector) : null;
        const text = (element: typeof item | null): string => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const titleElement = getElement(fields.title);
        const linkElement = getElement(fields.link);
        const summaryElement = getElement(fields.summary);
        const dateElement = getElement(fields.date);
        const rawDate = dateElement?.getAttribute("datetime") ?? dateElement?.getAttribute("content") ?? text(dateElement);
        const parsedDate = rawDate ? Date.parse(rawDate) : NaN;
        return {
          title: text(titleElement) || titleElement?.getAttribute("title") || "",
          // Keep the publisher's href as authored. The snapshot is loaded with
          // setContent(), where HTMLAnchorElement.href would resolve against
          // about:blank instead of the original page URL.
          url: linkElement?.getAttribute("href") ?? "",
          summary: text(summaryElement) || summaryElement?.getAttribute("content") || null,
          publishedAt: Number.isNaN(parsedDate) ? null : new Date(parsedDate).toISOString()
        };
      }), selectors);
      return { entries: entries.filter((entry) => entry.title && entry.url), finalUrl: rendered.finalUrl, sourceName: new URL(rendered.finalUrl).hostname };
    } finally {
      await context.close();
    }
  }

  private async drain(): Promise<void> {
    if (this.activeJobs >= MAX_CONCURRENT_BROWSER_JOBS) return;
    const job = this.queue.shift();
    if (!job) return;
    this.activeJobs += 1;
    try {
      job.resolve(await this.runJob(job.url));
    } catch (error) {
      job.reject(error);
    } finally {
      this.activeJobs -= 1;
      void this.drain();
    }
  }

  private async runJob(url: string): Promise<BrowserRenderResult> {
    const parsedUrl = validateRssUrl(url);
    await assertPublicHostname(parsedUrl.hostname);
    let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
    try {
      this.browser ??= await chromium.launch({ headless: true });
      context = await this.browser.newContext({ javaScriptEnabled: true });
      const page = await context.newPage();
      let redirectCount = 0;
      page.on("response", (response) => {
        let request = response.request().redirectedFrom();
        while (request) {
          redirectCount += 1;
          request = request.redirectedFrom();
        }
      });
      await page.route("**/*", async (route) => {
        if (["image", "media", "font"].includes(route.request().resourceType())) {
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.goto(parsedUrl.toString(), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      if (redirectCount > 3) throw new Error("rss_redirect_limit_exceeded");
      const finalUrl = validateRssUrl(page.url()).toString();
      await assertPublicHostname(new URL(finalUrl).hostname);
      const html = await page.content();
      if (Buffer.byteLength(html, "utf8") > MAX_BROWSER_HTML_BYTES) {
        throw new Error("browser_response_too_large");
      }
      if (isChallengePage(html) || isChallengePage(await page.title().catch(() => ""))) {
        throw new Error("automated_access_blocked");
      }
      return { html, finalUrl, contentType: "text/html" };
    } catch (error) {
      if (error instanceof Error && /executable doesn't exist|browserType\.launch|Failed to launch/i.test(error.message)) {
        throw new Error("browser_rendering_unavailable");
      }
      if (error instanceof Error && /Timeout|timed out/i.test(error.message)) {
        throw new Error("browser_navigation_timeout");
      }
      if (error instanceof Error && /Target page, context or browser has been closed/i.test(error.message)) {
        this.browser = null;
      }
      throw error;
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.queue.splice(0).forEach((job) => job.reject(new Error("browser_renderer_closed")));
    await browser?.close().catch(() => undefined);
  }
}

function validateSelectors(selectors: BrowserExtractionSelectors): void {
  for (const selector of [selectors.item, selectors.title, selectors.link, selectors.summary, selectors.date]) {
    if (selector !== undefined && (typeof selector !== "string" || selector.trim().length > 300)) throw new Error("webpage_selector_invalid");
  }
  if (!selectors.item?.trim() || !selectors.title?.trim() || !selectors.link?.trim()) throw new Error("webpage_selector_required");
}

export function createNewsBrowserRenderer(): NewsBrowserRenderer {
  return new PlaywrightNewsBrowserRenderer();
}
