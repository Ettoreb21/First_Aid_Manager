// test-self-check.js - Self-test end-to-end per First Aid Manager
// Verifica correzione errori 405 e risposte vuote

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TEST_TIMEOUT = 30000; // 30 secondi

// Colori per output console
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

/**
 * Logger colorato per i test
 */
class TestLogger {
    static info(message) {
        console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
    }
    
    static success(message) {
        console.log(`${colors.green}[PASS]${colors.reset} ${message}`);
    }
    
    static error(message) {
        console.log(`${colors.red}[FAIL]${colors.reset} ${message}`);
    }
    
    static warning(message) {
        console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
    }
    
    static header(message) {
        console.log(`\n${colors.bold}${colors.blue}=== ${message} ===${colors.reset}`);
    }
}

/**
 * Classe per i test end-to-end
 */
class SelfTestRunner {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }
    
    /**
     * Esegue un singolo test
     */
    async runTest(testName, testFunction) {
        this.results.total++;
        TestLogger.info(`Esecuzione test: ${testName}`);
        
        try {
            await testFunction();
            this.results.passed++;
            TestLogger.success(`${testName} - PASSATO`);
            return true;
        } catch (error) {
            this.results.failed++;
            this.results.errors.push({ test: testName, error: error.message });
            TestLogger.error(`${testName} - FALLITO: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Test 1: Verifica server attivo
     */
    async testServerHealth() {
        const response = await axios.get(`${BASE_URL}/`, { timeout: 5000 });
        
        if (response.status !== 200) {
            throw new Error(`Server non risponde correttamente. Status: ${response.status}`);
        }
        
        if (!response.data || typeof response.data !== 'string') {
            throw new Error('Risposta server vuota o non valida');
        }
    }
    
    /**
     * Test 2: Verifica correzione errore 405 su GET /report/generate
     */
    async testReportGenerateGET() {
        const response = await axios.get(`${BASE_URL}/report/generate`, {
            headers: { 'Accept': 'application/json' },
            timeout: 5000
        });
        
        if (response.status !== 200) {
            throw new Error(`GET /report/generate dovrebbe restituire 200, ricevuto: ${response.status}`);
        }
        
        const data = response.data;
        if (!data || data.status !== 'info') {
            throw new Error('Risposta GET /report/generate non contiene informazioni corrette');
        }
        
        if (!data.usage || !data.usage.method || data.usage.method !== 'POST') {
            throw new Error('Informazioni usage mancanti o incorrette');
        }
        
        if (!data.traceId) {
            throw new Error('TraceId mancante nella risposta');
        }
    }
    
    /**
     * Test 3: Verifica correzione errore 405 su GET /generate-pdf
     */
    async testGeneratePdfGET() {
        const response = await axios.get(`${BASE_URL}/generate-pdf`, {
            headers: { 'Accept': 'application/json' },
            timeout: 5000
        });
        
        if (response.status !== 200) {
            throw new Error(`GET /generate-pdf dovrebbe restituire 200, ricevuto: ${response.status}`);
        }
        
        const data = response.data;
        if (!data || data.status !== 'info') {
            throw new Error('Risposta GET /generate-pdf non contiene informazioni corrette');
        }
        
        if (!data.usage || !data.usage.preferredEndpoint) {
            throw new Error('Informazioni endpoint preferito mancanti');
        }
    }
    
    /**
     * Test 4: Verifica metodo non supportato restituisce 405 strutturato
     */
    async testUnsupportedMethod() {
        try {
            await axios.put(`${BASE_URL}/report/generate`, {}, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });
            throw new Error('PUT dovrebbe restituire 405');
        } catch (error) {
            if (error.response && error.response.status === 405) {
                const data = error.response.data;
                if (!data || data.status !== 'error' || data.code !== 'METHOD_NOT_ALLOWED') {
                    throw new Error('Risposta 405 non strutturata correttamente');
                }
                if (!data.allowed || !Array.isArray(data.allowed)) {
                    throw new Error('Campo allowed mancante o non array');
                }
                if (!data.traceId) {
                    throw new Error('TraceId mancante nella risposta 405');
                }
            } else {
                throw new Error(`Errore inaspettato: ${error.message}`);
            }
        }
    }
    
    /**
     * Test 5: Verifica POST con dati invalidi restituisce errore strutturato
     */
    async testInvalidPostData() {
        try {
            await axios.post(`${BASE_URL}/report/generate`, {
                invalid: 'data'
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });
            throw new Error('POST con dati invalidi dovrebbe restituire errore');
        } catch (error) {
            if (error.response && error.response.status === 400) {
                const data = error.response.data;
                if (!data || data.status !== 'error') {
                    throw new Error('Risposta errore non strutturata correttamente');
                }
                if (!data.traceId) {
                    throw new Error('TraceId mancante nella risposta errore');
                }
            } else {
                throw new Error(`Status code inaspettato: ${error.response?.status || 'unknown'}`);
            }
        }
    }
    
    /**
     * Test 6: Verifica CORS headers
     */
    async testCorsHeaders() {
        const response = await axios.options(`${BASE_URL}/report/generate`, {
            headers: {
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'POST'
            },
            timeout: 5000
        });
        
        if (response.status !== 200 && response.status !== 204) {
            throw new Error(`OPTIONS dovrebbe restituire 200/204, ricevuto: ${response.status}`);
        }
        
        const headers = response.headers;
        if (!headers['access-control-allow-methods']) {
            throw new Error('Header Access-Control-Allow-Methods mancante');
        }
        
        const allowedMethods = headers['access-control-allow-methods'];
        if (!allowedMethods.includes('POST')) {
            throw new Error('POST non incluso nei metodi CORS consentiti');
        }
    }
    
    /**
     * Test 7: Verifica generazione PDF con dati validi
     */
    async testValidPdfGeneration() {
        const testData = {
            operatore: "Test Operator",
            location: "Test Location",
            kits: [{
                codice: "KIT001",
                ubicazione: "Test Location",
                articoli: [{
                    codice: "ART001",
                    descrizione: "Test Article",
                    quantita: 1,
                    scadenza: "2025-12-31",
                    stato: "idoneo"
                }]
            }]
        };
        
        const response = await axios.post(`${BASE_URL}/report/generate`, testData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: TEST_TIMEOUT
        });
        
        if (response.status !== 200) {
            throw new Error(`Generazione PDF fallita. Status: ${response.status}`);
        }
        
        const data = response.data;
        if (!data || data.status !== 'success') {
            throw new Error('Risposta generazione PDF non indica successo');
        }
        
        if (!data.data || !data.data.fileName || !data.data.downloadUrl) {
            throw new Error('Dati risposta PDF incompleti');
        }
        
        if (!data.traceId) {
            throw new Error('TraceId mancante nella risposta successo');
        }
        
        // Verifica che il file sia stato creato
        const reportDir = path.join(__dirname, 'report');
        if (!fs.existsSync(reportDir)) {
            throw new Error('Directory report non creata');
        }
        
        const files = fs.readdirSync(reportDir);
        const pdfFiles = files.filter(f => f.endsWith('.pdf'));
        if (pdfFiles.length === 0) {
            throw new Error('Nessun file PDF generato');
        }
    }
    
    /**
     * Esegue tutti i test
     */
    async runAllTests() {
        TestLogger.header('AVVIO SELF-TEST FIRST AID MANAGER');
        TestLogger.info(`Target server: ${BASE_URL}`);
        TestLogger.info(`Timeout test: ${TEST_TIMEOUT}ms`);
        
        // Lista dei test da eseguire
        const tests = [
            ['Server Health Check', () => this.testServerHealth()],
            ['GET /report/generate (correzione 405)', () => this.testReportGenerateGET()],
            ['GET /generate-pdf (correzione 405)', () => this.testGeneratePdfGET()],
            ['Metodo non supportato (405 strutturato)', () => this.testUnsupportedMethod()],
            ['POST dati invalidi (errore strutturato)', () => this.testInvalidPostData()],
            ['CORS Headers', () => this.testCorsHeaders()],
            ['Generazione PDF valida', () => this.testValidPdfGeneration()]
        ];
        
        // Esegui tutti i test
        for (const [name, testFn] of tests) {
            await this.runTest(name, testFn);
            // Pausa breve tra i test
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Report finale
        this.printFinalReport();
    }
    
    /**
     * Stampa il report finale
     */
    printFinalReport() {
        TestLogger.header('REPORT FINALE');
        
        console.log(`${colors.bold}Test totali:${colors.reset} ${this.results.total}`);
        console.log(`${colors.green}${colors.bold}Passati:${colors.reset} ${this.results.passed}`);
        console.log(`${colors.red}${colors.bold}Falliti:${colors.reset} ${this.results.failed}`);
        
        if (this.results.failed > 0) {
            TestLogger.header('ERRORI RILEVATI');
            this.results.errors.forEach((err, index) => {
                console.log(`${index + 1}. ${colors.red}${err.test}${colors.reset}: ${err.error}`);
            });
        }
        
        const successRate = ((this.results.passed / this.results.total) * 100).toFixed(1);
        console.log(`\n${colors.bold}Tasso di successo: ${successRate}%${colors.reset}`);
        
        if (this.results.failed === 0) {
            TestLogger.success('🎉 TUTTI I TEST SONO PASSATI! Sistema funzionante correttamente.');
        } else {
            TestLogger.error('❌ Alcuni test sono falliti. Verificare gli errori sopra.');
        }
    }
}

/**
 * Funzione principale
 */
async function main() {
    const runner = new SelfTestRunner();
    
    try {
        await runner.runAllTests();
        process.exit(runner.results.failed === 0 ? 0 : 1);
    } catch (error) {
        TestLogger.error(`Errore critico durante i test: ${error.message}`);
        process.exit(1);
    }
}

// Esegui solo se chiamato direttamente
if (require.main === module) {
    main();
}

module.exports = SelfTestRunner;