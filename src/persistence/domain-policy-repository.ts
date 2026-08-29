import { pool } from './db.js';
import type { DomainPolicy } from './types.js';

export class DomainPolicyRepository {
  async getForHost(hostname: string): Promise<DomainPolicy | null> {
    const normalized = hostname
      .trim()
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    if (!normalized) return null;
    const result = await pool.query<DomainPolicy>(
      `select domain,robots_posture,tos_review_status,tos_reference,max_rps::float8,
              crawl_delay_seconds,requires_authentication,blocked,reviewed_at,reviewed_by
         from domain_policies
        where $1 = lower(domain) or $1 like '%.' || lower(domain)
        order by length(domain) desc
        limit 1`,
      [normalized],
    );
    return result.rows[0] ?? null;
  }
}
