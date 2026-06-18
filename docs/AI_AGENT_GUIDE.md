# AI Agent Guide

This repository is designed to be readable and maintainable by AI coding agents.

## Project Intent

GiTO Live Sports is a professional sports operations platform. The MVP should remain focused on desktop operations, IPTV integration, match scheduling, approval workflow, and mobile live stream delivery.

## Architecture Guardrails

- Do not add unnecessary infrastructure.
- Do not replace SQLite unless explicitly requested.
- Keep backend services lightweight.
- Preserve modular boundaries between desktop, backend, mobile, and shared contracts.
- Update documentation when changing architecture, workflows, or data models.

## Preferred Workflow

1. Read the relevant documentation in `docs`.
2. Inspect current code before editing.
3. Make the smallest complete change that satisfies the task.
4. Add or update tests for meaningful behavior.
5. Keep names consistent with `docs/DEVELOPMENT_RULES.md`.

## Important Concepts

- Competitions are not strictly country-dependent.
- Stream approval is explicit and central to the platform.
- Mobile clients should consume approved stream metadata only.
- IPTV provider details and secrets stay server-side.

