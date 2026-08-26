import { request } from 'undici';
import { assertPublicHttpUrl } from '../security/url-policy.js';

export type RobotsDecision = {
  allowed: boolean;
  crawlDelaySeconds: number | null;
  reason: string;
};

type Rule = { type: 'allow' | 'disallow'; path: string };
type ParsedRobots = { rules: Rule[]; crawlDelaySeconds: number | null; expiresAt: number };

function parseRobots(text: string, userAgent: string): Omit<ParsedRobots, 'expiresAt'> {
  const groups: Array<{ agents: string[]; rules: Rule[]; delay: number | null }> = [];
  let current: { agents: string[]; rules: Rule[]; delay: number | null } | null = null;
  let seenRule = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === 'user-agent') {
      if (!current || seenRule) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
        seenRule = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      current.rules.push({ type: key, path: value });
      seenRule = true;
    } else if (key === 'crawl-delay') {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0 && delay <= 120) current.delay = delay;
      seenRule = true;
    }
  }

  const normalizedAgent = userAgent.toLowerCase();
  const matching = groups.filter((group) =>
    group.agents.some(
      (agent) => agent === '*' || normalizedAgent.includes(agent) || agent.includes(normalizedAgent),
    ),
  );
  const selected = matching.sort((a, b) => {
    const aLength = Math.max(...a.agents.map((agent) => (agent === '*' ? 0 : agent.length)));
    const bLength = Math.max(...b.agents.map((agent) => (agent === '*' ? 0 : agent.length)));
    return bLength - aLength;
  })[0];
  return { rules: selected?.rules || [], crawlDelaySeconds: selected?.delay ?? null };
}

function matchRule(path: string, rule: string): boolean {
  if (!rule) return false;
  const escaped = rule
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\$$/, '$');
  return new RegExp(`^${escaped}`).test(path);
}

export class RobotsCache {
  private readonly cache = new Map<string, ParsedRobots>();

  constructor(private readonly userAgent: string) {}

  async decision(rawUrl: string): Promise<RobotsDecision> {
    const url = await assertPublicHttpUrl(rawUrl);
    const origin = url.origin;
    let parsed = this.cache.get(origin);
    if (!parsed || parsed.expiresAt <= Date.now()) {
      parsed = await this.fetch(origin);
      this.cache.set(origin, parsed);
    }
    const path = `${url.pathname}${url.search}`;
    const matching = parsed.rules
      .filter((rule) => matchRule(path, rule.path))
      .sort((a, b) => b.path.length - a.path.length);
    const selected = matching[0];
    return {
      allowed: selected ? selected.type === 'allow' : true,
      crawlDelaySeconds: parsed.crawlDelaySeconds,
      reason: selected ? `robots_${selected.type}` : 'robots_no_matching_rule',
    };
  }

  private async fetch(origin: string): Promise<ParsedRobots> {
    const robotsUrl = `${origin}/robots.txt`;
    await assertPublicHttpUrl(robotsUrl);
    try {
      const response = await request(robotsUrl, {
        method: 'GET',
        headers: { 'user-agent': this.userAgent, accept: 'text/plain,*/*;q=0.1' },
        headersTimeout: 10_000,
        bodyTimeout: 10_000,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.statusCode === 401 || response.statusCode === 403) {
        await response.body.dump();
        return {
          rules: [{ type: 'disallow', path: '/' }],
          crawlDelaySeconds: null,
          expiresAt: Date.now() + 15 * 60_000,
        };
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump();
        return { rules: [], crawlDelaySeconds: null, expiresAt: Date.now() + 15 * 60_000 };
      }
      const text = (await response.body.text()).slice(0, 1_000_000);
      return { ...parseRobots(text, this.userAgent), expiresAt: Date.now() + 60 * 60_000 };
    } catch {
      return { rules: [], crawlDelaySeconds: null, expiresAt: Date.now() + 5 * 60_000 };
    }
  }
}
