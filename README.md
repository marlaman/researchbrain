# Research Brain

Create a topic → run `topic-research.pipe` via Rocket Ride (local) or Butterbase cloud function (production) → save sources to Butterbase.

## Local dev

1. Copy `.env.example` → `.env.local` and fill in Butterbase + Rocket Ride values.
2. Open `topic-research.pipe` in Cursor and **Run** until chat is available.
3. `npm install && npm run dev` → http://localhost:5173
4. Click **New Topic**.

Local dev calls `POST /api/run-initial-research` → `scripts/rocketride_run.py` → your running Rocket Ride engine.

## Production

```bash
npm run functions:deploy   # cloud function for research
npm run deploy -- --app YOUR_APP_ID
```

## Schema / seed

```bash
npm run schema:push
npm run seed
```
