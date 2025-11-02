/**
 * Server Express per First Aid Manager
 * Gestisce l'invio di email tramite API Brevo
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');
const Joi = require('joi');
const { spawn } = require('child_process');
require('dotenv').config();
// Avvio pianificazioni AssistBot
require('./schedulers/emailScheduler');
// Modulo archivio materiali (DB + API)
const apiAuth = require('./middleware/apiAuth');
const materialsRouter = require('./routes/materials');
const authRouter = require('./routes/auth');
const { initSequelize } = require('./db/sequelize');
const { start: startMaterialsScheduler } = require('./schedulers/materialsExpiryScheduler');

// Process-level error handlers to improve diagnostics and avoid silent crashes
process.on('uncaughtException', (err) => {
  const traceId = `proc_${Date.now()}`;
  console.error(`[${new Date().toISOString()}] [${traceId}] UNCAUGHT_EXCEPTION:`, err);
});
process.on('unhandledRejection', (reason, promise) => {
  const traceId = `proc_${Date.now()}`;
  console.error(`[${new Date().toISOString()}] [${traceId}] UNHANDLED_REJECTION:`, { reason });
});

// Importa moduli email e PDF
const { sendBrevoEmail, flushOutbox } = require('./brevo-mailer');
const { sendEmail: sendGenericEmail, verifyTransport: verifyEmailProvider } = require('./services/emailService');
const EnhancedPDFGenerator = require('./pdf-generator-enhanced');
const { generateOrderPDF } = require('./order-pdf-generator');

const Error500ReportGenerator = require('./error-report-generator');
const PDFReportGenerator = require('./pdf-generator');


const app = express();

// Explicit preflight handler to guarantee custom headers are allowed
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (origin) res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,X-Requested-With,x-api-key,x-user');
  res.sendStatus(200);
});
const PORT = process.env.PORT || 3000;

// Schema di validazione per il contratto API
const reportGenerationSchema = Joi.object({
    operatore: Joi.string().min(1).max(100).required()
        .messages({
            'string.min': 'Il nome operatore deve essere di almeno 1 carattere',
            'string.max': 'Il nome operatore non può superare 100 caratteri',
            'any.required': 'Il campo operatore è obbligatorio'
        }),
    operatorSignature: Joi.string().optional().allow(null), // Aggiungi supporto per la firma dell'operatore
    dateLongFormat: Joi.boolean().default(false),
    thresholdDays: Joi.number().integer().min(0).max(365).default(90)
        .messages({
            'number.min': 'I giorni soglia devono essere almeno 0',
            'number.max': 'I giorni soglia non possono superare 365'
        }),
    logoPath: Joi.string().optional(),
    revision: Joi.string().pattern(/^Rev\.[0-9]{2}$/).default('Rev.01')
        .messages({
            'string.pattern.base': 'La revisione deve seguire il formato Rev.XX (es. Rev.01)'
        }),
    kits: Joi.array().items(Joi.object({
        codice: Joi.string().required(),
        ubicazione: Joi.string().required(),
        articoli: Joi.array().items(Joi.object({
            codice: Joi.string().required(),
            descrizione: Joi.string().required(),
            quantita: Joi.number().integer().min(0).required(),
            scadenza: Joi.string().required(),
            stato: Joi.string().valid('idoneo', 'scaduto', 'da_controllare').required()
        })).required()
    })).min(1).required()
        .messages({
            'array.min': 'È necessario specificare almeno un kit'
        }),
    location: Joi.string().required()
        .messages({
            'any.required': 'Il campo location è obbligatorio'
        })
});

// Schema Joi per report verifica primo soccorso
// verificationReportSchema definito in testa al file

// Funzione per generare traceId
function generateTraceId() {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Funzione per logging strutturato
function logError(traceId, error, context = {}) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${traceId}] ERROR: ${error.message}`, {
        stack: error.stack,
        context
    });
}

function logInfo(message, context = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] INFO: ${message}`, context);
}

// Configurazione CORS specifica per sviluppo
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? 
        ['https://yourdomain.com'] : 
        [
            'http://localhost:3000',
            'http://localhost:3002',
            'http://localhost:5173',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3002',
            'http://127.0.0.1:5173',
            'http://localhost:5500',
            'http://127.0.0.1:5500'
        ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With', 'x-api-key', 'x-user'],
    credentials: true,
    optionsSuccessStatus: 200, // Per compatibilità con browser legacy
    preflightContinue: true
}));

// Preflight CORS hardening: ensure custom headers are explicitly allowed
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,X-Requested-With,x-api-key,x-user');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10mb' }));
// Fallback parser per JSON inviato come stringa (compatibilità client)
app.use((req, res, next) => {
  try {
    const ct = req.headers['content-type'] || '';
    const isJson = ct.toLowerCase().includes('application/json');
    if (isJson && typeof req.body === 'string') {
      req.body = JSON.parse(req.body);
    }
    next();
  } catch (e) {
    const traceId = generateTraceId();
    logInfo('Invalid JSON body (fallback parser)', { traceId, error: e.message });
    return res.status(400).json({
      status: 'error',
      code: 'BAD_REQUEST',
      message: 'Invalid JSON body',
      traceId
    });
  }
});
app.use(express.static('.'));

// Sessioni per autenticazione utenti
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

// Inizializza Sequelize e modelli materiali
initSequelize()
  .then(() => {
    console.log('[Materials] Sequelize inizializzato e modelli sincronizzati');
    try {
      startMaterialsScheduler();
    } catch (e) {
      console.warn('[Materials] Scheduler non avviato:', e.message);
    }
  })
  .catch((err) => {
    console.error('[Materials] Errore inizializzazione Sequelize:', err.message);
  });

// Monta router materiali e impostazioni sotto /api
const settingsRouter = require('./routes/settings');
const buttonsRouter = require('./routes/buttons');
// Auth endpoints (session-based)
app.use('/api', authRouter);
// Legacy API key-based auth for other routers remains
app.use('/api', apiAuth, materialsRouter);
app.use('/api', apiAuth, settingsRouter);
app.use('/api/buttons', apiAuth, buttonsRouter);

// Middleware per gestione errori JSON parsing
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        const traceId = generateTraceId();
        logError(traceId, error, { operation: 'jsonParsing', body: req.body });
        
        return res.status(400).json({
            status: 'error',
            code: 'BAD_REQUEST',
            message: 'Invalid JSON body',
            traceId
        });
    }
    next(error);
});

// Endpoint per l'invio email
app.post('/api/send-email', apiAuth, async (req, res) => {
    try {
        const { to, subject, html, text, tags, cc, bcc, replyTo } = req.body;
        
        // Validazione base
        if (!to || !subject || (!html && !text)) {
            return res.status(400).json({
                success: false,
                error: 'Parametri mancanti: to, subject e almeno uno tra html o text sono obbligatori'
            });
        }
        
        // Invia email tramite provider configurato
        const provider = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
        let result;
        if (provider === 'resend' || provider === 'gmail') {
            result = await sendGenericEmail(to, subject, html, { text, cc, bcc, replyTo });
        } else if (provider === 'brevo') {
            // Usa il servizio generico che gestisce automaticamente SMTP fallback (xsmtpsib) o API (xkeysib)
            result = await sendGenericEmail(to, subject, html, { text, cc, bcc, replyTo });
        } else {
            // Fallback: usa client Brevo API diretta
            result = await sendBrevoEmail({ to, subject, html, text, tags, cc, bcc, replyTo });
        }
        
        if (result.success) {
            res.json({
                success: true,
                messageId: result.messageId,
                message: 'Email inviata con successo'
            });
        } else {
            res.status(provider === 'resend' ? 500 : 500).json({
                success: false,
                error: result.error,
                outboxId: result.outboxId,
                message: provider === 'resend' ? 'Errore invio email' : 'Email salvata in outbox per retry automatico'
            });
        }
        
    } catch (error) {
        console.error('Errore endpoint send-email:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Errore interno del server'
        });
    }
});

// Endpoint per svuotare l'outbox (retry email fallite)
app.post('/api/flush-outbox', apiAuth, async (req, res) => {
    try {
        const result = await flushOutbox();
        res.json({
            success: true,
            processed: result.processed,
            successful: result.successful,
            failed: result.failed,
            message: `Processate ${result.processed} email dall'outbox`
        });
    } catch (error) {
        console.error('Errore flush outbox:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Webhook Resend per tracking (delivered, opened, clicked, bounced)
app.post('/webhooks/resend', express.json({ type: '*/*' }), async (req, res) => {
    const event = req.body || {};
    const type = event.type || event.event || 'unknown';
    const payload = event.payload || event.data || event;
    const logsDir = path.join(__dirname, 'logs');
    try { if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true }); } catch {}
    const deliveryLog = path.join(logsDir, 'email_deliveries.log');
    const errorLog = path.join(logsDir, 'email_errors.log');

    const entry = {
        at: new Date().toISOString(),
        type,
        emailId: payload?.email_id || payload?.id || null,
        to: payload?.to || payload?.recipient || null,
        subject: payload?.subject || null,
        meta: payload
    };

    try {
        const line = `${entry.at} ${JSON.stringify(entry)}\n`;
        if (/bounce/i.test(type)) {
            fs.appendFileSync(errorLog, line);
        } else {
            fs.appendFileSync(deliveryLog, line);
        }
    } catch (e) {
        console.error('[Resend webhook] Errore scrittura log:', e.message || e);
    }

    res.status(200).json({ ok: true });
});

