// Test per il generatore PDF - First Aid Manager
// Questo file testa la generazione PDF con dati di esempio

const PDFReportGenerator = require('./pdf-generator.js');
const fs = require('fs');
const path = require('path');

// Dati di test
const testKitsData = [
    {
        id: 'kit-001',
        name: 'Cassetta Primo Soccorso - Ufficio',
        location: 'Piano Terra - Reception',
        items: [
            {
                id: 'item-001',
                code: 'GAR001',
                name: 'Garze sterili 10x10',
                currentQuantity: 8,
                targetQuantity: 10,
                batch: 'LOT2024001',
                serial: 'N/A',
                expiryDate: '2024-12-31',
                status: 'OK'
            },
            {
                id: 'item-002',
                code: 'CER001',
                name: 'Cerotti assortiti',
                currentQuantity: 3,
                targetQuantity: 20,
                batch: 'LOT2024002',
                serial: 'N/A',
                expiryDate: '2025-06-30',
                status: 'OK'
            },
            {
                id: 'item-003',
                code: 'DIS001',
                name: 'Disinfettante spray',
                currentQuantity: 1,
                targetQuantity: 2,
                batch: 'LOT2023015',
                serial: 'N/A',
                expiryDate: '2024-01-15',
                status: 'Scaduto'
            },
            {
                id: 'item-004',
                code: 'GUA001',
                name: 'Guanti monouso (pz)',
                currentQuantity: 15,
                targetQuantity: 50,
                batch: 'LOT2024010',
                serial: 'N/A',
                expiryDate: '2026-03-31',
                status: 'OK'
            }
        ]
    },
    {
        id: 'kit-002',
        name: 'Cassetta Primo Soccorso - Magazzino',
        location: 'Magazzino - Zona A',
        items: [
            {
                id: 'item-005',
                code: 'BEN001',
                name: 'Bende elastiche',
                currentQuantity: 5,
                targetQuantity: 5,
                batch: 'LOT2024020',
                serial: 'N/A',
                expiryDate: '2025-12-31',
                status: 'OK'
            },
            {
                id: 'item-006',
                code: 'TER001',
                name: 'Termometro digitale',
                currentQuantity: 0,
                targetQuantity: 1,
                batch: 'N/A',
                serial: 'TH2024001',
                expiryDate: null,
                status: 'Quarantena'
            },
            {
                id: 'item-007',
                code: 'SCI001',
                name: 'Sciroppo antistaminico',
                currentQuantity: 1,
                targetQuantity: 2,
                batch: 'LOT2024005',
                serial: 'N/A',
                expiryDate: '2024-03-15',
                status: 'In scadenza'
            }
        ]
    }
];

async function runTest() {
    console.log('=== TEST GENERATORE PDF ===');
    console.log('Avvio test con dati di esempio...\n');

    try {
        // Verifica dipendenze
        console.log('1. Verifica dipendenze...');
        if (!PDFReportGenerator.checkDependencies()) {
            console.error('❌ Dipendenze mancanti. Installa con: npm install puppeteer handlebars');
            return;
        }
        console.log('✅ Dipendenze verificate\n');

        // Crea istanza generatore
        console.log('2. Inizializzazione generatore...');
        const pdfGenerator = new PDFReportGenerator();
        console.log('✅ Generatore inizializzato\n');

        // Callback per monitorare progresso
        const progressCallback = (message) => {
            console.log(`📄 ${message}`);
        };

        // Genera PDF
        console.log('3. Generazione PDF in corso...');
        const result = await pdfGenerator.generatePDF(
            testKitsData,
            'Mario Rossi',
            'Sede Principale - Test',
            progressCallback
        );

        if (result.success) {
            console.log('\n✅ TEST COMPLETATO CON SUCCESSO!');
            console.log(`📁 File generato: ${result.outputPath}`);
            console.log(`💬 Messaggio: ${result.message}`);
            
            // Verifica che il file esista
            if (fs.existsSync(result.outputPath)) {
                const stats = fs.statSync(result.outputPath);
                console.log(`📊 Dimensione file: ${Math.round(stats.size / 1024)} KB`);
                console.log(`🕒 Creato: ${stats.birthtime.toLocaleString('it-IT')}`);
            }
        } else {
            console.log('\n❌ TEST FALLITO');
            console.log(`💬 Errore: ${result.error}`);
            console.log(`💬 Messaggio: ${result.message}`);
        }

    } catch (error) {
        console.error('\n❌ ERRORE DURANTE IL TEST');
        console.error(`💬 Dettagli: ${error.message}`);
        console.error(`📍 Stack: ${error.stack}`);
    }

    console.log('\n=== FINE TEST ===');
}

// Esegui test se chiamato direttamente
if (require.main === module) {
    runTest();
}

module.exports = { runTest, testKitsData };