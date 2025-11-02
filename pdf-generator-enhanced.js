/**
 * Enhanced PDF Generator per First Aid Manager
 * Integra con Java ReportGenerator e gestisce tutte le funzionalità richieste
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class EnhancedPDFGenerator {
    constructor() {
        this.settingsPath = path.join(__dirname, 'config', 'settings.json');
        this.logPath = path.join(__dirname, 'logs', 'rapporti.log');
        this.settings = null;
    }

    // Trova l'eseguibile Java su Windows con fallback
    async findJavaExecutable() {
        // 1) JAVA_HOME
        const javaHome = process.env.JAVA_HOME;
        if (javaHome) {
            const candidate = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
            try { await fs.access(candidate); return candidate; } catch {}
        }

        // 2) Eclipse Adoptium (Temurin)
        const adoptiumBase = process.platform === 'win32' ? 'C\\\\Program Files\\\\Eclipse Adoptium' : '/usr/lib/jvm';
        try {
            const dirs = await fs.readdir(adoptiumBase);
            const jdkDirs = dirs.filter(d => d.toLowerCase().startsWith('jdk'));
            // ordina per nome decrescente per scegliere l'ultimo
            jdkDirs.sort((a,b) => a < b ? 1 : -1);
            for (const d of jdkDirs) {
                const candidate = path.join(adoptiumBase, d, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                try { await fs.access(candidate); return candidate; } catch {}
            }
        } catch {}

        // 2b) Tentativo diretto su percorso Temurin 17
        if (process.platform === 'win32') {
            const directCandidate = 'C\\\\Program Files\\\\Eclipse Adoptium\\\\jdk-17.0.16.8-hotspot\\\\bin\\\\java.exe';
            try { await fs.access(directCandidate); return directCandidate; } catch {}
        }

        // 3) Program Files\\Java
        if (process.platform === 'win32') {
            const javaBase = 'C\\\\Program Files\\\\Java';
            try {
                const dirs = await fs.readdir(javaBase);
                const jdkDirs = dirs.filter(d => d.toLowerCase().startsWith('jdk'));
                jdkDirs.sort((a,b) => a < b ? 1 : -1);
                for (const d of jdkDirs) {
                    const candidate = path.join(javaBase, d, 'bin', 'java.exe');
                    try { await fs.access(candidate); return candidate; } catch {}
                }
            } catch {}
        }

        // 4) Fallback al comando 'java' nella PATH
        return 'java';
    }

    /**
     * Carica le impostazioni dal file di configurazione
     */
    async loadSettings() {
        try {
            const settingsData = await fs.readFile(this.settingsPath, 'utf8');
            this.settings = JSON.parse(settingsData);
            return this.settings;
        } catch (error) {
            throw new Error(`Errore nel caricamento delle impostazioni: ${error.message}`);
        }
    }

    /**
     * Salva le impostazioni nel file di configurazione
     */
    async saveSettings(newSettings) {
        try {
            await fs.writeFile(this.settingsPath, JSON.stringify(newSettings, null, 2));
            this.settings = newSettings;
        } catch (error) {
            throw new Error(`Errore nel salvataggio delle impostazioni: ${error.message}`);
        }
    }

    /**
     * Scrive un evento nel log dei rapporti
     */
    async writeLog(message, operatore = 'Sistema', esito = 'SUCCESS') {
        try {
            const timestamp = new Date().toLocaleString('it-IT', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            const logEntry = `[${timestamp}] ${operatore} - ${esito}: ${message}\n`;
            
            // Assicurati che la directory logs esista
            const logDir = path.dirname(this.logPath);
            await fs.mkdir(logDir, { recursive: true });
            
            await fs.appendFile(this.logPath, logEntry);
        } catch (error) {
            console.error('Errore nella scrittura del log:', error);
        }
    }

    // Riconosce un data URL immagine (png/jpg)
    isDataUrlImage(str) {
        return typeof str === 'string' && /^data:image\/(png|jpe?g);base64,/.test(str);
    }

    // Salva un'immagine data URL come file temporaneo e restituisce il percorso
    async saveDataUrlImage(dataUrl, filenamePrefix = 'image') {
        const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
        if (!match) throw new Error('Formato data URL immagine non valido');
        const ext = match[1].startsWith('jp') ? 'jpg' : 'png';
        const base64 = match[2];
        const buffer = Buffer.from(base64, 'base64');
        const tempDir = path.join(__dirname, 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        const filename = `${filenamePrefix}_${Date.now()}.${ext}`;
        const outPath = path.join(tempDir, filename);
        await fs.writeFile(outPath, buffer);
        return outPath;
    }

    /**
     * Cerca automaticamente la firma dell'operatore
     */
    async findOperatorSignature(operatoreName) {
        if (!this.settings) {
            await this.loadSettings();
        }

        const firmaDir = this.settings.report.firma_dir || 'assets/firme';
        const firmaPath = path.join(__dirname, firmaDir);
        
        try {
            // Normalizza il nome operatore per la ricerca file
            const normalizedName = operatoreName.toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '');
            
            const files = await fs.readdir(firmaPath);
            
            // Cerca file PNG con nome simile (case-insensitive)
            const signatureFile = files.find(file => {
                const fileName = file.toLowerCase();
                return fileName.includes(normalizedName) && fileName.endsWith('.png');
            });
            
            if (signatureFile) {
                const fullPath = path.join(firmaPath, signatureFile);
                await this.writeLog(`Firma trovata per ${operatoreName}: ${signatureFile}`, operatoreName, 'INFO');
                return fullPath;
            } else {
                await this.writeLog(`Firma non trovata per ${operatoreName} in ${firmaDir}`, operatoreName, 'WARNING');
                return null;
            }
        } catch (error) {
            await this.writeLog(`Errore nella ricerca firma per ${operatoreName}: ${error.message}`, operatoreName, 'ERROR');
            return null;
        }
    }

    /**
     * Genera il nome file con timestamp
     */
    generateFileName() {
        const now = new Date();
        const timestamp = now.toISOString()
            .replace(/T/, '_')
            .replace(/:/g, '')
            .replace(/\..+/, '')
            .substring(0, 13); // YYYYMMDD_HHmm
        
        return `rapporto_cassette_${timestamp}.pdf`;
    }

    /**
     * Formatta la data secondo le impostazioni
     */
    formatDate(date, longFormat = null) {
        if (!this.settings) {
            throw new Error('Impostazioni non caricate');
        }

        const useLongFormat = longFormat !== null ? longFormat : this.settings.report.date_long_format;
        
        if (useLongFormat) {
            return date.toLocaleDateString('it-IT', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } else {
            return date.toLocaleDateString('it-IT', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        }
    }

    /**
     * Genera il rapporto PDF utilizzando il Java ReportGenerator
     */
    /**
     * Genera un rapporto PDF con il nuovo contratto API
     * @param {Object} reportData - Dati del report nel nuovo formato
     * @returns {Promise<Object>} - Risultato con outputPath e warnings
     */
    async generateReport(reportData) {
        try {
            // Supporta sia il nuovo formato che quello legacy
            let operatoreName, kitsData, sede, dateLongFormat, thresholdDays, revision, logoPath;
            
            if (typeof reportData === 'string') {
                // Formato legacy: generateReport(operatoreName, kitsData, sede)
                operatoreName = arguments[0];
                kitsData = arguments[1];
                sede = arguments[2];
                dateLongFormat = false;
                thresholdDays = 90;
                revision = 'Rev.01';
                logoPath = null;
            } else {
                // Nuovo formato oggetto
                operatoreName = reportData.operator;
                kitsData = reportData.kits;
                sede = reportData.location;
                dateLongFormat = reportData.dateLongFormat || false;
                thresholdDays = reportData.thresholdDays || 90;
                revision = reportData.revision || 'Rev.01';
                logoPath = reportData.logoPath;
            }
            
            await this.loadSettings();
            
            const startTime = Date.now();
            await this.writeLog(`Inizio generazione rapporto per operatore: ${operatoreName}`, operatoreName, 'INFO');

            // Genera nome file con timestamp
            const fileName = this.generateFileName();
            const reportDir = path.join(__dirname, 'report');
            await fs.mkdir(reportDir, { recursive: true });
            const outputPath = path.join(reportDir, fileName);

            // Cerca firma operatore - usa quella caricata se disponibile
            let signaturePath;
            let tempSignaturePath = null;
            if (reportData.operatorSignature) {
                if (this.isDataUrlImage(reportData.operatorSignature)) {
                    signaturePath = await this.saveDataUrlImage(reportData.operatorSignature, 'firma');
                    tempSignaturePath = signaturePath;
                    await this.writeLog(`Firma caricata come data URL; salvata in ${signaturePath}`, operatoreName, 'INFO');
                } else {
                    // Normalizza percorso firma e verifica esistenza
                    let candidatePath = reportData.operatorSignature;
                    if (!path.isAbsolute(candidatePath)) {
                        candidatePath = path.join(__dirname, candidatePath);
                    }
                    try {
                        await fs.access(candidatePath);
                        signaturePath = candidatePath;
                        await this.writeLog(`Usando firma caricata per ${operatoreName}`, operatoreName, 'INFO');
                    } catch {
                        await this.writeLog(`Firma caricata non trovata: ${candidatePath}`, operatoreName, 'WARNING');
                        // Fallback al metodo tradizionale
                        signaturePath = await this.findOperatorSignature(operatoreName);
                    }
                }
            } else {
                // Fallback al metodo tradizionale di ricerca file
                signaturePath = await this.findOperatorSignature(operatoreName);
            }

            // Prepara parametri per Java
            let finalLogoPath;
            let tempLogoPath = null;
            if (logoPath && this.isDataUrlImage(logoPath)) {
                finalLogoPath = await this.saveDataUrlImage(logoPath, 'logo');
                tempLogoPath = finalLogoPath;
                await this.writeLog(`Logo fornito come data URL; salvato in ${finalLogoPath}`, operatoreName, 'INFO');
            } else if (logoPath) {
                // Normalizza percorso logo fornito
                let candidateLogo = logoPath;
                if (!path.isAbsolute(candidateLogo)) {
                    candidateLogo = path.join(__dirname, candidateLogo);
                }
                try {
                    await fs.access(candidateLogo);
                    finalLogoPath = candidateLogo;
                    await this.writeLog(`Usando logo fornito: ${finalLogoPath}`, operatoreName, 'INFO');
                } catch {
                    await this.writeLog(`Logo specificato non trovato: ${candidateLogo}. Uso default`, operatoreName, 'WARNING');
                    finalLogoPath = this.settings.report.logo_path ? 
                        path.join(__dirname, this.settings.report.logo_path) : '';
                }
            } else {
                finalLogoPath = this.settings.report.logo_path ? 
                    path.join(__dirname, this.settings.report.logo_path) : '';
            }
            
            const sedeFinale = sede || this.settings.company.default_location || 'ISOKIT Srl';
            const revisioneFinale = revision || this.settings.report.revisione || 'Rev.01';

            // Crea file temporaneo con i dati dei kit in formato JSON
            const tempDataPath = path.join(__dirname, 'temp_kits_data.json');
            await fs.writeFile(tempDataPath, JSON.stringify(kitsData, null, 2));

            // Converti i dati dei kit nel formato stringa che si aspetta il Java
            const kitStrings = kitsData.map(kit => {
                return kit.articoli ? kit.articoli.map(art => 
                    `${kit.codice || 'UNKNOWN'},${kit.ubicazione || ''},${art.codice || ''},${art.descrizione || ''},${art.quantita || 0},${art.scadenza || ''},${art.stato || ''}`
                ).join(';') : '';
            }).filter(str => str).join('|');

            return new Promise((resolve, reject) => {
                // Esegui il generatore Java con i parametri corretti
                const cp = ['lib/*', '.'].join(path.delimiter);
                const javaArgs = [
                    '-cp', cp,
                    'ReportGenerator',
                    operatoreName,
                    kitStrings,
                    sedeFinale,
                    revisioneFinale,
                    signaturePath || '',
                    finalLogoPath || ''
                ];

                // Usa un eseguibile Java risolto dinamicamente
                (async () => {
                    const javaCmd = await this.findJavaExecutable();
                    await this.writeLog(`Eseguibile Java selezionato: ${javaCmd}`, operatoreName, 'INFO');
                    const javaProcess = spawn(javaCmd, javaArgs, { cwd: __dirname });

                    let javaOutput = '';
                    let javaError = '';

                    javaProcess.stdout.on('data', (data) => {
                        javaOutput += data.toString();
                    });

                    javaProcess.stderr.on('data', (data) => {
                        javaError += data.toString();
                    });

                    javaProcess.on('close', async (code) => {
                        try {
                            // Rimuovi file temporaneo se esiste
                            try {
                                await fs.unlink(tempDataPath);
                            } catch (e) {
                                // Ignora errori di cancellazione file temporaneo
                            }
                            // Pulisci eventuali file immagine temporanei
                            try { if (tempSignaturePath) await fs.unlink(tempSignaturePath); } catch (e) {}
                            try { if (tempLogoPath) await fs.unlink(tempLogoPath); } catch (e) {}

                            if (code === 0) {
                                // Il Java genera il PDF nella directory corrente con nome fisso
                                // Trova il PDF generato nelle possibili directory
                                const candidates = [
                                    path.join(__dirname, 'rapporto_cassette.pdf'),
                                    path.join(__dirname, 'output', 'rapporto_cassette.pdf'),
                                    path.join(__dirname, 'reports', 'output', 'rapporto_cassette.pdf')
                                ];
                                let generatedPdfPath = null;
                                for (const cand of candidates) {
                                    // eslint-disable-next-line no-await-in-loop
                                    const exists = await fs.access(cand).then(() => true).catch(() => false);
                                    if (exists) { generatedPdfPath = cand; break; }
                                }

                                if (generatedPdfPath) {
                                    await fs.rename(generatedPdfPath, outputPath);
                                    
                                    const duration = Date.now() - startTime;
                                    await this.writeLog(`Rapporto generato con successo: ${fileName} (${duration}ms)`, operatoreName, 'SUCCESS');
                                    
                                    resolve({
                                        success: true,
                                        fileName: fileName,
                                        outputPath: `./report/${fileName}`,
                                        fullPath: outputPath,
                                        message: 'PDF generato con successo',
                                        duration: duration
                                    });
                                } else {
                                    throw new Error('PDF non trovato dopo la generazione');
                                }
                            } else {
                                throw new Error(`Processo Java terminato con codice: ${code}\nOutput: ${javaOutput}\nError: ${javaError}`);
                            }
                        } catch (error) {
                            await this.writeLog(`Errore generazione rapporto: ${error.message}`, operatoreName, 'ERROR');
                            reject(error);
                        }
                    });

                    javaProcess.on('error', async (error) => {
                        await this.writeLog(
                            `Errore nell'avvio processo Java: ${error.message}`,
                            operatoreName,
                            'ERROR'
                        );
                        // Pulisci eventuali file immagine temporanei
                        try { if (tempSignaturePath) await fs.unlink(tempSignaturePath); } catch (e) {}
                        try { if (tempLogoPath) await fs.unlink(tempLogoPath); } catch (e) {}
                        reject(error);
                    });
                })();
            });

        } catch (error) {
            await this.writeLog(
                `Errore generale nella generazione rapporto: ${error.message}`, 
                operatoreName, 
                'ERROR'
            );
            throw error;
        }
    }

    /**
     * Ottieni le impostazioni correnti
     */
    async getSettings() {
        if (!this.settings) {
            await this.loadSettings();
        }
        return this.settings;
    }

    /**
     * Aggiorna una specifica impostazione
     */
    async updateSetting(section, key, value) {
        if (!this.settings) {
            await this.loadSettings();
        }

        if (!this.settings[section]) {
            this.settings[section] = {};
        }

        this.settings[section][key] = value;
        await this.saveSettings(this.settings);
        
        await this.writeLog(`Impostazione aggiornata: ${section}.${key} = ${value}`, 'Sistema', 'INFO');
    }
}

module.exports = EnhancedPDFGenerator;