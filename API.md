# Personal Aierbaer — Local HTTP API

The app runs a local API on **`http://127.0.0.1:4849`** (localhost only, port
configurable in Settings) while it's open, so an external dashboard can drive the
same inbox, reports, and resolutions without rebuilding the ClickUp/pi
integration.

The app pushes its current config (ClickUp token, team, owner, model, repo,
reports dir) into the server, so callers don't send credentials.

**Auth:** every request except `/api/health` needs header
`X-Aierbaer-Token: <token>` (or `Authorization: Bearer <token>`). The token is in
Settings → Local API, with a Regenerate button. CORS is permissive.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check. |
| GET | `/api/inbox` | Tickets + report/resolution status. |
| GET | `/api/report/:id` | Report markdown for a task (or `null`). |
| GET | `/api/resolution/:id` | Parsed resolution (`resolved`, `choice`, `notes`). |
| POST | `/api/solve/:id` | Start a solve in the background → `202`. |
| POST | `/api/resolution/:id` | Set resolution. Body: `{ "choice": "...", "text": "..." }`. |
| DELETE | `/api/resolution/:id` | Remove the resolution. |

### `GET /api/inbox`
```json
{
  "items": [
    {
      "id": "abc123",
      "name": "Onboarding runs into an error",
      "status": "to clarify",
      "statusColor": "#e65100",
      "url": "https://app.clickup.com/t/abc123",
      "list": "2nd Level Support Tickets",
      "tags": ["bug"],
      "dateUpdated": "1699999999999",
      "hasReport": true,
      "resolved": true,
      "choice": "Option B: Resend a new link"
    }
  ]
}
```

### Examples
```bash
curl http://127.0.0.1:4849/api/inbox
curl http://127.0.0.1:4849/api/report/abc123
curl -X POST http://127.0.0.1:4849/api/solve/abc123
curl -X POST http://127.0.0.1:4849/api/resolution/abc123 \
  -H 'content-type: application/json' \
  -d '{"choice":"Option A","text":"Issued a fresh signup secret"}'
curl -X DELETE http://127.0.0.1:4849/api/resolution/abc123
```

## Deep links

From a dashboard or browser, open the app on a specific ticket:

- `aierbaer://open/<taskId>` — focus Aierbaer and select that ticket (shows report).
- `aierbaer://solve/<taskId>` — focus Aierbaer and start a solve.

```bash
open "aierbaer://open/abc123"
```

Notes:
- `/api/solve` streams progress through the app UI (same `pi-output`/`pi-done`
  events); poll `/api/report/:id` for the result.
- Returns `400` until the app has been configured (token present).
- Returns `401` when the `X-Aierbaer-Token` header is missing/wrong.
- Default port `4849`, changeable in Settings → Local API.
