import { config } from '../config.js';
import { pool, withTransaction } from './db.js';
import type { OutboxEvent } from './types.js';

export class OutboxRepository {
  async claim(workerId: string, lockToken: string, limit = 20): Promise<OutboxEvent[]> {
    return withTransaction(async (client) => {
      const result = await client.query<OutboxEvent>(
        `with candidates as (
          select id from outbox_events
          where status='pending' and available_at <= now()
          order by created_at
          for update skip locked
          limit $3
        )
        update outbox_events o
        set status='processing',locked_at=now(),locked_by=$1,lock_token=$2,updated_at=now()
        from candidates c where o.id=c.id
        returning o.*`,
        [workerId, lockToken, limit],
      );
      return result.rows;
    });
  }

  async markDelivered(id: string, workerId: string, lockToken: string): Promise<boolean> {
    const result = await pool.query(
      `update outbox_events
       set status='delivered',delivered_at=now(),locked_at=null,locked_by=null,
           lock_token=null,updated_at=now()
       where id=$1 and status='processing' and locked_by=$2 and lock_token=$3`,
      [id, workerId, lockToken],
    );
    return (result.rowCount || 0) === 1;
  }

  async markFailed(
    id: string,
    workerId: string,
    lockToken: string,
    error: string,
  ): Promise<boolean> {
    return withTransaction(async (client) => {
      const prior = await client.query<{ attempts: number }>(
        `select attempts from outbox_events
         where id=$1 and status='processing' and locked_by=$2 and lock_token=$3
         for update`,
        [id, workerId, lockToken],
      );
      if (!prior.rowCount) return false;

      const attempts = (prior.rows[0]?.attempts || 0) + 1;
      const dead = attempts >= config.deliveryMaxAttempts;
      const delaySeconds = Math.min(3600, 5 * 2 ** Math.min(attempts, 10));
      const result = await client.query(
        `update outbox_events
         set status=$4,attempts=$5,last_error=$6,
             available_at=now()+($7*interval '1 second'),
             locked_at=null,locked_by=null,lock_token=null,updated_at=now()
         where id=$1 and status='processing' and locked_by=$2 and lock_token=$3`,
        [
          id,
          workerId,
          lockToken,
          dead ? 'dead_letter' : 'pending',
          attempts,
          error.slice(0, 2000),
          delaySeconds,
        ],
      );
      return (result.rowCount || 0) === 1;
    });
  }

  async releaseStaleLocks(): Promise<number> {
    const result = await pool.query(
      `update outbox_events
       set status='pending',locked_at=null,locked_by=null,lock_token=null,updated_at=now()
       where status='processing'
         and locked_at < now()-($1*interval '1 second')`,
      [config.outboxLeaseSeconds],
    );
    return result.rowCount || 0;
  }
}
