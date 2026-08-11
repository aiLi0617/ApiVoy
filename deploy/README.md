# ApiVoy private deployment

This deployment runs the complete Web stack behind one Nginx entry point:

- Web UI at `/`
- authenticated Rust execution Agent at `/agent`
- authenticated multi-protocol cloud Gateway at `/gateway`
- Java collaboration/OIDC service at `/collaboration`
- PostgreSQL on the internal Docker network only

Only the Web port is published. Agent SQLite/workspace data, Gateway schedules and PostgreSQL collaboration data use named volumes.

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
- Use independently generated high-entropy values for the database password, bootstrap token, Agent token, and Gateway API key.
- Restrict ingress access: the runtime Agent token is delivered to authenticated users' browsers and should be treated as an internal deployment credential.
- Back up `postgres-data`, `agent-data`, and `gateway-data`; test restore before upgrades.
- For OIDC, register `https://your-host/collaboration/login/oauth2/code/oidc` and complete the optional variables in `.env` after the first organization exists.

## Verify and stop

```bash
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/agent/health
curl --fail http://localhost:8080/collaboration/actuator/health
curl --fail http://localhost:8080/gateway/health
curl --fail -H "Authorization: Bearer $APIVOY_GATEWAY_API_KEY" http://localhost:8080/gateway/v1/capabilities
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

`down` preserves named volumes. Only use `down --volumes` when permanent data deletion is explicitly intended.

## Gateway API

- `POST /gateway/v1/executions` executes one `RequestEnvelope` remotely and returns its complete event stream.
- `POST /gateway/v1/runner/execute` returns a CI-oriented `exitCode`; `failOnAssertion` makes failed assertions return exit code 1.
- `GET/POST /gateway/v1/jobs` and `DELETE /gateway/v1/jobs/{id}` manage persistent interval schedules (minimum 10 seconds).
- `GET /gateway/v1/executions` exposes the latest 500 in-memory summaries; response bodies, logs, extracted variables, and response headers are removed from retained history.

All `/v1` endpoints require `Authorization: Bearer <APIVOY_GATEWAY_API_KEY>`. Scheduled requests are persisted in `gateway-data`; do not embed plaintext credentials in their envelopes. The capability endpoint explicitly describes request routing and retention behavior.
