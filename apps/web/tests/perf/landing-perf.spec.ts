import { test, type BrowserContext, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });

const ROUTES = ["/", "/auth/login", "/auth/signup"] as const;
const ITERATIONS = 3;

interface RouteSample {
  lcp_ms: number;
  fcp_ms: number;
  ttfb_ms: number;
  transfer_bytes: number;
}

interface CdpMetric {
  name: string;
  value: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function captureLcp(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            last = entries[entries.length - 1].startTime;
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(last);
        }, 1000);
      }),
  );
}

async function captureFcp(page: Page): Promise<number> {
  return page.evaluate(() => {
    const entry = performance
      .getEntriesByType("paint")
      .find((e) => e.name === "first-contentful-paint");
    return entry ? entry.startTime : 0;
  });
}

async function captureCdpMetrics(context: BrowserContext, page: Page) {
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  const result = (await client.send("Performance.getMetrics")) as {
    metrics: CdpMetric[];
  };
  const map = new Map(result.metrics.map((m) => [m.name, m.value]));
  await client.detach();
  return map;
}

async function sampleRoute(context: BrowserContext, route: string): Promise<RouteSample> {
  const page = await context.newPage();
  let transferBytes = 0;
  page.on("response", async (res) => {
    try {
      const len = res.headers()["content-length"];
      if (len) transferBytes += parseInt(len, 10);
    } catch {
      // ignore
    }
  });

  const navStart = Date.now();
  const response = await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const [lcp, fcp, cdp] = await Promise.all([
    captureLcp(page),
    captureFcp(page),
    captureCdpMetrics(context, page),
  ]);

  // TTFB: prefer Navigation Timing if available, fall back to nav duration.
  const ttfb = await page.evaluate(() => {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return nav ? nav.responseStart : 0;
  });

  await page.close();

  return {
    lcp_ms: lcp,
    fcp_ms: fcp,
    ttfb_ms: ttfb > 0 ? ttfb : Date.now() - navStart,
    transfer_bytes: transferBytes,
  };
  // Note: response/cdp returned for potential future use
  void response;
  void cdp;
}

test("capture perf snapshot", async ({ browser }) => {
  const routes: Record<string, RouteSample> = {};

  for (const route of ROUTES) {
    const samples: RouteSample[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const context = await browser.newContext();
      try {
        samples.push(await sampleRoute(context, route));
      } finally {
        await context.close();
      }
    }
    routes[route] = {
      lcp_ms: median(samples.map((s) => s.lcp_ms)),
      fcp_ms: median(samples.map((s) => s.fcp_ms)),
      ttfb_ms: median(samples.map((s) => s.ttfb_ms)),
      transfer_bytes: median(samples.map((s) => s.transfer_bytes)),
    };
  }

  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // ignore
  }

  const capturedAt = new Date().toISOString();
  const payload = {
    git_sha: gitSha,
    node_version: process.version,
    captured_at: capturedAt,
    routes,
  };

  const outDir = join(process.cwd(), "audit", "perf-snapshots");
  mkdirSync(outDir, { recursive: true });
  const safeTs = capturedAt.replace(/[:.]/g, "-");
  const outPath = join(outDir, `${gitSha}-${safeTs}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[perf] wrote ${outPath}`);
});
