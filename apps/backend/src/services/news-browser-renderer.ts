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

export interface NewsBrowserRenderer {
  render(url: string): Promise<BrowserRenderResult>;
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

export function createNewsBrowserRenderer(): NewsBrowserRenderer {
  return new PlaywrightNewsBrowserRenderer();
}
