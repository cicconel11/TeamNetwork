---
type: index
title: TeamNetwork AI Agent Knowledge Bundle
description: Open Knowledge Format index for the TeamNetwork AI assistant codemaps, architecture, and taxonomies.
tags: [ai, index, okf]
timestamp: 2026-06-17T00:00:00Z
---

# TeamNetwork AI Agent Knowledge Bundle

This directory is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) (OKF) bundle: plain markdown concept documents, each carrying YAML frontmatter (`type`, `title`, `description`, `resource`, `tags`, `timestamp`). It documents the TeamNetwork AI assistant so that humans and agentic tools (Claude Code, the in-app assistant) can navigate it consistently.

Each document's `resource` field points at the primary source file it describes, giving a concept → code index.

## Architecture

- [AI Assistant Architecture Overview](/docs/agent/assistant.md) — scope policy, tools, enterprise extension, pipeline.
- [Enterprise-Aware AI Context](/docs/agent/enterprise-context.md) — activation criteria, prompt visibility, capability matrix, response policy.

## Codemaps

- [Chat Pipeline](/docs/agent/chat-pipeline-codemap.md) — auth, policy, RAG, tool execution, SSE streaming, persistence, grounding.
- [AI Intent Routing and Surface Inference](/docs/agent/ai-intent-plan.md) — intent routing and per-turn surface inference.
- [Semantic Cache](/docs/agent/semantic-cache-codemap.md) — exact-match cache eligibility, TTLs, invalidation, purge cron.
- [Thread Management](/docs/agent/threads-codemap.md) — thread/message CRUD, pagination, soft-delete, RLS.
- [UI Panel](/docs/agent/ui-panel-codemap.md) — slide-out assistant panel and SSE consumer.
- [Falkor People Graph](/docs/agent/falkor-people-graph.md) — graph powering `suggest_connections`.

## Taxonomies and reference

- [Intent Type Taxonomy](/docs/agent/intent-type-taxonomy.md) — the `intent_type` classification axis.
- [AI Data Flow — Privacy and Compliance](/docs/agent/ai-data-flow.md) — PII in the pipeline, storage, and external-provider surface.

## Flows

- [Falkor Connection Suggestions Flow](/docs/agent/falkor-connection-suggestions.md) — chat → `suggest_connections` → Falkor/SQL → pass 2.

## Audits

- [Enterprise AI Parity Audit](/docs/agent/enterprise-parity-audit.md) — enterprise UI mutations vs. AI tool coverage.

## Type vocabulary

The bundle uses a deliberately small `type` set: `architecture`, `codemap`, `taxonomy`, `reference`, `data-flow`, `audit`, `index` (this file), and `log` (the history file below).

## History

- [OKF Bundle History](/docs/agent/log.md) — reserved change log: when documents were added, restructured, and when resource paths drifted or were repaired.

## Visualizing this bundle

Because this bundle is plain markdown with YAML frontmatter, it can be rendered by Google's Open Knowledge Format static HTML visualizer. Point the visualizer in [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) at this directory (`docs/agent/`) to browse the documents and their `resource` links interactively. No build step or server is required — the visualizer reads the frontmatter directly.
