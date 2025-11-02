const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Test the enhanced PDF generation system
async function testEnhancedPDFGeneration() {
    console.log('🧪 Testing Enhanced PDF Generation System...\n');
    
    try {
        // Test 1: Check PDF settings endpoint
        console.log('1️⃣ Testing PDF settings endpoint...');
        const settingsResponse = await axios.get('http://localhost:3000/api/pdf-settings');
        console.log('✅ Settings retrieved successfully');
        console.log('📋 Current settings:', JSON.stringify(settingsResponse.data, null, 2));
        
        // Test 2: Generate PDF with sample data
        console.log('\n2️⃣ Testing PDF generation...');
        const testData = {
            operator: 'Mario Rossi',
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
        
        const pdfResponse = await axios.post('http://localhost:3000/generate-pdf', testData);
        console.log('✅ PDF generated successfully');
        console.log('📄 Response:', JSON.stringify(pdfResponse.data, null, 2));
        
        // Test 3: Check if PDF file was created
        console.log('\n3️⃣ Checking generated PDF file...');
        const reportDir = path.join(__dirname, 'report');
        if (fs.existsSync(reportDir)) {
            const files = fs.readdirSync(reportDir);
            const pdfFiles = files.filter(file => file.endsWith('.pdf'));
            if (pdfFiles.length > 0) {
                console.log('✅ PDF files found in report directory:');
                pdfFiles.forEach(file => {
                    const filePath = path.join(reportDir, file);
                    const stats = fs.statSync(filePath);
                    console.log(`   📁 ${file} (${Math.round(stats.size / 1024)}KB, ${stats.mtime.toLocaleString()})`);
                });
            } else {
                console.log('⚠️ No PDF files found in report directory');
            }
        } else {
            console.log('⚠️ Report directory not found');
        }
        
        // Test 4: Check logs
        console.log('\n4️⃣ Checking log files...');
        const logsDir = path.join(__dirname, 'logs');
        if (fs.existsSync(logsDir)) {
            const logFiles = fs.readdirSync(logsDir);
            if (logFiles.length > 0) {
                console.log('✅ Log files found:');
                logFiles.forEach(file => {
                    console.log(`   📝 ${file}`);
                });
                
                // Show recent log entries
                const latestLog = logFiles.sort().pop();
                if (latestLog) {
                    const logPath = path.join(logsDir, latestLog);
                    const logContent = fs.readFileSync(logPath, 'utf8');
                    const recentLines = logContent.split('\n').slice(-5).filter(line => line.trim());
                    if (recentLines.length > 0) {
                        console.log('\n📋 Recent log entries:');
                        recentLines.forEach(line => console.log(`   ${line}`));
                    }
                }
            } else {
                console.log('⚠️ No log files found');
            }
        } else {
            console.log('⚠️ Logs directory not found');
        }
        
        console.log('\n🎉 Enhanced PDF Generation System Test Completed Successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('📋 Error details:', error.response.data);
        }
    }
}

// Run the test
testEnhancedPDFGeneration();