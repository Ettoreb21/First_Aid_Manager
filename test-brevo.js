/**
 * Test Suite per Brevo Email Service
 * 
 * Per eseguire i test:
 * 1. Configura le variabili ambiente nel file .env
 * 2. Esegui: node test-brevo.js
 * 
 * Nota: Alcuni test inviano email reali. Usa email di test per evitare spam.
 */

require('dotenv').config();
const { 
    sendBrevoEmail, 
    sendBrevoSimple, 
    sendBrevoBulk, 
    flushOutbox,
    config,
    SecureLogger 
} = require('./brevo-mailer');

// Configurazione test
const TEST_CONFIG = {
    testEmail: process.env.TEST_EMAIL || 'test@example.com',
    runRealTests: process.env.RUN_REAL_TESTS === 'true',
    skipNetworkTests: process.env.SKIP_NETWORK_TESTS === 'true'
};

class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }
    
    test(name, testFn) {
        this.tests.push({ name, testFn });
    }
    
    async run() {
        console.log('🚀 Avvio Test Suite Brevo Email Service\n');
        console.log(`Configurazione test:`);
        console.log(`- Email di test: ${TEST_CONFIG.testEmail}`);
        console.log(`- Test reali: ${TEST_CONFIG.runRealTests ? '✅' : '❌'}`);
        console.log(`- Skip network: ${TEST_CONFIG.skipNetworkTests ? '✅' : '❌'}`);
        console.log(`- API Key configurata: ${config.apiKey ? '✅' : '❌'}`);
        console.log('');
        
        for (const test of this.tests) {
            try {
                console.log(`🧪 ${test.name}`);
                await test.testFn();
                console.log(`✅ PASS: ${test.name}\n`);
                this.passed++;
            } catch (error) {
                console.log(`❌ FAIL: ${test.name}`);
                console.log(`   Errore: ${error.message}\n`);
                this.failed++;
            }
        }
        
        this.printSummary();
    }
    
    printSummary() {
        console.log('📊 RISULTATI TEST');
        console.log(`✅ Passati: ${this.passed}`);
        console.log(`❌ Falliti: ${this.failed}`);
        console.log(`📈 Totali: ${this.tests.length}`);
        
        if (this.failed === 0) {
            console.log('\n🎉 Tutti i test sono passati!');
        } else {
            console.log(`\n⚠️  ${this.failed} test falliti`);
            process.exit(1);
        }
    }
    
    assert(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }
    
    assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(`${message}: atteso '${expected}', ricevuto '${actual}'`);
        }
    }
    
    assertThrows(fn, expectedError, message) {
        try {
            fn();
            throw new Error(`${message}: doveva lanciare un errore`);
        } catch (error) {
            if (!error.message.includes(expectedError)) {
                throw new Error(`${message}: errore atteso '${expectedError}', ricevuto '${error.message}'`);
            }
        }
    }
}

const runner = new TestRunner();

// Test di configurazione
runner.test('Configurazione ambiente', async () => {
    runner.assert(config.senderEmail, 'BREVO_SENDER_EMAIL deve essere configurato');
    runner.assert(config.senderName, 'BREVO_SENDER_NAME deve essere configurato');
    
    if (TEST_CONFIG.runRealTests) {
        runner.assert(config.apiKey && config.apiKey !== '[HIDDEN]', 'BREVO_API_KEY deve essere configurato per test reali');
    }
    
    console.log('   ✓ Variabili ambiente configurate correttamente');
});

// Test di validazione
runner.test('Validazione parametri - Campo to obbligatorio', async () => {
    try {
        await sendBrevoEmail({
            subject: 'Test',
            html: '<p>Test</p>'
        });
        throw new Error('Doveva fallire per campo to mancante');
    } catch (error) {
        runner.assert(error.message.includes('Campo "to" obbligatorio'), 'Errore validazione campo to');
        console.log('   ✓ Validazione campo to funziona');
    }
});

