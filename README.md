# Dreamio Backend

Node/Express backend that matches the iOS app API contract in `AIBackendService`.

## Endpoints

- `GET /health`
- `POST /v1/dreams/title`
- `POST /v1/dreams/analyze`
- `POST /v1/dreams/distill`
- `POST /v1/dreams/interpret`
- `POST /v1/dreams/update-soul`

All endpoints accept/return JSON.

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Set your values in `.env`:
   - `OPENAI_API_KEY`
   - Optional defaults:
     - `OPENAI_MODEL` (fallback, default `gpt-4.1-mini`)
     - `OPENAI_MODEL_TITLE` (default `gpt-4.1-mini`)
     - `OPENAI_MODEL_ANALYZE` (default `gpt-4.1`)
     - `OPENAI_MODEL_INTERPRET` (default `gpt-4.1`)
     - `OPENAI_MODEL_UPDATE_SOUL` (default `gpt-4.1`)
   - Optional: `PORT`
4. Start server:
   ```bash
   npm start
   ```

## iOS app config

Set `AI_BACKEND_BASE_URL` in `DreamioIOS/Secrets.xcconfig`, for example:

```xcconfig
AI_BACKEND_BASE_URL=https://api.your-domain.com
```

Then clean and run the app again.

## Deploy on UltraHost

Use a Node.js app in UltraHost panel:

1. Create a Node.js app (Node 18+).
2. Upload this `backend` folder.
3. Set app startup file: `src/server.js`.
4. Add environment variables in UltraHost panel:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional)
   - `ALLOWED_ORIGIN=*` (or your exact domain)
   - `PORT` (if panel requires one; otherwise UltraHost sets it)
5. Run dependency install (`npm install`) in that app directory.
6. Start/restart app from panel.
7. Map your domain/subdomain (e.g. `api.drimio.app`) to this Node app.

## Quick API smoke tests

```bash
curl http://localhost:8080/health
```

```bash
curl -X POST http://localhost:8080/v1/dreams/title \
  -H "Content-Type: application/json" \
  -d '{"dream":"I was flying above a golden city at sunset."}'
```