// Gestione specifica per /report/generate con tutti i metodi HTTP
app.all('/report/generate', async (req, res) => {
    const traceId = generateTraceId();
    const startTime = Date.now();
    
    // Gestione GET per informazioni sull'endpoint
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'info',
            message: 'Endpoint per generazione rapporti PDF',
            usage: {
                method: 'POST',
                endpoint: '/report/generate',
                contentType: 'application/json',
                requiredFields: ['operatore', 'kits', 'location'],
                optionalFields: ['dateLongFormat', 'thresholdDays', 'logoPath', 'revision']
            },
            traceId
        });
    }
    
    // Solo POST è consentito per la generazione (OPTIONS gestito da CORS middleware)
    if (req.method !== 'POST') {
        logInfo('Metodo non consentito per /report/generate', { 
            traceId, 
            method: req.method, 
            expectedMethod: 'POST',
            url: req.url 
        });
        
        return res.status(405)
            .header('Allow', 'GET, POST, OPTIONS')
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'error',
                code: 'METHOD_NOT_ALLOWED',
                allowed: ['GET', 'POST'],
                message: `Metodo ${req.method} non consentito. Usa POST per generare o GET per info.`,
                traceId
            });
    }
    
    try {
        logInfo('Richiesta generazione report ricevuta', { traceId, body: req.body });
        
        // Validazione input rigorosa
        const { error, value } = reportGenerationSchema.validate(req.body, { 
            abortEarly: false,
            stripUnknown: true 
        });
        
        if (error) {
            const validationErrors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));
            
            logInfo('Errore validazione input', { traceId, errors: validationErrors });
            
            return res.status(400).json({
                status: 'error',
                code: 'VALIDATION_ERROR',
                message: 'Dati di input non validi',
                details: validationErrors,
                traceId
            });
        }
        
        // Verifica esistenza template (caso limite)
        const pdfGeneratorForTemplate = new EnhancedPDFGenerator();
        const settings = await pdfGeneratorForTemplate.getSettings();
        const templatePath = path.resolve(settings.report.template_path);
        if (!fs.existsSync(templatePath)) {
            logError(traceId, new Error('Template PDF mancante'), { templatePath });
            
            return res.status(400).json({
                status: 'error',
                code: 'MISSING_TEMPLATE',
                message: 'Template per la generazione PDF non trovato',
                traceId
            });
        }
        
        // Verifica directory output
        const reportDir = path.join(__dirname, 'report');
        if (!fs.existsSync(reportDir)) {
            try {
                fs.mkdirSync(reportDir, { recursive: true });
                logInfo('Directory report creata', { traceId, path: reportDir });
            } catch (fsError) {
                logError(traceId, fsError, { operation: 'mkdir', path: reportDir });
                
                return res.status(500).json({
                    status: 'error',
                    code: 'FS_PERMISSION_DENIED',
                    message: 'Impossibile creare directory di output',
                    traceId
                });
            }
        }
        
        // Inizializza generatore PDF
        const pdfGenerator = new EnhancedPDFGenerator();
        
        // Prepara dati per generazione
        const reportData = {
            operator: value.operatore,
            operatorSignature: value.operatorSignature, // Passa la firma dell'operatore
            kits: value.kits,
            location: value.location,
            dateLongFormat: value.dateLongFormat,
            thresholdDays: value.thresholdDays,
            revision: value.revision,
            logoPath: value.logoPath
        };
        
        // Genera il report preferendo Node quando disponibile (logo affidabile), con fallback Java
        let result;
        const preferNode = (process.env.PREFER_NODE_PDF === 'true') || (value && value.preferNode === true) || (value && typeof value.logoPath === 'string' && value.logoPath.length > 0);

        const generateWithNode = async () => {
            // Converte il formato dei kit per il generatore Node
            const nodeKits = value.kits.map(kit => ({
                name: kit.codice,
                location: kit.ubicazione || value.location,
                items: (kit.articoli || []).map(art => ({
                    code: art.codice,
                    name: art.descrizione,
                    currentQuantity: art.quantita,
                    targetQuantity: art.quantita,
                    expiryDate: art.scadenza,
                    status: art.stato === 'scaduto' ? 'Scaduto' : (art.stato === 'da_controllare' ? 'Quarantena' : 'OK')
                }))
            }));

            const nodeGen = new PDFReportGenerator();
            const nodeRes = await nodeGen.generatePDF(
                nodeKits,
                value.operatore,
                value.location,
                undefined,
                value.operatorSignature,
                value.logoPath
            );
            if (!nodeRes.success) {
                throw new Error(nodeRes.error || 'Node PDF generation failed');
            }

            // Sposta il PDF nella cartella 'report' con nome timestamp coerente
            const src = path.resolve(nodeGen.outputPath);
            const dstDir = path.join(__dirname, 'report');
            const pad = n => n.toString().padStart(2, '0');
            const now = new Date();
            const fname = `rapporto_cassette_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.pdf`;
            const dst = path.join(dstDir, fname);

            try { fs.mkdirSync(dstDir, { recursive: true }); } catch {}
            fs.copyFileSync(src, dst);

            return {
                success: true,
                fileName: fname,
                outputPath: `./report/${fname}`,
                fullPath: dst,
                message: 'PDF generato (Node)'
            };
        };

        if (preferNode) {
            logInfo('Generazione PDF con Node preferita', { traceId, preferNode: true });
            try {
                result = await generateWithNode();
            } catch (e) {
                logInfo('Generazione Node fallita, provo Java', { traceId, reason: e.message });
                result = await pdfGenerator.generateReport(reportData);
            }
        } else {
            try {
                result = await pdfGenerator.generateReport(reportData);
            } catch (e) {
                const isJavaMissing = (
                    e && (
                        e.code === 'ENOENT' ||
                        (e.message && (
                            e.message.includes('ENOENT') ||
                            e.message.includes('spawn java') ||
                            e.message.toLowerCase().includes('java')
                        ))
                    )
                );
                if (!isJavaMissing) throw e;
                logInfo('Java non disponibile, fallback al generatore Node', { traceId, reason: e.message });
                result = await generateWithNode();
            }
        }
        
        const duration = Date.now() - startTime;
        logInfo('Report generato con successo', { 
            traceId, 
            filePath: result.outputPath,
            duration: `${duration}ms`
        });
        
        // Controlla warnings (firma mancante, logo mancante, etc.)
        const warnings = [];
        
        // Verifica firma
        const firmaPath = path.join(__dirname, 'assets', 'firme', `${value.operatore.replace(/\s+/g, '_')}.png`);
        if (!fs.existsSync(firmaPath)) {
            warnings.push(`FIRMA_NON_TROVATA: Firma non trovata per ${value.operatore} — report generato senza firma digitale`);
        }
        
        // Verifica logo se specificato (supporta data URL e percorsi relativi/assoluti)
        if (value.logoPath) {
            const isDataUrl = typeof value.logoPath === 'string' && /^data:image\/(png|jpe?g);base64,/i.test(value.logoPath);
            if (!isDataUrl) {
                const logoAbs = path.isAbsolute(value.logoPath) ? value.logoPath : path.join(__dirname, value.logoPath);
                if (!fs.existsSync(logoAbs)) {
                    warnings.push(`LOGO_NON_TROVATO: Logo specificato non trovato — utilizzato logo predefinito`);
                }
            }
        }
        
        // Risposta di successo
        res.status(200)
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'success',
                message: 'Report generato con successo',
                data: {
                    fileName: result.fileName,
                    filePath: result.outputPath,
                    downloadUrl: `/report/download?file=${encodeURIComponent(result.fileName)}`,
                    generationTime: duration,
                    warnings: warnings.length > 0 ? warnings : undefined
                },
                traceId
            });
            
    } catch (error) {
        const duration = Date.now() - startTime;
        logError(traceId, error, { 
            operation: 'generateReport',
            duration: `${duration}ms`,
            body: req.body 
        });
        
        // Classifica il tipo di errore
        let errorCode = 'INTERNAL_ERROR';
        let statusCode = 500;
        
        if (error.message.includes('PDF')) {
            errorCode = 'PDF_RENDER_ERROR';
        } else if (error.message.includes('permission') || error.message.includes('EACCES')) {
            errorCode = 'FS_PERMISSION_DENIED';
        } else if (error.message.includes('ENOENT')) {
            errorCode = 'FILE_NOT_FOUND';
        }
        
        res.status(statusCode)
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'error',
                code: errorCode,
                message: 'Errore interno durante la generazione del report',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                traceId
            });
    }
});

