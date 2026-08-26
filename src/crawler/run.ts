import crypto from 'node:crypto';
import { CheerioCrawler } from '@crawlee/cheerio';
import { NonRetryableError, RequestQueue } from '@crawlee/core';
import { PlaywrightCrawler } from '@crawlee/playwright';
import type { Job } from 'bullmq';
import { config } from '../config.js';
import { extractBusinessPage, type PageExtraction } from '../domain/extract.js';
import { resolveBusinessRecord } from '../domain/entity-resolution.js';
import type { CrawlJobRequest } from '../domain/schemas.js';
import { log } from '../log.js';
import { Repository } from '../persistence/repository.js';
import type { CrawlQueuePayload } from '../queues.js';
import {
  assertPublicHttpUrl,
  normalizeUrl,
  sameBusinessHost,
  shouldVisitUrl,
} from '../security/url-policy.js';
import { RobotsCache } from './robots.js';

class CrawlCancelledError extends Error {
  constructor() {
    super('crawl_cancelled');
  }
}

class CrawlLimitError extends Error {
  constructor(message: string) {
    super(message);
  }
}

class CrawlLeaseLostError extends Error {
  constructor() {
    super('stale_worker_lease');
  }
}

export type CrawlProgress = {
  pagesProcessed: number;
  pagesFailed: number;
  pagesDeniedByRobots: number;
  browserFallbacks: number;
  companiesResolved: number;
  startedAt: string;
};

type UserData = {
  seedUrl: string;
  depth: number;
  businessHost: string;
};

function keyForHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function pageHtml(serialize: () => string | null, body: string | Buffer | undefined): string {
  const serialized = serialize();
  if (serialized) return serialized;
  return typeof body === 'string' ? body : body?.toString('utf8') || '';
}

