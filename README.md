# Codestra Business Scrapper

Production-oriented, multi-tenant business website crawler and CRM enrichment service. This branch contains the runtime foundation: authenticated job APIs, bounded Crawlee workers, PostgreSQL authority, Redis/BullMQ scheduling, public business-data extraction, entity resolution, privacy-preserving EIN comparison, and a durable delivery outbox.

The Kong/Caddy/Odoo/n8n integration contract and the expanded security/test evidence are delivered in stacked review branches. External delivery and registry enrichment are disabled by default.
