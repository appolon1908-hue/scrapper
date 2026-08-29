# Preserved Kyqra lineage ↔ Middleware ↔ n8n integration

## Authority

The crawler service owns crawler job policy, target validation, execution state, normalized result state, retention and callback evidence. Middleware owns cross-system authorization, tenant mapping, durable commands, replay protection and result delivery. n8n coordinates approved sequences only.

n8n never calls the crawler API, Redis/BullMQ, Playwright, Crawlee, PostgreSQL, search engines, Odoo or a provider directly.

```text
Discovery request
  -> Kong/Middleware
  -> target, privacy and tenant policy
  -> durable crawler command
  -> crawler job and worker execution
  -> signed result to Middleware inbox
  -> durable automation job
  -> n8n human review/enrichment sequence
  -> governed Middleware writeback
  -> Odoo or product read-back
```

## Events available to automation

```text
crawler.job.accepted
crawler.job.started
crawler.job.completed
crawler.job.retryable_failed
crawler.job.failed_terminal
crawler.result.review_required
crawler.result.approved
crawler.result.rejected
crawler.retention.due
crawler.privacy_delete.requested
```

Provider/worker callbacks are signed, timestamped, replay protected and stored in the Middleware inbox before acknowledgement.

## Commands requested through Middleware

```text
crawler.job.request
crawler.job.cancel
crawler.job.retry
crawler.result.create_review
crawler.result.approve
crawler.result.reject
crawler.result.publish_enrichment
crawler.retention.apply
crawler.privacy_delete.apply
```

A timeout is an unknown result. Middleware reconciles the crawler job before retrying execution.

## Initial n8n workflows

```text
kyqra.crawler.job-request.v1
kyqra.crawler.result-received.v1
kyqra.crawler.human-review.v1
kyqra.crawler.enrichment-publish.v1
kyqra.crawler.failure-retry.v1
kyqra.crawler.retention-cleanup.v1
```

## Isolation and safety

- Every job carries an authoritative tenant and company identifier.
- A batch containing multiple companies preserves per-company isolation.
- One company failure cannot roll back, unlock, approve or replay another company.
- Target allowlists, crawl limits, robots/privacy policy and retention are enforced by the crawler/Middleware boundary, not by n8n.
- n8n receives normalized result references, not unrestricted browser traces or secrets.
- Enrichment writeback requires `CRAWLER_WRITEBACK=true` and human review where configured.
- Live crawling requires `CRAWLER_EXECUTION=true`; both capabilities remain false by default.
- No direct Odoo lead creation occurs from n8n or crawler workers.

## Branch dependencies

```text
scrapper/main (preserved migration evidence only)
Middleware-/core/integration-contracts
Middleware-/core/event-ledger-outbox
Middleware-/core/webhook-inbox-replay
Middleware-/core/workers-scheduler
Middleware-/integration/keycloak
Middleware-/integration/n8n
Middleware-/integration/kyqra
N8N/contract/automation-control-plane-v2-20260827
N8N/shared/automation-runtime
N8N/automation/kyqra-crawler
```

## Acceptance

```text
DIRECT_N8N_CRAWLER_ACCESS=DENIED
DIRECT_N8N_REDIS_DATABASE_ACCESS=DENIED
TARGET_POLICY_ENFORCED=PASS
TENANT_AND_COMPANY_ISOLATION=PASS
SIGNED_RESULT_REPLAY_PROTECTION=PASS
EXACT_REPLAY=PASS
CONFLICTING_REPLAY=PASS
UNKNOWN_JOB_OUTCOME_RECONCILED=PASS
HUMAN_REVIEW_REQUIRED_WHERE_CONFIGURED=PASS
CRAWLER_EXECUTION=false
CRAWLER_WRITEBACK=false
WORKFLOWS_ACTIVE_IN_GIT=NO
PRODUCTION_CHANGED=NO
```
