## Auto Deploy (PowerShell)

- Percorso script: `scripts/auto-deploy.ps1`
- Funzioni: clona repo, rileva/crea backend+frontend, installa dipendenze, genera `render.yaml`, pubblica frontend su GitHub Pages e tenta il deploy su Render.

### Uso
- Apri PowerShell nella directory desiderata.
- Esegui: `powershell -ExecutionPolicy Bypass -File .\scripts\auto-deploy.ps1`
- Inserisci l'URL del repository GitHub quando richiesto.

### Requisiti
- `git`, `node`, `npm`
- (opzionali) `render-cli`, `gh-pages`

### Note
- Lo script crea la cartella `project-auto-deploy` e opera al suo interno.
- Se non trova un backend, ne genera uno base con endpoint `GET/HEAD /api/health`.
- Per GitHub Pages, tenta la pubblicazione in `dist`, `build` o direttamente `.`.
- Per Render, verrà creato/aggiornato un servizio con `healthCheckPath: /api/health` e `startCommand: node <backendDir>/server.js`.
- Per cookie/CORS su deployment cross-site (GitHub Pages → Render), imposta su Render:
  - `COOKIE_SAMESITE=none`
  - `COOKIE_SECURE=true`
  - `CORS_ORIGINS=https://<utente>.github.io/First_Aid_Manager,https://first-aid-manager.onrender.com`
  - `SESSION_SECRET=<valore-segreto>`