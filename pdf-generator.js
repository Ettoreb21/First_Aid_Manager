// PDF Generator per First Aid Manager - Conforme D.M. 388/2003
// Approccio offline-first con percorsi relativi

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const { pathToFileURL } = require('url');
const PDFDocument = require('pdfkit');

class PDFReportGenerator {
    constructor() {
        this.templatePath = path.join(__dirname, 'templates', 'rapporto_cassette.html');
        this.outputPath = path.join(__dirname, 'output', 'rapporto_cassette.pdf');
        this.configPath = path.join(__dirname, 'config', 'settings.json');
    }

    // Carica configurazione da file JSON
    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                return JSON.parse(configData);
            }
        } catch (error) {
            console.warn('Errore caricamento configurazione:', error.message);
        }
        
        // Configurazione di default
        return {
            report: {
                revisione: "Rev.05",
                logo_path: "",
                template_path: "templates/rapporto_cassette.html",
                output_path: "output/rapporto_cassette.pdf"
            },
            company: {
                name: "ISOKIT Srl",
                address: "",
                default_location: "Sede Principale"
            },
            operatori: [],
            scadenze: {
                soglia_giorni: 90,
                stati_non_idonei: ["Scaduto", "Quarantena", "Richiamo"]
            }
        };
    }

    // Formatta data in italiano
    formatItalianDate(date) {
        const giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
        const mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                     'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
        
        const d = new Date(date);
        const giornoSettimana = giorni[d.getDay()];
        const giorno = d.getDate();
        const mese = mesi[d.getMonth()];
        const anno = d.getFullYear();
        
        return `${giornoSettimana} ${giorno} ${mese} ${anno}`;
    }

    // Calcola stato scadenza
    getExpirationStatus(expiryDate, soglia = 90) {
        if (!expiryDate) return { status: 'N/A', class: 'status-ok' };
        
        const today = new Date();
        const expiry = new Date(expiryDate);
        const diffTime = expiry - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            return { status: 'Scaduto', class: 'status-critical' };
        } else if (diffDays <= soglia) {
            return { status: 'In scadenza', class: 'status-warning' };
        } else {
            return { status: 'OK', class: 'status-ok' };
        }
    }

    // Verifica se un articolo è sotto target
    isUnderTarget(currentQuantity, targetQuantity) {
        return parseInt(currentQuantity) < parseInt(targetQuantity);
    }

    // Calcola percentuale completezza kit
    calculateKitCompleteness(items) {
        if (!items || items.length === 0) return 0;
        
        const completeItems = items.filter(item => 
            !this.isUnderTarget(item.currentQuantity, item.targetQuantity)
        ).length;
        
        return Math.round((completeItems / items.length) * 100);
    }

    // Prepara dati per il template
    prepareTemplateData(kitsData, operatorName, location, operatorSignature, logoPathOverride) {
        const config = this.loadConfig();
        const today = new Date();
        
        // Trova operatore selezionato
        const selectedOperator = config.operatori.find(op => op.nome === operatorName) || 
                                config.operatori[0] || { nome: operatorName, firma_png_path: '', ruolo: 'Operatore' };

        // Risolve e valida percorsi immagini come URL file://
        const transparentPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P8z/D/PwAI/wN5nYVqUAAAAABJRU5ErkJggg==';
        const resolveImageUrl = (p) => {
            if (!p) return null;
            try {
                const abs = path.resolve(p);
                if (!fs.existsSync(abs)) return null;
                return pathToFileURL(abs).href;
            } catch {
                return null;
            }
        };
        const imagePathToDataUrl = (p) => {
            if (!p) return null;
            try {
                const abs = path.resolve(p);
                if (!fs.existsSync(abs)) return null;
                const buf = fs.readFileSync(abs);
                const ext = path.extname(abs).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null);
                if (!mime) return null;
                return `data:${mime};base64,${buf.toString('base64')}`;
            } catch {
                return null;
            }
        };

        const isDataUrlImage = (str) => typeof str === 'string' && /^data:image\/(png|jpe?g);base64,/i.test(str);
        const resolveLogoUrl = (overrideLogo) => {
            if (overrideLogo) {
                if (isDataUrlImage(overrideLogo)) return overrideLogo;
                const asData = imagePathToDataUrl(overrideLogo);
                if (asData) return asData;
                const fromPath = resolveImageUrl(overrideLogo);
                if (fromPath) return fromPath;
            }
            const defData = imagePathToDataUrl(config.report.logo_path);
            if (defData) return defData;
            const defPath = resolveImageUrl(config.report.logo_path);
            return defPath || transparentPng;
        };

        // Risolve la sorgente firma: data URL, percorso file o fallback
        const resolveSignatureUrl = (sig, defaultPath) => {
            if (sig && typeof sig === 'string') {
                const isDataUrl = /^data:image\/(png|jpeg);base64,/i.test(sig);
                if (isDataUrl) return sig;
                const fromPath = resolveImageUrl(sig);
                if (fromPath) return fromPath;
            }
            const def = resolveImageUrl(defaultPath);
            return def || transparentPng;
        };

        // Prepara sezioni kit
        const sezioniKit = kitsData.map(kit => {
            const articoli = kit.items.map(item => {
                const expirationStatus = this.getExpirationStatus(item.expiryDate, config.scadenze.soglia_giorni);
                const isUnderTarget = this.isUnderTarget(item.currentQuantity, item.targetQuantity);
                const isNonIdoneo = config.scadenze.stati_non_idonei.includes(item.status);
                
                return {
                    codice: item.code || item.id || 'N/A',
                    nome: item.name,
                    lotto_seriale: item.batch || item.serial || 'N/A',
                    quantita_attuale: item.currentQuantity || 0,
                    quantita_target: item.targetQuantity || item.minQuantity || 0,
                    stato_scadenza: expirationStatus.status,
                    stato_scadenza_class: expirationStatus.class,
                    sotto_target: isUnderTarget,
                    critical: isNonIdoneo || (expirationStatus.status === 'Scaduto')
                };
            });

            return {
                nome: kit.name,
                ubicazione: kit.location || location,
                percentuale_completezza: this.calculateKitCompleteness(kit.items),
                articoli: articoli
            };
        });

        return {
            LOGO_PATH: resolveLogoUrl(logoPathOverride),
            REVISIONE: config.report.revisione,
            SEDE_UBICAZIONE: location || config.company.default_location,
            DATA_ITALIANA: this.formatItalianDate(today),
            SEZIONI_KIT: sezioniKit,
            NOME_OPERATORE: operatorName,
            RUOLO_OPERATORE: selectedOperator.ruolo || 'Operatore',
            FIRMA_PNG_PATH: resolveSignatureUrl(operatorSignature, selectedOperator.firma_png_path),
            PAGINA_CORRENTE: 1,
            TOTALE_PAGINE: 1
        };
    }

    // Genera PDF
    async generatePDF(kitsData, operatorName, location, progressCallback, operatorSignature, logoPathOverride) {
        try {
            if (progressCallback) progressCallback('Inizializzazione generazione PDF...');
            // Assicura che la cartella output esista
            const outputDir = path.dirname(this.outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            if (progressCallback) progressCallback('Caricamento template...');

            // Carica template HTML
            if (!fs.existsSync(this.templatePath)) {
                throw new Error(`Template non trovato: ${this.templatePath}`);
            }

            const templateContent = fs.readFileSync(this.templatePath, 'utf8');
            const template = Handlebars.compile(templateContent);

            if (progressCallback) progressCallback('Preparazione dati...');

            // Prepara dati per il template
            const templateData = this.prepareTemplateData(kitsData, operatorName, location, operatorSignature, logoPathOverride);

            // Genera HTML finale
            const finalHTML = template(templateData);

            if (progressCallback) progressCallback('Generazione PDF in corso...');

            // Prova Puppeteer, fallback PDFKit
            try {
                const browser = await puppeteer.launch({ 
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.setContent(finalHTML, { waitUntil: 'networkidle0' });

                await page.pdf({
                    path: this.outputPath,
                    format: 'A4',
                    margin: {
                        top: '12mm',
                        right: '12mm',
                        bottom: '12mm',
                        left: '12mm'
                    },
                    printBackground: true,
                    displayHeaderFooter: false
                });

                await browser.close();
            } catch (err) {
                // Fallback minimale con PDFKit
                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const stream = fs.createWriteStream(this.outputPath);
                doc.pipe(stream);

                doc.fontSize(16).text('Rapporto Cassette di Primo Soccorso', { align: 'center' });
                doc.moveDown();
                doc.fontSize(10).text(`Revisione: ${templateData.REVISIONE}`);
                doc.text(`Data: ${templateData.DATA_ITALIANA}`);
                doc.text(`Operatore: ${templateData.NOME_OPERATORE}`);
                doc.text(`Ubicazione: ${templateData.SEDE_UBICAZIONE}`);
                doc.moveDown();

                templateData.SEZIONI_KIT.forEach((kit, i) => {
                    doc.fontSize(12).text(`${i + 1}. ${kit.nome} — Completezza: ${kit.percentuale_completezza}%`);
                    doc.fontSize(10).text(`Ubicazione: ${kit.ubicazione}`);
                    doc.moveDown(0.5);
                });

                doc.end();
                await new Promise((resolve) => stream.on('finish', resolve));
            }

            if (progressCallback) progressCallback(`Completato: ${this.outputPath}`);

            return {
                success: true,
                outputPath: this.outputPath,
                message: 'PDF generato con successo'
            };

        } catch (error) {
            console.error('Errore generazione PDF:', error);
            
            if (progressCallback) progressCallback(`Errore: ${error.message}`);
            
            return {
                success: false,
                error: error.message,
                message: 'Errore durante la generazione del PDF'
            };
        }
    }

    // Metodo di utilità per verificare dipendenze
    static checkDependencies() {
        const requiredPackages = ['puppeteer', 'handlebars'];
        const missing = [];

        for (const pkg of requiredPackages) {
            try {
                require.resolve(pkg);
            } catch (error) {
                missing.push(pkg);
            }
        }

        if (missing.length > 0) {
            console.warn('Dipendenze mancanti:', missing.join(', '));
            console.warn('Installa con: npm install', missing.join(' '));
            return false;
        }

        return true;
    }
}

module.exports = PDFReportGenerator;