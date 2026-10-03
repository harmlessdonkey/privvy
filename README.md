# privvy

A privacy monitoring tool. Plugins collect **evidence**, a separate layer (agents or people) writes **results**, and a dashboard controls it all. The first plugin checks which cookies and trackers a site places before and after a visitor's consent choice.

It collects and stores evidence. It does not decide what a failure means.

See [docs/design.md](docs/design.md) for the design, data layout and what is not built yet.

> Early scaffold. The core, login and dashboard are tested. The Docker image and the real collector integration have **not** been run yet.

## Run it

```bash
cp .env.example .env     # set PRIVVY_ADMIN_PASSWORD (12+ chars)
docker compose up --build
```

Open http://localhost:3000 and sign in as `admin`. After the first start, remove `PRIVVY_ADMIN_PASSWORD` from `.env`.

Everything you configure and every piece of evidence lives in `./data`, which is git-ignored. Back it up.

### Without Docker

```bash
npm install
PRIVVY_ADMIN_PASSWORD='a long password here' npm run dev
```

## Using it

1. **Overview** lists plugins, their checks and scopes, the last run and the latest result.
2. **Configure** a plugin: edit its JSON, save. Each save is a new revision and is kept.
3. **Run now** starts a check for a scope. The run folder appears under `data/evidence/...`.
4. Drop analysis into the run's `results/` folder (markdown with front matter, see the design doc). It shows up on the dashboard.

## Develop

```bash
npm test          # node's built-in runner
npm run typecheck
```

Add a plugin: create `src/plugins/<name>/index.ts` exporting a `Plugin`, register it in `src/server/index.ts`.

## Security notes

- Binds to localhost by default and compose publishes on `127.0.0.1` only.
- No default password; the first admin comes from an environment variable.
- Do not commit anything from `data/`. Instance config, targets and evidence stay out of this repo.

## Licence

MIT, see [LICENSE](LICENSE).