// Endpoint separato per download PDF
app.get('/report/download', (req, res) => {
    const traceId = generateTraceId();
    
    try {
        const { file } = req.query;
        
        if (!file) {
            return res.status(400).json({
                status: 'error',
                code: 'MISSING_PARAMETER',
                message: 'Parametro file mancante',
                traceId
            });
        }
        
        // Sanifica il nome file per prevenire path traversal
        const sanitizedFile = path.basename(file);
        if (sanitizedFile !== file || file.includes('..') || file.includes('/') || file.includes('\\')) {
            logInfo('Tentativo path traversal bloccato', { traceId, originalFile: file, sanitized: sanitizedFile });
            
            return res.status(400).json({
                status: 'error',
                code: 'INVALID_FILE_PATH',
                message: 'Nome file non valido',
                traceId
            });
        }
        
        // Directory consentite (legacy e nuova)
        const reportDirLegacy = path.join(__dirname, 'report');
        const reportDirNew = path.join(__dirname, 'reports', 'output');
        const allowedDirs = [reportDirNew, reportDirLegacy].map(d => path.resolve(d));
        
        // Costruisci path candidati (prima nuova, poi legacy)
        const candidates = [
            path.join(reportDirNew, sanitizedFile),
            path.join(reportDirLegacy, sanitizedFile)
        ];
        
        // Seleziona il primo esistente
        let filePath = null;
        for (const cand of candidates) {
            const resolved = path.resolve(cand);
            const insideAllowed = allowedDirs.some(dir => resolved.startsWith(dir));
            if (insideAllowed && fs.existsSync(resolved)) {
                filePath = resolved;
                break;
            }
        }
        
        if (!filePath) {
            return res.status(404).json({
                status: 'error',
                code: 'FILE_NOT_FOUND',
                message: 'File non trovato',
                traceId
            });
        }
        
        // Invia il file PDF con Content-Type corretto (inline per anteprima)
        const isPreview = ('preview' in req.query) || ('inline' in req.query) || ('ide_webview_request_time' in req.query);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${isPreview ? 'inline' : 'attachment'}; filename="${sanitizedFile}"`);
        res.setHeader('Cache-Control', 'no-store');
        
        logInfo('Download PDF avviato', { traceId, file: sanitizedFile, filePath, disposition: isPreview ? 'inline' : 'attachment' });
        res.sendFile(filePath);
        
    } catch (error) {
        logError(traceId, error, { operation: 'downloadPDF', file: req.query.file });
        
        res.status(500).json({
            status: 'error',
            code: 'INTERNAL_ERROR',
            message: 'Errore durante il download del file',
            traceId
        });
    }
});

// Mantieni endpoint legacy per compatibilità
// Endpoint per generazione report cassette (nuovo contratto API)
app.post('/report/generate', async (req, res) => {
    const traceId = generateTraceId();
    
    try {
        // Validazione input
        const { error, value } = reportGenerationSchema.validate(req.body, { abortEarly: false });
        if (error) {
            const details = error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
                value: d.context && 'value' in d.context ? d.context.value : undefined
            }));
            
            return res.status(400)
                .header('Content-Type', 'application/json; charset=utf-8')
                .json({
                    status: 'error',
                    code: 'VALIDATION_ERROR',
                    message: 'Dati di input non validi',
                    details,
                    traceId
                });
        }
        
        // Mappa al formato del generatore enhanced
        const reportData = {
            operator: value.operatore,
            operatorSignature: value.operatorSignature,
            kits: value.kits,
            location: value.location,
            dateLongFormat: value.dateLongFormat,
            thresholdDays: value.thresholdDays,
            revision: value.revision,
            logoPath: value.logoPath
        };
        
        const generator = new EnhancedPDFGenerator();
        const result = await generator.generateReport(reportData);
        
        return res.status(200)
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'ok',
                message: 'Report generato con successo',
                fileName: result.fileName,
                filePath: result.outputPath,
                downloadUrl: `/report/download?file=${result.fileName}`,
                traceId
            });
        
    } catch (error) {
        logError(traceId, error, { operation: 'generateReport', body: req.body });
        
        return res.status(500)
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'error',
                code: 'INTERNAL_ERROR',
                message: 'Errore interno durante la generazione del report',
                traceId
            });
    }
});

// Endpoint legacy per compatibilità - supporta GET e POST
app.all('/generate-pdf', async (req, res) => {
    const traceId = generateTraceId();
    
    // Gestione GET per informazioni sull'endpoint
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'info',
            message: 'Endpoint legacy per generazione PDF',
            usage: {
                method: 'POST',
                endpoint: '/generate-pdf',
                preferredEndpoint: '/report/generate',
                contentType: 'application/json'
            },
            traceId
        });
    }
    
    // Solo POST è consentito per la generazione
    if (req.method !== 'POST') {
        return res.status(405)
            .header('Allow', 'GET, POST, OPTIONS')
            .json({
                status: 'error',
                code: 'METHOD_NOT_ALLOWED',
                allowed: ['GET', 'POST'],
                message: `Metodo ${req.method} non consentito. Usa POST per generare o GET per info.`,
                traceId
            });
    }
    
    // Redirect alla nuova API per POST
    req.url = '/report/generate';
    return app._router.handle(req, res);
});





// Endpoint upload logo aziendale
app.post('/api/upload/logo', async (req, res) => {
    try {
        const { filename, data } = req.body || {};
        if (!data) {
            return res.status(400).json({ success: false, error: 'Dati mancanti: data (base64) richiesto' });
        }

        // Supporta data URL "data:image/png;base64,..." o solo base64
        let base64 = data;
        let mime = null;
        const dataUrlMatch = /^data:(.+);base64,(.*)$/.exec(data);
        if (dataUrlMatch) {
            mime = dataUrlMatch[1];
            base64 = dataUrlMatch[2];
        }

        const allowedMimes = ['image/png', 'image/jpeg', 'image/svg+xml'];
        if (mime && !allowedMimes.includes(mime)) {
            return res.status(400).json({ success: false, error: 'Formato immagine non supportato. Usa PNG, JPEG o SVG.' });
        }

        const buf = Buffer.from(base64, 'base64');
        if (!buf || !buf.length) {
            return res.status(400).json({ success: false, error: 'Base64 non valido' });
        }

        // Limite dimensione 2MB
        const maxSize = 2 * 1024 * 1024;
        if (buf.length > maxSize) {
            return res.status(400).json({ success: false, error: 'File troppo grande. Dimensione massima: 2 MB.' });
        }

        const safeName = (filename || 'logo.png').replace(/[^a-zA-Z0-9_.-]/g, '');
        const ext = path.extname(safeName).toLowerCase();
        const isAllowedExt = (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.svg');
        if (!isAllowedExt && !mime) {
            return res.status(400).json({ success: false, error: 'Formato non supportato. Usa PNG, JPEG o SVG.' });
        }
        const finalExt = isAllowedExt
            ? ext
            : (mime === 'image/jpeg' ? '.jpg' : (mime === 'image/png' ? '.png' : '.svg'));

        // Se SVG, sanifica markup per rimuovere tag/script/eventi per sicurezza
        const sanitizeSvg = (svgBuffer) => {
            try {
                let svg = svgBuffer.toString('utf-8');
                // Rimuove tutti i tag <script> e contenuto
                svg = svg.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
                // Rimuove attributi evento on* (onload, onclick, ecc.)
                svg = svg.replace(/on[a-z]+\s*=\s*"[^"]*"/gi, '');
                svg = svg.replace(/on[a-z]+\s*=\s*'[^']*'/gi, '');
                svg = svg.replace(/on[a-z]+\s*=\s*[^\s>]+/gi, '');
                // Facoltativo: disabilita xlink:href javascript:
                svg = svg.replace(/xlink:href\s*=\s*"javascript:[^"]*"/gi, '');
                return Buffer.from(svg, 'utf-8');
            } catch (e) {
                return svgBuffer; // fallback: non bloccare
            }
        };

        const ts = Date.now();
        const finalFile = `logo_${ts}${finalExt}`;
        const logosDir = path.join(__dirname, 'assets', 'loghi');
        try { fs.mkdirSync(logosDir, { recursive: true }); } catch {}

        const fullPath = path.join(logosDir, finalFile);
        if (finalExt === '.svg') {
            const clean = sanitizeSvg(buf);
            fs.writeFileSync(fullPath, clean);
        } else {
            fs.writeFileSync(fullPath, buf);
        }

        // Aggiorna settings con nuovo path relativo
        const relativePath = `assets/loghi/${finalFile}`;
        try {
            const settingsPath = path.join(__dirname, 'config', 'settings.json');
            const settingsRaw = fs.readFileSync(settingsPath, 'utf-8');
            const settings = JSON.parse(settingsRaw);
            settings.report = settings.report || {};
            settings.verification_report = settings.verification_report || {};
            settings.report.logo_path = relativePath;
            settings.verification_report.logo_path = relativePath;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        } catch (e) {
            // Non blocca l'upload; logga e continua
            console.warn('Impossibile aggiornare settings.json:', e.message);
        }

        res.json({ success: true, path: relativePath });
    } catch (error) {
        console.error('Errore upload logo:', error);
        res.status(500).json({ success: false, error: error.message || 'Errore interno' });
    }
});

// Endpoint per ottenere le impostazioni PDF
app.get('/api/pdf-settings', async (req, res) => {
    try {
        const pdfGenerator = new EnhancedPDFGenerator();
        const settings = await pdfGenerator.getSettings();
        
        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        console.error('Errore lettura impostazioni:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint per aggiornare le impostazioni PDF
app.post('/api/pdf-settings', async (req, res) => {
    try {
        const { section, key, value } = req.body;
        
        if (!section || !key || value === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Parametri mancanti: section, key e value sono obbligatori'
            });
        }

        const pdfGenerator = new EnhancedPDFGenerator();
        await pdfGenerator.updateSetting(section, key, value);
        
        res.json({
            success: true,
            message: 'Impostazione aggiornata con successo'
        });
    } catch (error) {
        console.error('Errore aggiornamento impostazioni:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint per verificare lo stato della configurazione
app.get('/api/email-status', (req, res) => {
    const { config } = require('./brevo-mailer');
    
    res.json({
        configured: !!(config.apiKey && config.senderEmail && config.senderName),
        senderEmail: config.senderEmail,
        senderName: config.senderName,
        hasApiKey: !!config.apiKey,
        outboxFile: config.outboxFile
    });
});

// Endpoint generazione PDF Richiesta d'ordine
const orderRequestSchema = Joi.object({
  city: Joi.string().min(1).max(100).required(),
  date: Joi.string().pattern(/^\d{2}\/\d{2}\/\d{4}$/).required(),
  operatorName: Joi.string().min(1).max(120).required(),
  operatorId: Joi.alternatives().try(Joi.string().min(1).max(50), Joi.number().integer().min(1)).required(),
  companyName: Joi.string().min(1).max(200).optional(),
  companyAddress: Joi.string().min(1).max(300).optional(),
  items: Joi.array().items(Joi.object({
    code: Joi.string().required(),
    name: Joi.string().required(),
    location: Joi.string().required(),
    reorderQty: Joi.number().integer().min(0).required(),
    expiryDate: Joi.string().allow('').optional(),
    type: Joi.string().valid('scadenza','quantita_zero','entrambi').required()
  })).min(1).required()
});

const { canonicalizeOrderData, signCanonicalData, appendLedger, findLedgerBySignatureId } = require('./services/signatureService');

app.post('/orders/generate-pdf', async (req, res) => {
  const traceId = generateTraceId();
  const startTime = Date.now();
  try {
    const { error, value } = orderRequestSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const details = (error.details || []).map(d => ({ field: d.path?.join('.') || 'unknown', message: d.message }));
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Dati non validi', details, traceId });
    }

    // Verifica directory di output e permessi di scrittura
    try {
      const outputDir = path.join(__dirname, 'output', 'ordini');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      fs.accessSync(outputDir, fs.constants.W_OK);
    } catch (fsErr) {
      console.error(`[${new Date().toISOString()}] [${traceId}] FS_PERMISSION_DENIED:`, fsErr);
      return res.status(500).json({ success: false, code: 'FS_PERMISSION_DENIED', message: 'Permessi di scrittura insufficienti per la directory di output', details: fsErr.message, traceId });
    }

    // Recupera logo e firma da settings.json se disponibili, con supporto per firma caricata
    let logoPath;
    let signaturePath;
    let operatorRole;
    let tempSignaturePath;
    try {
      const settingsPath = path.join(__dirname, 'config', 'settings.json');
      const settingsRaw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsRaw);
      logoPath = settings?.report?.logo_path ? path.join(__dirname, settings.report.logo_path) : undefined;
      // Normalizza nome operatore per matching robusto (case-insensitive, spazi e accenti)
      const normalize = (s) => String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const normalizeFile = (s) => normalize(s).replace(/\s/g, '_');
      const selectedOp = (settings?.operatori || []).find(op => normalize(op.nome) === normalize(value.operatorName));

      // 1) Se la richiesta include una firma dell'operatore (data URL o percorso), usala prima
      const isDataUrlImage = (str) => typeof str === 'string' && /^data:image\/(png|jpe?g);base64,/i.test(str);
      if (value.operatorSignature && typeof value.operatorSignature === 'string') {
        if (isDataUrlImage(value.operatorSignature)) {
          // Salva data URL come PNG temporaneo
          try {
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const mimeMatch = value.operatorSignature.match(/^data:image\/(png|jpe?g);base64,/i);
            const ext = (mimeMatch && mimeMatch[1] && mimeMatch[1].toLowerCase().startsWith('png')) ? '.png' : '.jpg';
            const base64 = value.operatorSignature.replace(/^data:image\/(png|jpe?g);base64,/i, '');
            const buf = Buffer.from(base64, 'base64');
            tempSignaturePath = path.join(tempDir, `firma_${Date.now()}${ext}`);
            fs.writeFileSync(tempSignaturePath, buf);
            signaturePath = tempSignaturePath;
          } catch (sigSaveErr) {
            if (process.env.NODE_ENV === 'development') console.warn(`[${new Date().toISOString()}] [${traceId}] SIGNATURE_DATAURL_SAVE_FAILED:`, sigSaveErr.message);
          }
        } else {
          // Tratta come percorso file
          let candidate = value.operatorSignature;
          if (!path.isAbsolute(candidate)) candidate = path.join(__dirname, candidate);
          if (fs.existsSync(candidate)) {
            signaturePath = candidate;
          }
        }
      }

      // 2) Se non presente, usa la firma configurata nello user settings.json
      if (!signaturePath && selectedOp?.firma_png_path) {
        signaturePath = path.join(__dirname, selectedOp.firma_png_path);
      }

      // 3) Fallback: assets/firme/<nome_cognome_normalizzato>.png
      if (!signaturePath) {
        const candidate = path.join(__dirname, 'assets', 'firme', `${normalizeFile(value.operatorName)}.png`);
        if (fs.existsSync(candidate)) {
          signaturePath = candidate;
        }
      }
      if (selectedOp?.ruolo) {
        operatorRole = selectedOp.ruolo;
      }
      // Verifica permessi di lettura su logo e firma
      try {
        if (logoPath) fs.accessSync(logoPath, fs.constants.R_OK);
      } catch (logoErr) {
        if (process.env.NODE_ENV === 'development') console.warn(`[${new Date().toISOString()}] [${traceId}] LOGO_READ_DENIED:`, logoErr.message);
        logoPath = undefined; // fallback senza logo
      }
      try {
        if (signaturePath) fs.accessSync(signaturePath, fs.constants.R_OK);
      } catch (sigErr) {
        if (process.env.NODE_ENV === 'development') console.warn(`[${new Date().toISOString()}] [${traceId}] SIGNATURE_READ_DENIED:`, sigErr.message);
        signaturePath = undefined; // verrà mostrato placeholder firma
      }
    } catch (e) {
      // Ignora errori di lettura settings, logga in development
      if (process.env.NODE_ENV === 'development') console.warn(`[${new Date().toISOString()}] [${traceId}] Settings read warning:`, e.message);
    }

    // Firma digitale del contenuto
    const canonical = canonicalizeOrderData({ operatorId: value.operatorId, operatorName: value.operatorName, city: value.city, date: value.date, items: value.items, traceId });
    const { signature, signatureAlgo, signatureId, signedAt, publicKeyFingerprint } = signCanonicalData(canonical);
    const verificationUrl = `http://localhost:${PORT}/orders/verify-signature/${signatureId}`;
    appendLedger({ signatureId, signedAt, traceId, signatureAlgo, publicKeyFingerprint, canonical });

    const result = await generateOrderPDF({ city: value.city, date: value.date, operatorName: value.operatorName, operatorId: value.operatorId, companyName: value.companyName, companyAddress: value.companyAddress, items: value.items, logoPath, signaturePath, operatorRole, signedAt, signature, signatureAlgo, signatureId, verificationUrl });
    // Pulisci eventuale firma temporanea
    try { if (tempSignaturePath) fs.unlinkSync(tempSignaturePath); } catch {}
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] [${traceId}] ORDER_PDF_SUCCESS`, { outputPath: result.outputPath, duration: `${duration}ms` });
    return res.json({ success: true, outputPath: result.outputPath, outputUrl: result.outputUrl, previewUrl: result.outputUrl, traceId, signatureId, signedAt });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] [${traceId}] ORDER_PDF_ERROR after ${duration}ms:`, err);
    let code = 'INTERNAL_ERROR';
    const msg = err && err.message ? err.message : 'Errore interno';
    if (/Parametri mancanti/i.test(msg)) code = 'MISSING_PARAMETERS';
    else if (/EACCES|permission/i.test(msg)) code = 'FS_PERMISSION_DENIED';
    else if (/ENOENT|not found/i.test(msg)) code = 'FILE_NOT_FOUND';
    else if (/PDF|pdfkit|document/i.test(msg)) code = 'PDF_RENDER_ERROR';

    return res.status(500).json({ success: false, code, message: 'Errore interno durante la generazione del PDF', details: process.env.NODE_ENV === 'development' ? msg : undefined, traceId });
  }
});

