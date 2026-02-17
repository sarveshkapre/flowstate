# Environment Profiles

Flowstate uses explicit environment profiles for safer SaaS rollout.

## Profiles

- `local`
- `staging`
- `prod`

Set with:

- `FLOWSTATE_ENV_PROFILE=local|staging|prod`

## Baseline Defaults

- local:
  - `FLOWSTATE_AUTH_MODE=optional`
  - `FLOWSTATE_MAGIC_LINK_EXPOSE_TOKEN=true`
- staging:
  - `FLOWSTATE_AUTH_MODE=strict`
  - `FLOWSTATE_MAGIC_LINK_EXPOSE_TOKEN=false`
- prod:
  - `FLOWSTATE_AUTH_MODE=strict`
  - `FLOWSTATE_MAGIC_LINK_EXPOSE_TOKEN=false`

## Notes

- `optional` auth mode preserves developer velocity in local mode.
- `strict` mode requires bearer API keys for protected v2 endpoints.
- Use profile-specific `.env` management in deployment tooling.
