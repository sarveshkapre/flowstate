# Migration Discipline

Flowstate stores state in JSON databases during current development stages:

- `db.json` for v1 surfaces
- `db.v2.json` for v2 control-plane surfaces

## Migration Rules

1. Never remove existing fields used by prior versions.
2. Additive schema changes only for in-flight milestones.
3. On read, backfill missing fields with deterministic defaults.
4. Write canonical shape after successful mutation.
5. Keep v1 endpoints operational while introducing v2.

## Current Compatibility Strategy

- v1 APIs remain unchanged.
- v2 APIs use dedicated records and routes under `/api/v2/*`.
- Existing local data in `.flowstate-data/` remains valid.

## Future Transition

When moving to managed database:

1. Introduce SQL schema with migration files.
2. Build one-time importer from `db.v2.json`.
3. Run dual-write period with verification jobs.
4. Cut over reads after consistency thresholds are met.