// Endpoint verifica firma digitale
app.get('/orders/verify-signature/:signatureId', async (req, res) => {
  const signatureId = req.params.signatureId;
  try {
    const entry = findLedgerBySignatureId(signatureId);
    if (!entry) {
      return res.status(404).json({ success: false, code: 'SIGNATURE_NOT_FOUND', message: 'Firma non trovata' });
    }
    // Nota: verifica completa richiede chiave pubblica o segreto; qui confermiamo integrità registrata
    return res.json({ success: true, signatureId, signedAt: entry.signedAt, traceId: entry.traceId, signatureAlgo: entry.signatureAlgo, publicKeyFingerprint: entry.publicKeyFingerprint });
  } catch (e) {
    return res.status(500).json({ success: false, code: 'VERIFY_ERROR', message: e.message });
  }
});

// Serve l'applicazione principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});



// Endpoint dedicato: generazione report diagnostico errore 500
app.post('/report/generate/error500', async (req, res) => {
    const traceId = generateTraceId();
    const startTime = Date.now();
    try {
        const { error, value } = error500ReportSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const validationErrors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));

            logInfo('Errore validazione input error500', { traceId, errors: validationErrors });

            return res.status(400)
                .header('Content-Type', 'application/json; charset=utf-8')
                .json({
                    status: 'error',
                    code: 'VALIDATION_ERROR',
                    message: 'Dati di input non validi',
                    details: validationErrors,
                    traceId
                });
        }

        const generator = new Error500ReportGenerator();
        const result = await generator.generate(value);

        const duration = Date.now() - startTime;
        logInfo('Report errore 500 generato con successo', { traceId, filePath: result.outputPath, duration: `${duration}ms` });

        return res.status(200)
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'success',
                message: 'Report errore 500 generato con successo',
                data: {
                    fileName: result.fileName,
                    filePath: result.outputPath,
                    downloadUrl: `/report/download?file=${encodeURIComponent(result.fileName)}`,
                    generationTime: duration
                },
                traceId
            });

    } catch (error) {
        const duration = Date.now() - startTime;
        logError(traceId, error, { operation: 'generateError500Report', duration: `${duration}ms`, body: req.body });
        return res.status(500)
            .header('Content-Type', 'application/json; charset=utf-8')
            .json({
                status: 'error',
                code: 'INTERNAL_ERROR',
                message: 'Errore interno durante la generazione del report errore 500',
                traceId
            });
    }
});