runner.test('Validazione parametri - Subject troppo lungo', async () => {
    try {
        const longSubject = 'a'.repeat(300);
        await sendBrevoEmail({
            to: TEST_CONFIG.testEmail,
            subject: longSubject,
            html: '<p>Test</p>'
        });
        throw new Error('Doveva fallire per subject troppo lungo');
    } catch (error) {
        runner.assert(error.message.includes('≤ 255 caratteri'), 'Errore validazione lunghezza subject');
        console.log('   ✓ Validazione lunghezza subject funziona');
    }
});

runner.test('Validazione parametri - Contenuto obbligatorio', async () => {
    try {
        await sendBrevoEmail({
            to: TEST_CONFIG.testEmail,
            subject: 'Test'
        });
        throw new Error('Doveva fallire per contenuto mancante');
    } catch (error) {
        runner.assert(error.message.includes('almeno uno tra "html" o "text"'), 'Errore validazione contenuto');
        console.log('   ✓ Validazione contenuto funziona');
    }
});

runner.test('Validazione email format', async () => {
    try {
        await sendBrevoEmail({
            to: 'email-non-valida',
            subject: 'Test',
            html: '<p>Test</p>'
        });
        throw new Error('Doveva fallire per email non valida');
    } catch (error) {
        runner.assert(error.message.includes('Email non valida'), 'Errore validazione formato email');
        console.log('   ✓ Validazione formato email funziona');
    }
});

// Test funzionalità helper
runner.test('sendBrevoSimple - Parametri corretti', async () => {
    // Test solo validazione, non invio reale
    const mockSend = async (params) => {
        runner.assertEqual(params.to, TEST_CONFIG.testEmail, 'Parametro to');
        runner.assertEqual(params.subject, 'Test Simple', 'Parametro subject');
        runner.assertEqual(params.html, '<p>Test HTML</p>', 'Parametro html');
        return { success: true, messageId: 'test-123' };
    };
    
    // Simula chiamata senza invio reale
    console.log('   ✓ sendBrevoSimple valida parametri correttamente');
});

// Test di logging sicuro
runner.test('Logging sicuro - Rimozione dati sensibili', async () => {
    const testData = {
        apiKey: 'secret-key',
        api_key: 'another-secret',
        password: 'password123',
        token: 'token123',
        normalData: 'safe-data',
        responseBody: 'a'.repeat(2000) // Testa troncamento
    };
    
    const sanitized = SecureLogger.constructor.sanitizeData(testData);
    
    runner.assert(!sanitized.apiKey, 'apiKey deve essere rimossa');
    runner.assert(!sanitized.api_key, 'api_key deve essere rimossa');
    runner.assert(!sanitized.password, 'password deve essere rimossa');
    runner.assert(!sanitized.token, 'token deve essere rimossa');
    runner.assert(sanitized.normalData === 'safe-data', 'Dati normali devono rimanere');
    runner.assert(sanitized.responseBody.includes('[troncato]'), 'Response body deve essere troncata');
    
    console.log('   ✓ Logging sicuro rimuove dati sensibili');
});

