# Fixtures

Two layers back `QLOO_MODE=fixture`. The client checks them in this order.

## `recorded/` (git-ignored)

Real responses captured from `https://hackathon.api.qloo.com` by `npm run record`.
One JSON file per distinct request, named `<path-slug>__<sha256-prefix>.json`, where the
hash covers the path and the sorted query parameters, so a replay must match exactly.
Each file holds `_meta` (source `live`, the request, HTTP status, timestamp) and `body`.

These files contain Qloo data. The hackathon guide asks that Qloo responses not be
published in public repositories, so `*.json` here is ignored by git. Only `.gitkeep`
is committed.

## `synthetic/` (committed)

A hand-authored catalog, clearly marked `"_meta": { "synthetic": true }` in every file.
It is **not** Qloo data and its entity ids are deliberately fake (`ffffffff-…`).

- `localities.json`: cities the search endpoint can resolve (`urn:entity:locality`).
- `tags.json`: tags for `GET /v2/tags` (restaurant and landmark genres and a few more).
- `jp.json`, `us.json`: entities in the two preset worlds (artists, films, TV, places, destinations).
- `world.json`: a generic set of international entities so a person from Madrid or
  Lyon still gets a coherent, if less local, deck.

Entities are written in the shape Qloo returns (`name`, `entity_id`, `type`, `subtype`,
`properties`, `popularity`, `tags`). A `_syn` block carries the authoring hints the
synthetic scorer uses (world, localities, era, explicit relations) and is stripped before
anything is served, so the UI and the agent never see it.

The scorer in `src/lib/qloo/fixtures.ts` mimics the real signals: seed relation
(explicit `_syn.related`, then same world), `signal.location.query`, `filter.tags`,
`filter.release_year.*`, `filter.release_country`, `filter.location.query`,
`filter.exclude.entities`, and an era bonus for `signal.demographics.age`. Results are
sorted by that score and returned as `query.affinity`, with `query.explainability`
when `feature.explainability=true` was requested. It is deterministic.

Replace it with real data by recording: see the README.