// Middleware per gestire errori 404 e 405
app.use((req, res, next) => {
    const traceId = generateTraceId();
    
    // Consenti pass-through per health check definito successivamente
    if (req.path === '/api/health') {
        return next();
    }
    
    // Ignora richieste di sviluppo (Vite, HMR, etc.)
    const devPaths = [
        '/@vite/',
        '/@fs/',
        '/node_modules/',
        '/__vite_ping',
        '/favicon.ico'
    ];
    
    if (devPaths.some(path => req.path.startsWith(path))) {
        res.status(404).end();
        return;
    }
    
    // Verifica se il path esiste ma con metodo diverso
    const routes = [
        { path: '/api/send-email', methods: ['POST'] },
        { path: '/api/flush-outbox', methods: ['POST'] },
        { path: '/report/generate', methods: ['POST'] },

        { path: '/report/generate/error500', methods: ['POST'] },
        { path: '/report/download', methods: ['GET'] },
        { path: '/generate-pdf', methods: ['POST'] },
        { path: '/api/pdf-settings', methods: ['GET', 'POST'] },
        { path: '/api/upload/logo', methods: ['POST'] },
        { path: '/api/email-status', methods: ['GET'] },
        { path: '/', methods: ['GET'] }
    ];
    
    const matchingRoute = routes.find(route => route.path === req.path);
    
    if (matchingRoute && !matchingRoute.methods.includes(req.method)) {
        // Errore 405 - Metodo non consentito
        logError(traceId, new Error(`Method ${req.method} not allowed for ${req.path}`), {
            method: req.method,
            path: req.path,
            allowedMethods: matchingRoute.methods,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        
        res.status(405).json({
            error: 'Method Not Allowed',
            message: `Il metodo ${req.method} non è consentito per questo endpoint`,
            allowedMethods: matchingRoute.methods,
            traceId: traceId,
            timestamp: new Date().toISOString()
        });
        return;
    }
    
    // Errore 404 - Risorsa non trovata (solo per richieste non di sviluppo)
    logError(traceId, new Error(`Route not found: ${req.method} ${req.path}`), {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    
    res.status(404).json({
        error: 'Not Found',
        message: 'La risorsa richiesta non è stata trovata',
        path: req.path,
        method: req.method,
        traceId: traceId,
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', port: PORT, timestamp: new Date().toISOString() });
});

// Gestione errori globali con JSON strutturato
app.use((error, req, res, next) => {
    const traceId = generateTraceId();
    
    logError(traceId, error, { 
        operation: 'globalErrorHandler',
        method: req.method,
        url: req.url 
    });
    
    res.status(500)
        .header('Content-Type', 'application/json; charset=utf-8')
        .json({
            status: 'error',
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Errore interno del server',
            traceId
        });
});

// Avvio server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server First Aid Manager avviato su http://localhost:${PORT}`);
    console.log(`📧 Endpoint email: http://localhost:${PORT}/api/send-email`);
    console.log(`📄 Endpoint PDF: http://localhost:${PORT}/generate-pdf`);
    
    // Auto-flush outbox all'avvio se configurato
    if (process.env.AUTO_FLUSH_OUTBOX === 'true') {
        setTimeout(() => {
            flushOutbox().catch(error => {
                console.error('Errore auto-flush outbox all\'avvio:', error.message);
            });
        }, 5000);
    }
});

// Server error handling for port conflicts and runtime issues
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} già in uso. Chiudere istanze duplicate o cambiare PORT.`);
    process.exit(1);
  }
  console.error('Errore server:', err);
});

// Aumenta i timeout per richieste lunghe (es. generazione PDF)
server.setTimeout(5 * 60 * 1000); // 5 minuti
server.keepAliveTimeout = 60 * 1000; // 60s
server.headersTimeout = 65 * 1000; // 65s

module.exports = app;

// Schema Joi per report verifica primo soccorso

// Schema Joi per report diagnostico errore 500
const error500ReportSchema = Joi.object({
    revisione: Joi.object({
        versione: Joi.string().min(2).required()
    }).required(),
    company: Joi.object({
        logo_path: Joi.string().optional().allow('', null)
    }).optional(),
    user: Joi.object({
        nome_operatore: Joi.string().min(1).max(100).required()
    }).required(),
    report: Joi.object({
        data: Joi.object({
            descrizione: Joi.string().required(),
            analisi: Joi.string().required(),
            logs: Joi.array().items(Joi.string()).optional(),
            causa: Joi.string().required(),
            soluzione: Joi.string().required(),
            test: Joi.string().required(),
            stato: Joi.string().required()
        }).required()
    }).required()
});
// Fallback parser per JSON inviato come stringa (compatibilità client)
app.use((req, res, next) => {
  try {
    const ct = req.headers['content-type'] || '';
    const isJson = ct.toLowerCase().includes('application/json');
    if (isJson && typeof req.body === 'string') {
      req.body = JSON.parse(req.body);
    }
    next();
  } catch (e) {
    const traceId = generateTraceId();
    logInfo('Invalid JSON body (fallback parser)', { traceId, error: e.message });
    return res.status(400).json({
      status: 'error',
      code: 'BAD_REQUEST',
      message: 'Invalid JSON body',
      traceId
    });
  }
});