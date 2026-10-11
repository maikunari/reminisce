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

- `localities.json`: the sixty cities the search endpoint resolves (`urn:entity:locality`),
  each with its other names (Ciudad de México, CDMX, Bombay, Pusan, Peking, Maynila…).
- `regions.json`: countries, their regions and their other towns, so a hometown that is not
  a locality still maps to a country and a world ("Puebla, Mexico", "Sheffield", "Pune").
  The search endpoint offers such a town as an inferred locality; the scorer uses its
  country for music, films, TV and trips and gives it no restaurants or landmarks.
- `tags.json`: tags for `GET /v2/tags` (music, media, dining, landmark and destination genres).
- One file per world, each with artists, films, TV, restaurants, landmarks and destinations:
  `jp.json` (Japan), `us.json` (United States), `uk.json` (United Kingdom and Ireland),
  `latam.json` (Mexico, Argentina, Brazil, Colombia, Peru, Cuba, Chile, Uruguay),
  `ph.json` (Philippines), `in.json` (India and Pakistan), `kr.json` (Korea),
  `zh.json` (Hong Kong, Taiwan, mainland China, Singapore).
- `world.json`: international names (The Sound of Music, ABBA, Eurovision, Paris) so a
  person from Madrid or Berlin still gets a coherent, if less local, deck.

Entities are written in the shape Qloo returns (`name`, `entity_id`, `type`, `subtype`,
`properties`, `popularity`, `tags`). A `_syn` block carries the authoring hints the
synthetic scorer uses and is stripped before anything is served, so the UI and the agent
never see it:

- `world`: one world, or several for names shared between worlds (`["uk", "generic"]`
  for The Beatles, `["zh", "jp"]` for Teresa Teng).
- `countries`: ISO codes the entity is specific to; absent means the whole world.
- `localities`: keys from `localities.json` the entity is "in" or belongs to.
- `era`: the years it mattered; `related`: explicit seed affinities; `kind`: dining or landmark.

Every dining entry carries `urn:tag:genre:place:restaurant` and every landmark
`urn:tag:category:place:landmark`, because that is what the planner filters on. Films and
shows carry a `release_year` and a `release_country` written the way the planner asks for
it ("Mexico", "United Kingdom", "South Korea").

The scorer in `src/lib/qloo/fixtures.ts` mimics the real signals: seed relation (explicit
`_syn.related`, then same world and country), the home world (the hometown's world when it
is a locality or can be inferred from `regions.json`, otherwise the world of a regional
favourite; a generic-world or unknown home gets international names only, plus whatever a
favourite explicitly points at), `filter.tags`, `filter.release_year.*`,
`filter.release_country`, `filter.location.query` (a place is only in a town the catalog
lists it under), `filter.exclude.entities`, and an era bonus for
`signal.demographics.age`. Results are sorted by that score and returned as
`query.affinity`, with `query.explainability` when `feature.explainability=true` was
requested. It is deterministic.

The regional files were authored with a small generator (hand-written rows expanded into
the Qloo shape); the JSON here is the source of truth and is edited directly.

Replace it with real data by recording: see the README.
