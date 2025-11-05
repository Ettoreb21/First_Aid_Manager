#!/usr/bin/env node

/**
 * Script per generare una guida di configurazione per Render.com
 * Questo script legge le variabili d'ambiente locali e genera
 * una guida dettagliata per configurare il servizio su Render
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Colori per output console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize(title, 'cyan'));
  console.log('='.repeat(60));
}

function printSection(title) {
  console.log('\n' + colorize(title, 'yellow'));
  console.log('-'.repeat(title.length));
}

function printStep(step, description) {
  console.log(`\n${colorize(step + '.', 'green')} ${description}`);
}

function printVariable(name, value, isSecret = false) {
  const displayValue = isSecret ? '***NASCOSTO***' : value;
  console.log(`   ${colorize(name, 'blue')}: ${displayValue}`);
}

function printWarning(message) {
  console.log(`\n${colorize('⚠️  ATTENZIONE:', 'yellow')} ${message}`);
}

function printSuccess(message) {
  console.log(`\n${colorize('✅ SUCCESSO:', 'green')} ${message}`);
}

function printError(message) {
  console.log(`\n${colorize('❌ ERRORE:', 'red')} ${message}`);
}

// Leggi le variabili d'ambiente dal file .env se esiste
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  const envVars = {};
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          envVars[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    }
  }
  
  return envVars;
}

// Genera una chiave di sessione sicura
function generateSessionSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Genera una API key sicura
function generateApiKey() {
  return crypto.randomBytes(16).toString('hex');
}

function main() {
  printHeader('🚀 GUIDA CONFIGURAZIONE RENDER.COM');
  console.log('Questa guida ti aiuterà a configurare il tuo servizio First Aid Manager su Render.com');
  
  // Carica variabili d'ambiente locali
  const envVars = loadEnvFile();
  
  // Genera chiavi se non esistono
  const sessionSecret = envVars.SESSION_SECRET || generateSessionSecret();
  const apiKey = envVars.API_KEY || generateApiKey();
  
  printSection('📋 STEP 1: ACCEDI ALLA DASHBOARD RENDER');
  printStep('1', 'Vai su https://dashboard.render.com');
  printStep('2', 'Accedi al tuo account Render');
  printStep('3', 'Trova il servizio "first-aid-manager" nella lista dei servizi');
  printStep('4', 'Clicca sul nome del servizio per aprire la pagina di dettaglio');
  
  printSection('⚙️ STEP 2: CONFIGURA LE VARIABILI D\'AMBIENTE');
  printStep('1', 'Nella pagina del servizio, clicca sulla tab "Environment"');
  printStep('2', 'Aggiungi le seguenti variabili d\'ambiente:');
  
  console.log('\n' + colorize('🔐 VARIABILI SEGRETE (da tenere private):', 'magenta'));
  printVariable('SESSION_SECRET', sessionSecret, true);
  printVariable('API_KEY', apiKey, true);
  
  if (envVars.BREVO_API_KEY) {
    printVariable('BREVO_API_KEY', envVars.BREVO_API_KEY, true);
  } else {
    printWarning('BREVO_API_KEY non trovata nel file .env locale');
    console.log('   Dovrai ottenerla dalla dashboard Brevo: https://app.brevo.com/settings/keys/api');
  }
  
  console.log('\n' + colorize('🌐 VARIABILI PUBBLICHE:', 'blue'));
  printVariable('NODE_ENV', 'production');
  printVariable('EMAIL_PROVIDER', 'brevo');
  printVariable('BREVO_SENDER_EMAIL', envVars.BREVO_SENDER_EMAIL || 'your-email@domain.com');
  printVariable('BREVO_SENDER_NAME', envVars.BREVO_SENDER_NAME || 'First Aid Manager');
  printVariable('CORS_ORIGINS', 'https://your-github-username.github.io');
  printVariable('COOKIE_SAMESITE', 'None');
  printVariable('COOKIE_SECURE', 'true');
  printVariable('LOG_LEVEL', 'info');
  printVariable('DB_DIALECT', 'sqlite');
  printVariable('DB_SQLITE_PATH', '/opt/render/project/data/database.sqlite');
  
  printSection('💾 STEP 3: CONFIGURA IL DISCO PERSISTENTE');
  printStep('1', 'Nella pagina del servizio, clicca sulla tab "Disks"');
  printStep('2', 'Clicca su "Add Disk"');
  printStep('3', 'Configura il disco con questi parametri:');
  console.log('   • Name: sqlite-data');
  console.log('   • Mount Path: /opt/render/project/data');
  console.log('   • Size: 1 GB (minimo)');
  printStep('4', 'Clicca "Create Disk"');
  
  printSection('🚀 STEP 4: ESEGUI IL DEPLOY');
  printStep('1', 'Torna alla tab "Overview" del servizio');
  printStep('2', 'Clicca su "Manual Deploy" → "Deploy latest commit"');
  printStep('3', 'Attendi che il deploy sia completato (status: "Live")');
  
  printSection('✅ STEP 5: VERIFICA IL DEPLOYMENT');
  printStep('1', 'Una volta che il servizio è "Live", copia l\'URL del servizio');
  printStep('2', 'Testa l\'endpoint di health check:');
  console.log('   curl https://your-service-url.onrender.com/api/health');
  
  printStep('3', 'Testa CORS preflight:');
  console.log('   curl -X OPTIONS https://your-service-url.onrender.com/api/health \\');
  console.log('        -H "Origin: https://your-github-username.github.io" \\');
  console.log('        -H "Access-Control-Request-Method: GET"');
  
  printStep('4', 'Aggiorna il frontend su GitHub Pages con il nuovo URL del backend');
  
  printSection('📝 VALORI GENERATI PER QUESTA SESSIONE');
  console.log('\n' + colorize('Copia questi valori e usali nella configurazione Render:', 'cyan'));
  console.log(`SESSION_SECRET: ${sessionSecret}`);
  console.log(`API_KEY: ${apiKey}`);
  
  if (envVars.BREVO_API_KEY) {
    console.log(`BREVO_API_KEY: ${envVars.BREVO_API_KEY.substring(0, 10)}...`);
  }
  
  printSection('🔗 LINK UTILI');
  console.log('• Dashboard Render: https://dashboard.render.com');
  console.log('• Documentazione Render: https://render.com/docs');
  console.log('• Dashboard Brevo: https://app.brevo.com');
  
  printWarning('Salva le chiavi generate in un posto sicuro!');
  printSuccess('Configurazione completata! Il tuo servizio dovrebbe essere operativo.');
  
  console.log('\n' + '='.repeat(60));
}

if (require.main === module) {
  main();
}

module.exports = { loadEnvFile, generateSessionSecret, generateApiKey };