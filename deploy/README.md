# ApiVoy private deployment

This deployment runs the complete Web stack behind one Nginx entry point:

- Web UI at `/`
- authenticated Rust execution Agent at `/agent`
- Java collaboration/OIDC service at `/collaboration`
- PostgreSQL on the internal Docker network only

Only the Web port is published. Agent SQLite/workspace data and PostgreSQL collaboration data use named volumes.

## Start

```bash
cp deploy/.env.example deploy/.env
# Replace every required value in deploy/.env before continuing.
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up --build -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Open `http://localhost:8080` (or `APIVOY_PUBLIC_ORIGIN`). Bootstrap the first Owner from Team with `APIVOY_BOOTSTRAP_TOKEN`. The browser uses runtime `config.js`, so changing the public paths or Agent token only requires recreating the Web container, not rebuilding its image.

## Production requirements

- Put the Web port behind an HTTPS ingress or load balancer and set `APIVOY_PUBLIC_ORIGIN` to the exact external origin.
- Use independently generated high-entropy values for the database password, bootstrap token, and Agent token.
- Restrict ingress access: the runtime Agent token is delivered to authenticated users' browsers and should be treated as an internal deployment credential.
- Back up both `postgres-data` and `agent-data` volumes; test restore before upgrades.
- For OIDC, register `https://your-host/collaboration/login/oauth2/code/oidc` and complete the optional variables in `.env` after the first organization exists.

## Verify and stop

```bash
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/agent/health
curl --fail http://localhost:8080/collaboration/actuator/health
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

`down` preserves named volumes. Only use `down --volumes` when permanent data deletion is explicitly intended.
