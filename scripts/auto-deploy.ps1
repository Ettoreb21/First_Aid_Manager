<#
  Auto Deploy (PowerShell) – Backend + Frontend
  - Clona il repo GitHub
  - Rileva/crea backend e frontend
  - Installa dipendenze
  - Genera render.yaml per backend
  - Pubblica frontend su GitHub Pages
  - Esegue push su main e tenta il deploy su Render (se CLI presente)

  Uso:
    powershell -ExecutionPolicy Bypass -File .\scripts\auto-deploy.ps1
    # verrà richiesto l'URL del repository GitHub

  Requisiti:
    - Git, Node.js, npm
    - CLI opzionali: render-cli, gh-pages
    - Accesso push al repository remoto
#>

param(
  [string]$RepoUrl
)

function Write-Step($msg) {
  Write-Host $msg -ForegroundColor Cyan
}

function Write-Info($msg) {
  Write-Host $msg -ForegroundColor Yellow
}

function Write-Ok($msg) {
  Write-Host $msg -ForegroundColor Green
}

if (-not $RepoUrl) {
  $RepoUrl = Read-Host "👉 Inserisci l'URL del repository GitHub"
}

if (-not $RepoUrl -or $RepoUrl.Trim().Length -eq 0) {
  Write-Error "URL repository non valido. Interrompo."
  exit 1
}

Write-Step "🔍 Analisi e setup automatico per deploy backend + frontend..."

# 1) Clona progetto
Write-Step "📥 Clono il repository..."
git clone $RepoUrl project-auto-deploy
if ($LASTEXITCODE -ne 0) { Write-Error "Errore nel clone del repository."; exit 1 }
Set-Location project-auto-deploy
Write-Ok "📁 Repository clonato con successo."

# 2) Rilevamento automatico backend
$backendDir = $null
if (Test-Path -Path "backend" -PathType Container) {
  $backendDir = "backend"
} elseif (Test-Path -Path "server.js" -PathType Leaf -ErrorAction SilentlyContinue -or (Test-Path -Path "app.js" -PathType Leaf -ErrorAction SilentlyContinue)) {
  $backendDir = "."
}

if (-not $backendDir) {
  Write-Info "⚠️ Nessun backend rilevato. Ne creo uno base..."
  New-Item -ItemType Directory -Path "backend" | Out-Null
  Set-Location "backend"
  npm init -y | Out-Null
  npm install express cors dotenv | Out-Null
  @'
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.head('/api/health', (req, res) => res.status(200).end());
app.get('/api/health', (req, res) => res.status(200).send({ status: 'ok', timestamp: Date.now() }));
app.get("/", (req, res) => res.send("Backend online ✅"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server attivo su porta ${port}`));
'@ | Set-Content -Path "server.js" -Encoding UTF8
  Set-Location ..
  $backendDir = "backend"
}

Write-Ok "✅ Backend rilevato in: $backendDir"

# 2) Rilevamento automatico frontend
$frontendDir = $null
if (Test-Path -Path "frontend" -PathType Container) {
  $frontendDir = "frontend"
} elseif (Test-Path -Path "index.html" -PathType Leaf -ErrorAction SilentlyContinue -or (Test-Path -Path "public" -PathType Container -ErrorAction SilentlyContinue)) {
  $frontendDir = "."
}

if (-not $frontendDir) {
  Write-Info "⚠️ Nessun frontend trovato — ne creo uno base..."
  New-Item -ItemType Directory -Path "frontend" | Out-Null
  Set-Location "frontend"
  npm init -y | Out-Null
  npm install vite | Out-Null
  @'
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Frontend Online ✅</title>
  </head>
  <body>
    <h1>Frontend pronto su GitHub Pages</h1>
    <p>Avviare build con Vite e pubblicare con gh-pages.</p>
  </body>
</html>
'@ | Set-Content -Path "index.html" -Encoding UTF8

  if (-not (Test-Path -Path "vite.config.js")) {
    @'
export default {
  base: '',
}
'@ | Set-Content -Path "vite.config.js" -Encoding UTF8
  }

  Set-Location ..
  $frontendDir = "frontend"
}

Write-Ok "✅ Frontend rilevato in: $frontendDir"

# 3) Installazione dipendenze
Write-Step "⚙️ Installazione dipendenze backend..."
Push-Location $backendDir
try { npm install | Out-Null } catch { Write-Info "ℹ️ Nessuna dipendenza backend specificata o già installata" }
Pop-Location

Write-Step "⚙️ Installazione dipendenze frontend..."
Push-Location $frontendDir
try { npm install | Out-Null } catch { Write-Info "ℹ️ Nessuna dipendenza frontend specificata" }
Pop-Location

# 4) Configurazione Render per backend
Write-Step "🧱 Creazione file render.yaml..."
@"
services:
  - type: web
    name: node-backend
    env: node
    buildCommand: "npm install"
    startCommand: "node $backendDir/server.js"
    plan: free
    autoDeploy: true
    healthCheckPath: "/api/health"
"@ | Set-Content -Path "render.yaml" -Encoding UTF8

# 5) Setup GitHub Pages per frontend
Write-Step "🌐 Setup GitHub Pages per frontend..."
Push-Location $frontendDir
if (-not (Test-Path -Path "package.json")) { npm init -y | Out-Null }
npm install gh-pages --save-dev | Out-Null

# Tenta pubblicazione nelle directory comuni
if (Test-Path -Path "dist" -PathType Container) {
  npx gh-pages -d dist
} elseif (Test-Path -Path "build" -PathType Container) {
  npx gh-pages -d build
} else {
  npx gh-pages -d .
}
Pop-Location

# 6) Push su GitHub
Write-Step "📤 Push su GitHub..."
git add .
git commit -m "Deploy automatico - frontend+backend" --allow-empty
git branch -M main
git push origin main

# 7) Deploy automatico backend su Render
Write-Step "🚀 Deploy automatico backend su Render..."
if (Get-Command render -ErrorAction SilentlyContinue) {
  try {
    render services deploy node-backend
  } catch {
    Write-Info "⚠️ Verifica manuale necessaria su dashboard Render."
  }
} else {
  Write-Info "ℹ️ CLI Render non trovata — effettua il deploy manuale su https://render.com"
}

Write-Ok "🎉 Deploy completato!"
Write-Ok "➡️ Backend su Render pronto al deploy automatico."
Write-Ok "➡️ Frontend pubblicato su GitHub Pages."