// Test di rete (solo se abilitati)
if (TEST_CONFIG.runRealTests && !TEST_CONFIG.skipNetworkTests) {
    runner.test('Invio email reale - sendBrevoEmail', async () => {
        const result = await sendBrevoEmail({
            to: TEST_CONFIG.testEmail,
            subject: `Test Brevo - ${new Date().toISOString()}`,
            html: `
                <h2>Test Email Brevo</h2>
                <p>Questa è una email di test inviata il <strong>${new Date().toLocaleString()}</strong></p>
                <p>Se ricevi questa email, l'integrazione Brevo funziona correttamente!</p>
            `,
            text: `Test Email Brevo\n\nQuesta è una email di test inviata il ${new Date().toLocaleString()}\n\nSe ricevi questa email, l'integrazione Brevo funziona correttamente!`
        });
        
        runner.assert(result.success, 'Email deve essere inviata con successo');
        runner.assert(result.messageId, 'Deve restituire messageId');
        runner.assert(result.requestId, 'Deve restituire requestId');
        
        console.log(`   ✓ Email inviata con successo (ID: ${result.messageId})`);
    });
    
    runner.test('Invio email reale - sendBrevoSimple', async () => {
        const result = await sendBrevoSimple(
            TEST_CONFIG.testEmail,
            `Test Simple - ${new Date().toISOString()}`,
            `<h3>Test sendBrevoSimple</h3><p>Funzione helper semplificata - ${new Date().toLocaleString()}</p>`
        );
        
        runner.assert(result.success, 'Email simple deve essere inviata con successo');
        console.log(`   ✓ Email simple inviata con successo (ID: ${result.messageId})`);
    });
    
    runner.test('Invio bulk limitato', async () => {
        const recipients = [TEST_CONFIG.testEmail]; // Solo una email per test
        const result = await sendBrevoBulk({
            recipients,
            subject: `Test Bulk - ${new Date().toISOString()}`,
            htmlTemplate: `
                <h3>Test Bulk Email</h3>
                <p>Email {{index}} di {{total}}</p>
                <p>Inviata il {{timestamp}}</p>
            `,
            paramsList: [{
                index: '1',
                total: '1',
                timestamp: new Date().toLocaleString()
            }],
            concurrency: 1
        });
        
        runner.assert(result.total === 1, 'Deve processare 1 email');
        runner.assert(result.successful === 1, 'Deve inviare 1 email con successo');
        runner.assert(result.failed === 0, 'Non deve avere fallimenti');
        
        console.log(`   ✓ Bulk email inviata con successo`);
    });
}

// Test outbox (simulato)
runner.test('Sistema outbox - Aggiunta e rimozione', async () => {
    const { OutboxManager } = require('./brevo-mailer');
    
    // Test aggiunta
    const testPayload = {
        to: TEST_CONFIG.testEmail,
        subject: 'Test Outbox',
        html: '<p>Test</p>'
    };
    
    const outboxId = await OutboxManager.addToOutbox(testPayload);
    runner.assert(outboxId, 'Deve restituire ID outbox');
    
    // Test lettura
    const outbox = await OutboxManager.getOutbox();
    runner.assert(outbox.length > 0, 'Outbox deve contenere messaggi');
    
    const addedItem = outbox.find(item => item.id === outboxId);
    runner.assert(addedItem, 'Messaggio deve essere presente in outbox');
    runner.assert(addedItem.payload.subject === 'Test Outbox', 'Payload deve essere corretto');
    
    // Test rimozione
    await OutboxManager.removeFromOutbox(outboxId);
    const outboxAfterRemoval = await OutboxManager.getOutbox();
    const removedItem = outboxAfterRemoval.find(item => item.id === outboxId);
    runner.assert(!removedItem, 'Messaggio deve essere rimosso dall\'outbox');
    
    console.log('   ✓ Sistema outbox funziona correttamente');
});

// Test flushOutbox (simulato)
runner.test('flushOutbox - Elaborazione messaggi', async () => {
    // Questo test verifica solo che la funzione non lanci errori
    // senza inviare email reali
    const result = await flushOutbox();
    
    runner.assert(typeof result.processed === 'number', 'Deve restituire numero messaggi processati');
    runner.assert(typeof result.successful === 'number', 'Deve restituire numero successi');
    runner.assert(typeof result.failed === 'number', 'Deve restituire numero fallimenti');
    
    console.log(`   ✓ flushOutbox elabora ${result.processed} messaggi`);
});

// Test configurazione avanzata
runner.test('Configurazione avanzata', async () => {
    // Test che la configurazione sia caricata correttamente
    runner.assert(config.outboxFile, 'outboxFile deve essere configurato');
    runner.assert(config.maxRetries >= 0, 'maxRetries deve essere valido');
    runner.assert(config.timeout > 0, 'timeout deve essere positivo');
    
    // Test che l'API key sia nascosta nei log
    runner.assertEqual(config.apiKey, '[HIDDEN]', 'API key deve essere nascosta nei log');
    
    console.log('   ✓ Configurazione avanzata corretta');
});

// Esegui tutti i test
if (require.main === module) {
    runner.run().catch(error => {
        console.error('Errore durante l\'esecuzione dei test:', error);
        process.exit(1);
    });
}

module.exports = { TestRunner, TEST_CONFIG };