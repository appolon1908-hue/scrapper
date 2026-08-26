# Enterprise implementation stack

This branch begins the capability-gated enterprise platform extension. It is based on the modular production-readiness line and is not a live deployment.

Dependency order:

1. ingestion, discovery and per-company target isolation
2. Keycloak, signed n8n inbox and provider-gated EIN verification
3. review, Odoo delivery, compliance and admin console
4. immutable image and end-to-end release evidence

All external discovery, EIN verification and direct Odoo writes remain disabled until server-side provider credentials, tenant policy and explicit release approval are present.
