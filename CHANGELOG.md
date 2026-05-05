# Changelog

All notable changes to `n8n-nodes-brikko` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-05

### Added

- Initial release with four community nodes:
  - `Brikko Anonymize` — mask PII in any text field, returns `masked_text`,
    `request_id` (used as `mapping_id`), and `entities` array.
  - `Brikko Restore` — reverse of Anonymize; takes the masked text plus the
    `mapping_id` returned earlier and emits the original text.
  - `Brikko Chat` — single-node pipeline: anonymize → call Brikko Gateway
    chat completion → restore. Returns `response`, `masked_prompt`,
    `masked_response`, `mapping_id`, and `latency_ms`.
  - `Brikko Detect PII` — detect-only mode (no rewriting); returns the list
    of categories found, counts, and (optionally) sample placeholders.
- Two credential types:
  - `Brikko API` — API key + base URL for the hosted Gateway (api.brikko.ru).
  - `Brikko Local Studio` — Studio sidecar URL + workspace ID for fully
    local PII handling.
- Three operation modes per node: `auto` (try local Studio first, fall back
  to Gateway), `local`, `gateway`.
- Bilingual UX strings (English + Russian) on every property.

### Notes

- "mapping_id" exposed by Brikko Anonymize is the `request_id` used by the
  underlying Anonymizer. Pass it back to Brikko Restore unchanged. The
  workspace ID must match between the two nodes — restoration is scoped to
  a workspace.
