# Canonical crawler repository

## Decision

`appolon1908-hue/kyqra-crawler` is the canonical crawler source and future runtime
authority. `appolon1908-hue/scrapper` is a preserved legacy implementation lineage; it is
not an independent crawler system and must not become a second production API, queue,
credential store, job ledger, workflow family, or deployed runtime.

The legacy package name `codestra-business-scrapper` and repository name `scrapper` are
source identifiers only. They do not establish a separate system identity. Existing
`crawler.*` event and command names remain the correct Kyqra contract vocabulary.

## Consequences

- The feature and deployment phases that followed Gate 0 in the Scrapper mission do not
  run in this repository.
- Credential-vault, frontier, provider, extraction, observability, compliance, staging,
  and production work must be re-scoped to `appolon1908-hue/kyqra-crawler` after a
  source-and-contract parity review.
- The source in this repository remains available as migration evidence. It is not deleted
  or silently copied.
- The retained staging and production workflow source is fail-closed by an authority gate.
  It may be inspected during parity review but cannot deploy from this repository.
- No runtime cutover, data migration, callback change, credential change, or production
  activation is authorized by this decision.

## Integration boundary

```text
Client / n8n -> Kong -> Middleware -> Kyqra Crawler
                                      |
                                      +-> signed result events -> Middleware -> authorized consumers
```

Middleware remains the cross-system control and write boundary. The crawler owns crawl-job
execution and crawl-result truth; neither crawler lineage writes directly to Odoo or treats
n8n as a correctness store.

## Migration gate

Authority moves only with committed evidence for source parity, contract parity, backup and
restore, queue drain, callback cutover, immutable images, runtime read-back, rollback
rehearsal, and independent approval. Until those gates pass:

```text
SCRAPPER_PRODUCTION_AUTHORITY=NO
KYQRA_RUNTIME_CUTOVER_VERIFIED=NO
PRODUCTION_CHANGED=NO
```
