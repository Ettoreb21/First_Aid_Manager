// ensure-deps.js - Verifica e installa pacchetti mancanti automaticamente
// Commenti in Italiano per il progetto First Aid Manager

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Lista delle dipendenze critiche per il progetto
const REQUIRED_PACKAGES = [
    "express",
    "cors", 
    "multer",
    "pdf-lib",
    "pdfkit",
    "xlsx",
    "axios",
    "joi",
    "dotenv",
    "handlebars",
    "puppeteer"
];

// Lista delle dipendenze di sviluppo
const DEV_PACKAGES = [
    "nodemon"
];

console.log("[deps] 🔍 Verifica dipendenze First Aid Manager...");

/**
 * Verifica se un pacchetto è installato
 * @param {string} packageName Nome del pacchetto
 * @returns {boolean} True se installato
 */
function isPackageInstalled(packageName) {
    try {
        require.resolve(packageName);
        return true;
    } catch {
        return false;
    }
}

/**
 * Installa un pacchetto npm
 * @param {string} packageName Nome del pacchetto
 * @param {boolean} isDev Se è una dipendenza di sviluppo
 */
function installPackage(packageName, isDev = false) {
    const flag = isDev ? "--save-dev" : "--save";
    const cmd = `npm install ${packageName} ${flag}`;
    
    console.log(`[deps] 📦 Installazione ${packageName}...`);
    
    try {
        execSync(cmd, { stdio: "inherit" });
        console.log(`[deps] ✅ ${packageName} installato con successo`);
        return true;
    } catch (error) {
        console.error(`[deps] ❌ Errore installazione ${packageName}:`, error.message);
        return false;
    }
}

/**
 * Verifica e installa le dipendenze mancanti
 */
function ensureDependencies() {
    let missingPackages = [];
    let missingDevPackages = [];
    
    // Verifica dipendenze principali
    for (const pkg of REQUIRED_PACKAGES) {
        if (!isPackageInstalled(pkg)) {
            missingPackages.push(pkg);
        }
    }
    
    // Verifica dipendenze di sviluppo
    for (const pkg of DEV_PACKAGES) {
        if (!isPackageInstalled(pkg)) {
            missingDevPackages.push(pkg);
        }
    }
    
    // Report stato
    if (missingPackages.length === 0 && missingDevPackages.length === 0) {
        console.log("[deps] ✅ Tutte le dipendenze sono presenti!");
        return true;
    }
    
    console.log(`[deps] ⚠️  Dipendenze mancanti trovate:`);
    if (missingPackages.length > 0) {
        console.log(`[deps]    Principali: ${missingPackages.join(", ")}`);
    }
    if (missingDevPackages.length > 0) {
        console.log(`[deps]    Sviluppo: ${missingDevPackages.join(", ")}`);
    }
    
    // Installa dipendenze mancanti
    let allInstalled = true;
    
    for (const pkg of missingPackages) {
        if (!installPackage(pkg, false)) {
            allInstalled = false;
        }
    }
    
    for (const pkg of missingDevPackages) {
        if (!installPackage(pkg, true)) {
            allInstalled = false;
        }
    }
    
    return allInstalled;
}

/**
 * Verifica la presenza di file critici
 */
function checkCriticalFiles() {
    const criticalFiles = [
        "server.js",
        "package.json",
        "pdf-generator-enhanced.js",
        "brevo-mailer.js"
    ];
    
    console.log("[deps] 📁 Verifica file critici...");
    
    for (const file of criticalFiles) {
        if (!fs.existsSync(path.join(__dirname, file))) {
            console.error(`[deps] ❌ File critico mancante: ${file}`);
            return false;
        }
    }
    
    console.log("[deps] ✅ Tutti i file critici sono presenti");
    return true;
}

/**
 * Verifica la configurazione Node.js
 */
function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    console.log(`[deps] 🟢 Node.js versione: ${nodeVersion}`);
    
    if (majorVersion < 18) {
        console.warn(`[deps] ⚠️  Versione Node.js ${nodeVersion} potrebbe non essere supportata. Raccomandato: >= 18.0.0`);
        return false;
    }
    
    return true;
}

// Esecuzione principale
async function main() {
    console.log("[deps] 🚀 Avvio verifica dipendenze First Aid Manager");
    
    // Verifica versione Node.js
    if (!checkNodeVersion()) {
        console.warn("[deps] ⚠️  Continuando nonostante la versione Node.js non ottimale...");
    }
    
    // Verifica file critici
    if (!checkCriticalFiles()) {
        console.error("[deps] ❌ Verifica file critici fallita");
        process.exit(1);
    }
    
    // Verifica e installa dipendenze
    if (!ensureDependencies()) {
        console.error("[deps] ❌ Alcune dipendenze non sono state installate correttamente");
        process.exit(1);
    }
    
    console.log("[deps] 🎉 Verifica completata con successo!");
    console.log("[deps] 💡 Puoi ora avviare l'applicazione con: npm start");
}

// Esegui solo se chiamato direttamente
if (require.main === module) {
    main().catch(error => {
        console.error("[deps] ❌ Errore durante la verifica:", error.message);
        process.exit(1);
    });
}

module.exports = {
    ensureDependencies,
    checkCriticalFiles,
    checkNodeVersion,
    isPackageInstalled,
    installPackage
};