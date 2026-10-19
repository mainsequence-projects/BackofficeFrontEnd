# Static-site deployment

The root Vite application is declared in
`.mainsequence/workflows/backoffice-site.yaml`, workflow API 3.0.0. The
registered `main` branch belongs to the Production Environment. The file is
scoped to the production role so it cannot apply in an unrelated Environment.

Main Sequence builds with Node 24, installs the root lockfile, runs the build,
and publishes `dist` with SPA fallback to `/index.html`. The master deployment
switch and automatic redeployment are enabled; `tag_regex: null` makes every
push to this branch eligible. No release tag or separate GitHub Actions
deployment job is required. Three release revisions are retained.

The workflow also declares a Back Office navigation link for the requesting
user, with `public/backoffice-icon.svg` as its theme-colored mask and
`app-window` as the fallback icon. It does not publish the link to the whole
Organization or grant site access. `public/favicon.svg` uses the same artwork
in a dark teal tile for the browser tab. The navigation icon is resolved from
the exact pushed commit; keep its path stable and use sanitized basic SVG
geometry without external references.

Before publishing a workflow change, fetch this branch's current
`workflow-template/` and POST the complete file's `path` and `content` to its
`validate-workflow/` action. Continue only with `valid: true`. Run `npm run
build` and `git diff --check`, review the intended files, then commit and push
the tracked branch. Keep `.env` and generated `dist` out of Git.

After pushing, confirm the remote SHA, inspect the branch's workflow runs and
the correlated Static Site DeploymentRun, then check the release's ready active
revision and backend-returned `public_url`. Verify the deployed page and both
SVG assets. Navigation warnings are separate from build/activation success;
check them even when the site deploys. Do not infer success from a push alone.

The artifact contains People, Documents, Document Sets, Reconciliation and the
served `/docs/` guide. `VITE_BACKOFFICE_API_RELEASE_UID` resolves the
`BackofficeBackend` repository's `backoffice_api` resource in the same Environment.
The platform supplies `VITE_COMMAND_CENTER_ORIGIN`. Hosted API access uses the
SDK iframe bridge; a standalone production link displays the unavailable state.
See [the assistant rail plan](assistant-right-rail.md) for the separate Tau milestone.

Deploy the backend's migration Job before its API, then grant the API workload
`data_writer` access to the migrated `backoffice` namespace through MetaTables.
Application startup and readiness never run migrations. Verify API `/readyz`
through the authorized transport before declaring the frontend release usable.
Keep synthetic browser test data in the isolated local SQLite runtime.

The workflow path and resource key own the release identity. Renaming or removing
them can delete the site and recreate its UID/URL. A failed new deployment
leaves the prior ready revision serving. Recover a bad application change with
a reviewed revert committed and pushed through this same workflow; do not
silently roll back database migrations or manually move release tags.
