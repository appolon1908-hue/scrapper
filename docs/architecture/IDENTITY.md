# Identity architecture

This document records the Keycloak realm and client design recovered from the enterprise security lineage. It is the Phase 7 target architecture; the current Phase 0 implementation does not enable or claim an OIDC deployment.

## Authority and canonical host

Keycloak at `auth.codestra.co` is the identity authority for human operators and trusted machine clients. Kong remains the public enforcement point and forwards only authenticated, tenant-bound requests to the API.

Browser sessions use OAuth 2.0 Authorization Code with PKCE. Session, refresh-token, and client-secret material is server-side only. Cookies are `HttpOnly`, `Secure`, and `SameSite=Lax` or stricter. Tokens and secrets must never be exposed to browser JavaScript or stored in local storage.

## Realm and tenancy model

- Realm: `codestra`.
- Tenants map to Keycloak groups under `/tenants/<tenant-id>`.
- A human principal must have exactly one active tenant group in a tenant-scoped session.
- The API derives `tenant_id` from verified identity claims and rejects a conflicting `X-Tenant-Id` header.
- Cross-tenant support access requires an explicit, time-bounded support role and an audited tenant-selection action.

## Clients

| Client               | Type                         | Flow                           | Purpose                                          |
| -------------------- | ---------------------------- | ------------------------------ | ------------------------------------------------ |
| `scrapper-dashboard` | Public                       | Authorization Code + PKCE      | Human dashboard login                            |
| `scrapper-api`       | Confidential resource server | JWT validation / introspection | API audience and scope enforcement               |
| `scrapper-workers`   | Confidential                 | Client Credentials             | Queue workers and internal control traffic       |
| `scrapper-n8n`       | Confidential                 | Client Credentials             | Signed n8n command ingestion                     |
| `scrapper-kong`      | Confidential                 | Client Credentials             | Gateway introspection and service authentication |

Redirect URIs and web origins are exact allowlists. Wildcard production redirects are prohibited. Machine clients use private-key JWT or rotated client secrets delivered through the runtime secret store.

## Roles and scopes

Realm roles are `platform_admin`, `tenant_admin`, `operator`, and `read_only`. API authorization continues to use narrow scopes:

- `scrapper:jobs:read`, `scrapper:jobs:write`, and `scrapper:jobs:cancel`
- `scrapper:operations:read` and `scrapper:operations:write`
- `scrapper:tenants:read` and `scrapper:tenants:write`
- `scrapper:reviews:read` and `scrapper:reviews:write`
- `scrapper:integrations:read` and `scrapper:integrations:write`
- `scrapper:audit:read`

Roles grant scope bundles; handlers authorize scopes, not role names. Tenant membership is checked independently of scopes.

## Token and session policy

- Access tokens: five-minute maximum lifetime, issuer and audience required.
- Refresh tokens: rotation enabled with reuse detection; encrypted at rest when server-side persistence is required.
- Clock skew: at most 60 seconds.
- Logout revokes the server session and refresh-token family.
- Key rotation accepts the prior signing key only for the bounded token lifetime.
- Introspection and JWKS failures fail closed; cached keys may be used only within their validated freshness window.

Authentication state stores a hash of `state`, the PKCE verifier, nonce, exact redirect URI, creation time, and expiry. Callback processing consumes state once. Human sessions store subject, tenant, client, scopes, roles, CSRF hash, expiry, last-seen time, and revocation time.

## Machine and inbound command security

Trusted machine clients present an OIDC token with the expected issuer, audience, client identity, and scopes. n8n commands additionally carry a signed event identifier, timestamp, idempotency key, correlation identifier, and body digest. Replay protection is tenant- and source-scoped.

The existing hashed service-principal path may remain only as a migration compatibility path. Phase 7 removes it from every non-test runtime path after OIDC end-to-end acceptance succeeds.

## Audit requirements

Login success and failure, logout, token rejection, tenant selection, role or group change, support impersonation, machine-client authentication, and command replay rejection emit structured audit events. Events include actor, tenant, action, resource, correlation ID, outcome, and non-secret metadata.

## Fail-closed rollout

The recovered design used the following disabled-by-default capabilities:

```text
ENABLE_KEYCLOAK_HUMAN_LOGIN=false
ENABLE_N8N_INBOUND=false
ENABLE_EIN_PROVIDER=false
ENABLE_EXTERNAL_DELIVERY=false
```

No capability is live merely because its code or configuration exists. Activation requires exact-head CI, PostgreSQL and Redis integration tests, immutable-image staging evidence, and explicit production approval.
