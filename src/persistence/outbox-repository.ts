import { config } from '../config.js';
import { pool, withTransaction } from './db.js';
import type { OutboxEvent } from './types.js';

export class OutboxRepository {
  async claim(workerId: string, limit = 20): Promise<OutboxEvent[]> {
    return withTransaction(async (client) => {
      const result = await client.query<OutboxEvent>(
        `with candidates as (
          select id from outbox_events
          where status='pending' and available_at <= now()
          order by created_at
          for update skip locked
          limit $2
        )
        update outbox_events o
        set status='processing',locked_at=now(),locked_by=$1,updated_at=now()
        from candidates c where o.id=c.id
        returning o.*`,
        [workerId, limit],
      );
      return result.rows;
    });
  }

  async markDelivered(id: string): Promise<void> {
    await pool.query(
      `update outbox_events
       set status='delivered',delivered_at=now(),locked_at=null,locked_by=null,updated_at=now()
       where id=$1`,
      [id],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await withTransaction(async (client) => {
      const prior = await client.query<{ attempts: number }>(
        'select attempts from outbox_events where id=$1 for update',
        [id],
      );
      const attempts = (prior.rows[0]?.attempts || 0) + 1;
      const dead = attempts >= config.deliveryMaxAttempts;
      const delaySeconds = Math.min(3600, 5 * 2 ** Math.min(attempts, 10));
      await client.query(
        `update outbox_events
         set status=$2,attempts=$3,last_error=$4,
             available_at=now()+($5*interval '1 second'),
             locked_at=null,locked_by=null,updated_at=now()
         where id=$1`,
        [id, dead ? 'dead_letter' : 'pending', attempts, error.slice(0, 2000), delaySeconds],
      );
    });
  }

  async releaseStaleLocks(): Promise<number> {
    const result = await pool.query(
      `update outbox_events
       set status='pending',locked_at=null,locked_by=null,updated_at=now()
       where status='processing' and locked_at < now()-interval '10 minutes'`,
    );
    return result.rowCount || 0;
  }
}
