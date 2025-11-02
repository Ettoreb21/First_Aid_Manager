/**
 * Test completo per l'integrazione API PDF
 * Verifica tutti i casi d'uso richiesti dal contratto API
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

// Dati di test
const validTestData = {
    operatore: "Mario Rossi",
    dateLongFormat: false,
    thresholdDays: 90,
    revision: "Rev.05",
    kits: [
        {
            codice: 'CASS001',
            ubicazione: 'Magazzino A',
            articoli: [
                {
                    codice: 'ART001',
                    descrizione: 'Benda elastica',
                    quantita: 5,
                    scadenza: '2025-12-31',
                    stato: 'idoneo'
                },
                {
                    codice: 'ART002',
                    descrizione: 'Disinfettante',
                    quantita: 2,
                    scadenza: '2024-06-15',
                    stato: 'scaduto'
                }
            ]
        }
    ],
    location: 'Magazzino A'
};

async function runTests() {
    console.log('🧪 Test Integrazione API PDF - Contratto Stabile\n');
    
    let testsPassed = 0;
    let testsFailed = 0;
    
    // Test 1: POST corretto → 200 JSON valido
    console.log('1️⃣ Test POST corretto → 200 JSON valido');
    try {
        const response = await axios.post(`${BASE_URL}/report/generate`, validTestData, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        console.log('✅ Status:', response.status);
        console.log('✅ Content-Type:', response.headers['content-type']);
        console.log('✅ Response:', JSON.stringify(response.data, null, 2));
        
        // Verifica struttura risposta
        if (response.data.status === 'ok' && response.data.filePath) {
            console.log('✅ Struttura risposta corretta');
            
            // Verifica che il file esista
            const fileName = response.data.filePath.split('/').pop();
            const filePath = path.join(__dirname, 'report', fileName);
            if (fs.existsSync(filePath)) {
                console.log('✅ File PDF creato correttamente');
                testsPassed++;
            } else {
                console.log('❌ File PDF non trovato');
                testsFailed++;
            }
        } else {
            console.log('❌ Struttura risposta non valida');
            testsFailed++;
        }
    } catch (error) {
        console.log('❌ Test fallito:', error.message);
        testsFailed++;
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 2: Errore validazione → 400 con JSON
    console.log('2️⃣ Test errore validazione → 400 JSON');
    try {
        const invalidData = { ...validTestData, operatore: "AB" }; // Troppo corto
        const response = await axios.post(`${BASE_URL}/report/generate`, invalidData);
        console.log('❌ Doveva fallire ma ha avuto successo');
        testsFailed++;
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log('✅ Status 400 corretto');
            console.log('✅ Content-Type:', error.response.headers['content-type']);
            console.log('✅ Response:', JSON.stringify(error.response.data, null, 2));
            
            if (error.response.data.status === 'error' && 
                error.response.data.code === 'VALIDATION_ERROR') {
                console.log('✅ Struttura errore corretta');
                testsPassed++;
            } else {
                console.log('❌ Struttura errore non valida');
                testsFailed++;
            }
        } else {
            console.log('❌ Status code non corretto:', error.response?.status);
            testsFailed++;
        }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 3: Campo revision non valido
    console.log('3️⃣ Test revision non valida → 400 JSON');
    try {
        const invalidRevision = { ...validTestData, revision: "Rev.ABC" };
        const response = await axios.post(`${BASE_URL}/report/generate`, invalidRevision);
        console.log('❌ Doveva fallire ma ha avuto successo');
        testsFailed++;
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log('✅ Status 400 corretto');
            console.log('✅ Response:', JSON.stringify(error.response.data, null, 2));
            
            if (error.response.data.code === 'VALIDATION_ERROR' && 
                error.response.data.details.some(d => d.field === 'revision')) {
                console.log('✅ Validazione revision corretta');
                testsPassed++;
            } else {
                console.log('❌ Validazione revision non corretta');
                testsFailed++;
            }
        } else {
            console.log('❌ Status code non corretto');
            testsFailed++;
        }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 4: Test endpoint download
    console.log('4️⃣ Test endpoint download PDF');
    try {
        // Prima genera un PDF
        const generateResponse = await axios.post(`${BASE_URL}/report/generate`, validTestData, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        if (generateResponse.data.status === 'ok' && generateResponse.data.filePath) {
            const fileName = generateResponse.data.filePath.split('/').pop();
            
            // Poi prova a scaricarlo
            const downloadResponse = await axios.get(`${BASE_URL}/report/download?file=${fileName}`, {
                responseType: 'arraybuffer'
            });
            
            console.log('✅ Status download:', downloadResponse.status);
            console.log('✅ Content-Type:', downloadResponse.headers['content-type']);
            
            if (downloadResponse.headers['content-type'] === 'application/pdf') {
                console.log('✅ Content-Type PDF corretto');
                console.log('✅ Dimensione file:', downloadResponse.data.length, 'bytes');
                testsPassed++;
            } else {
                console.log('❌ Content-Type non corretto');
                testsFailed++;
            }
        } else {
            console.log('❌ Generazione PDF fallita, impossibile testare download');
            testsFailed++;
        }
    } catch (error) {
        console.log('❌ Test download fallito:', error.message);
        if (error.response) {
            console.log('Response status:', error.response.status);
            console.log('Response data:', error.response.data);
        }
        testsFailed++;
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 5: Download file inesistente
    console.log('5️⃣ Test download file inesistente → 404 JSON');
    try {
        const response = await axios.get(`${BASE_URL}/report/download?file=nonexistent.pdf`);
        console.log('❌ Doveva fallire ma ha avuto successo');
        testsFailed++;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log('✅ Status 404 corretto');
            console.log('✅ Response:', JSON.stringify(error.response.data, null, 2));
            
            if (error.response.data.code === 'FILE_NOT_FOUND') {
                console.log('✅ Codice errore corretto');
                testsPassed++;
            } else {
                console.log('❌ Codice errore non corretto');
                testsFailed++;
            }
        } else {
            console.log('❌ Status code non corretto');
            testsFailed++;
        }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 6: Path traversal security
    console.log('6️⃣ Test sicurezza path traversal');
    try {
        const response = await axios.get(`${BASE_URL}/report/download?file=../server.js`);
        console.log('❌ Doveva fallire ma ha avuto successo');
        testsFailed++;
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log('✅ Path traversal bloccato correttamente');
            console.log('✅ Response:', JSON.stringify(error.response.data, null, 2));
            testsPassed++;
        } else {
            console.log('❌ Path traversal non bloccato correttamente');
            testsFailed++;
        }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 7: Compatibilità endpoint legacy
    console.log('7️⃣ Test compatibilità endpoint legacy /generate-pdf');
    try {
        const legacyData = {
            operator: validTestData.operatore,
            kits: validTestData.kits,
            location: validTestData.location
        };
        
        const response = await axios.post(`${BASE_URL}/generate-pdf`, legacyData);
        console.log('✅ Endpoint legacy funziona');
        console.log('✅ Response:', JSON.stringify(response.data, null, 2));
        testsPassed++;
    } catch (error) {
        console.log('❌ Endpoint legacy fallito:', error.message);
        testsFailed++;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RISULTATI FINALI');
    console.log('='.repeat(60));
    console.log(`✅ Test passati: ${testsPassed}`);
    console.log(`❌ Test falliti: ${testsFailed}`);
    console.log(`📈 Percentuale successo: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
    
    if (testsFailed === 0) {
        console.log('\n🎉 TUTTI I TEST SONO PASSATI! Integrazione API completamente funzionante.');
    } else {
        console.log('\n⚠️ Alcuni test sono falliti. Verifica l\'implementazione.');
    }
    
    // Mostra log di esempio con traceId
    console.log('\n📋 Esempio log con traceId per errore 500:');
    console.log('[2025-01-20 10:30:45] [trace_1737369045123_abc123] ERROR: Errore generazione PDF - Template non trovato: /path/to/template.html');
}

// Esegui i test
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { runTests };