function emptyProgress(): CrawlProgress {
  return {
    pagesProcessed: 0,
    pagesFailed: 0,
    pagesDeniedByRobots: 0,
    browserFallbacks: 0,
    companiesResolved: 0,
    startedAt: new Date().toISOString(),
  };
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runCrawlJob(
  bullJob: Job<CrawlQueuePayload, unknown, 'crawl'>,
  repository = new Repository(),
  workerId = `crawl-worker-${process.pid}`,
): Promise<CrawlProgress> {
  const jobId = bullJob.data.jobId;
  const dispatchVersion = bullJob.data.dispatchVersion;
  if (!Number.isInteger(dispatchVersion) || dispatchVersion < 1) {
    log('warn', 'legacy_or_invalid_crawl_dispatch_ignored', {
      queueJobId: bullJob.id,
      jobId,
      dispatchVersion,
    });
    return emptyProgress();
  }

  const runToken = crypto.randomUUID();
  const job = await repository.claimJobRun(
    jobId,
    dispatchVersion,
    workerId,
    runToken,
    config.jobLeaseSeconds,
  );
  if (!job) return emptyProgress();

  const request = job.payload as CrawlJobRequest;
  const progress = emptyProgress();
  const deadline = Date.now() + config.maxJobRuntimeSeconds * 1000;
  let leaseFailure: Error | null = null;
  let heartbeatStopped = false;
  let heartbeatInFlight: Promise<void> = Promise.resolve();

  const heartbeatTimer = setInterval(() => {
    heartbeatInFlight = heartbeatInFlight
      .then(async () => {
        if (heartbeatStopped || leaseFailure) return;
        const lease = await repository.renewJobLease(
          jobId,
          runToken,
          progress,
          config.jobLeaseSeconds,
        );
        if (!lease) {
          leaseFailure = new CrawlLeaseLostError();
          return;
        }
        if (lease.cancellationRequested) leaseFailure = new CrawlCancelledError();
      })
      .catch((error: unknown) => {
        leaseFailure = errorValue(error);
      });
  }, config.jobHeartbeatSeconds * 1000);
  heartbeatTimer.unref();

  const stopHeartbeat = async (): Promise<void> => {
    if (heartbeatStopped) return;
    heartbeatStopped = true;
    clearInterval(heartbeatTimer);
    await heartbeatInFlight;
  };

  const ensureContinuable = async (): Promise<void> => {
    if (Date.now() > deadline) throw new CrawlLimitError('job_runtime_limit_exceeded');
    if (leaseFailure) throw leaseFailure;
  };

  const robots = new RobotsCache(config.scraperUserAgent);
  const extractions = new Map<string, PageExtraction[]>();
  const browserFallbacks = new Map<string, UserData>();
  const runQueueKey = `${jobId}-${runToken}`;
  const httpQueue = await RequestQueue.open(`scrapper-http-${runQueueKey}`);

  const seedUrls = request.seedUrls.slice(0, request.maxCompanies);
  for (const raw of seedUrls) {
    await ensureContinuable();
    const url = await assertPublicHttpUrl(raw);
    const normalized = normalizeUrl(url.toString());
    const host = keyForHost(url.hostname);
    await httpQueue.addRequest({
      url: normalized,
      uniqueKey: normalized,
      userData: { seedUrl: normalized, depth: 0, businessHost: host } satisfies UserData,
    });
  }

  const saveExtraction = async (
    extraction: PageExtraction,
    userData: UserData,
    statusCode?: number,
  ): Promise<void> => {
    const values = extractions.get(userData.businessHost) || [];
    values.push(extraction);
    extractions.set(userData.businessHost, values);
    await repository.savePage({
      tenantId: job.tenant_id,
      jobId,
      sourceUrl: extraction.sourceUrl,
      canonicalUrl: extraction.canonicalUrl,
      ...(statusCode ? { statusCode } : {}),
      contentHash: extraction.contentHash,
      pageTitle: extraction.pageTitle,
      metadata: {
        text_length: extraction.textLength,
        email_count: extraction.emails.length,
        phone_count: extraction.phones.length,
        officer_count: extraction.officers.length,
        likely_contact_page: extraction.likelyContactPage,
      },
    });
  };

  const httpCrawler = new CheerioCrawler({
    requestQueue: httpQueue,
    maxRequestsPerCrawl: request.maxPages,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 60,
    maxConcurrency: config.httpConcurrency,
    sameDomainDelaySecs: Math.max(1 / request.requestsPerSecond, 0.1),
    useSessionPool: true,
    persistCookiesPerSession: false,
    preNavigationHooks: [
      async ({ request: crawlerRequest }) => {
        await ensureContinuable();
        await assertPublicHttpUrl(crawlerRequest.url);
        const decision = await robots.decision(crawlerRequest.url);
        if (!decision.allowed) {
          progress.pagesDeniedByRobots += 1;
          throw new NonRetryableError('robots_denied');
        }
      },
    ],
    failedRequestHandler: async ({ request: failedRequest }, error) => {
      if (String(error?.message || error).includes('robots_denied')) return;
      progress.pagesFailed += 1;
      log('warn', 'crawl_page_failed', {
        jobId,
        url: failedRequest.url,
        error: String(error),
      });
    },
    requestHandler: async ({ request: crawleeRequest, $, body, response, enqueueLinks }) => {
      await ensureContinuable();
      const userData = crawleeRequest.userData as UserData;
      const loadedUrl = normalizeUrl(crawleeRequest.loadedUrl || crawleeRequest.url);
      await assertPublicHttpUrl(loadedUrl);
      if (!sameBusinessHost(userData.seedUrl, loadedUrl)) {
        throw new NonRetryableError('cross_domain_redirect_rejected');
      }
      const html = pageHtml(() => $.html(), body);
      if (!html) throw new NonRetryableError('empty_html');
      const extraction = extractBusinessPage(html, loadedUrl);
      await saveExtraction(extraction, userData, response?.statusCode);
      progress.pagesProcessed += 1;

      if (request.browser === 'auto' && extraction.requiresBrowserFallback) {
        browserFallbacks.set(loadedUrl, userData);
      }

      if (
        request.mode !== 'single' &&
        userData.depth < request.maxDepth &&
        progress.pagesProcessed < request.maxPages
      ) {
        await enqueueLinks({
          strategy: 'same-hostname',
          transformRequestFunction: (next) => {
            try {
              const normalized = normalizeUrl(next.url);
              if (
                !sameBusinessHost(userData.seedUrl, normalized) ||
                !shouldVisitUrl(normalized, request.includePatterns, request.excludePatterns)
              ) {
                return false;
              }
              next.url = normalized;
              next.uniqueKey = normalized;
              next.userData = {
                seedUrl: userData.seedUrl,
                depth: userData.depth + 1,
                businessHost: userData.businessHost,
              } satisfies UserData;
              return next;
            } catch {
              return false;
            }
          },
        });
      }

      if (progress.pagesProcessed % 10 === 0) {
        await ensureContinuable();
        await bullJob.updateProgress(progress);
      }
    },
  });

  try {
    if (request.browser === 'playwright') {
      for (const raw of seedUrls) {
        browserFallbacks.set(normalizeUrl(raw), {
          seedUrl: normalizeUrl(raw),
          depth: 0,
          businessHost: keyForHost(new URL(raw).hostname),
        });
      }
    } else {
      await httpCrawler.run();
    }

    if (request.browser !== 'http' && browserFallbacks.size > 0) {
      const browserQueue = await RequestQueue.open(`scrapper-browser-${runQueueKey}`);
      const fallbackLimit =
        request.browser === 'playwright'
          ? request.maxPages
          : Math.max(1, Math.floor(request.maxPages * 0.25));
      for (const [url, userData] of [...browserFallbacks.entries()].slice(0, fallbackLimit)) {
        await browserQueue.addRequest({ url, uniqueKey: `${url}#browser`, userData });
      }
      const browserCrawler = new PlaywrightCrawler({
        requestQueue: browserQueue,
        maxRequestsPerCrawl: fallbackLimit,
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 90,
        maxConcurrency: config.browserConcurrency,
        sameDomainDelaySecs: Math.max(1 / request.requestsPerSecond, 0.25),
        launchContext: {
          launchOptions: {
            headless: true,
            args: ['--disable-dev-shm-usage', '--disable-background-networking'],
          },
        },
        preNavigationHooks: [
          async ({ request: browserRequest, page }) => {
            await ensureContinuable();
            await assertPublicHttpUrl(browserRequest.url);
            const decision = await robots.decision(browserRequest.url);
            if (!decision.allowed) throw new NonRetryableError('robots_denied');
            await page.route('**/*', async (route) => {
              try {
                const url = route.request().url();
                if (!['http:', 'https:'].includes(new URL(url).protocol)) return route.abort();
                await assertPublicHttpUrl(url);
                return route.continue();
              } catch {
                return route.abort();
              }
            });
          },
        ],
        failedRequestHandler: async ({ request: failedRequest }, error) => {
          if (String(error?.message || error).includes('robots_denied')) return;
          progress.pagesFailed += 1;
          log('warn', 'browser_page_failed', {
            jobId,
            url: failedRequest.url,
            error: String(error),
          });
        },
        requestHandler: async ({ request: browserRequest, page, response }) => {
          await ensureContinuable();
          const userData = browserRequest.userData as UserData;
          const loadedUrl = normalizeUrl(page.url() || browserRequest.url);
          await assertPublicHttpUrl(loadedUrl);
          if (!sameBusinessHost(userData.seedUrl, loadedUrl)) {
            throw new NonRetryableError('cross_domain_redirect_rejected');
          }
          const extraction = extractBusinessPage(await page.content(), loadedUrl);
          await saveExtraction(extraction, userData, response?.status());
          progress.browserFallbacks += 1;
          progress.pagesProcessed += 1;
        },
      });
      await browserCrawler.run();
    }

    for (const pages of extractions.values()) {
      await ensureContinuable();
      if (!pages.length) continue;
      const record = resolveBusinessRecord(pages, request, config.einFingerprintPepper);
      await repository.upsertBusiness(job.tenant_id, jobId, record, request.verification);
      progress.companiesResolved += 1;
    }

    await ensureContinuable();
    await stopHeartbeat();
    if (leaseFailure) throw leaseFailure;
    await repository.finalizeJob(jobId, runToken, progress);
    return progress;
  } catch (caught) {
    await stopHeartbeat();
    const error = leaseFailure || errorValue(caught);
    const message = error.message;
    const code =
      error instanceof CrawlCancelledError
        ? 'crawl_cancelled'
        : error instanceof CrawlLimitError
          ? 'crawl_limit_exceeded'
          : error instanceof CrawlLeaseLostError
            ? 'stale_worker_lease'
            : 'crawl_failed';
    if (!(error instanceof CrawlLeaseLostError)) {
      await repository.failJob(jobId, runToken, code, message);
    }
    throw error;
  }
}
