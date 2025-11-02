/**
 * Brevo Email Service Integration
 * Modulo per l'invio di email tramite API Brevo con gestione avanzata degli errori
 * 
 * Requisiti:
 * - Node.js 18+ (utilizza fetch nativo)
 * - Variabili ambiente configurate (vedi .env.example)
 */

const fs = require('fs').promises;
const path = require('path');

// Configurazione da variabili ambiente
const config = {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL,
    senderName: process.env.BREVO_SENDER_NAME,
    replyTo: process.env.BREVO_REPLY_TO,
    defaultTags: process.env.BREVO_DEFAULT_TAGS?.split(',').map(tag => tag.trim()) || [],
    outboxFile: process.env.OUTBOX_FILE || './outbox.json',
    maxRetries: parseInt(process.env.BREVO_MAX_RETRIES) || 3,
    timeout: parseInt(process.env.BREVO_TIMEOUT) || 30000,
    logLevel: process.env.LOG_LEVEL || 'info'
};

// Endpoint API Brevo
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Logger sicuro che non espone informazioni sensibili
 */
class SecureLogger {
    static log(level, message, data = {}) {
        if (!this.shouldLog(level)) return;
        
        const timestamp = new Date().toISOString();
        const sanitizedData = this.sanitizeData(data);
        
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, 
            Object.keys(sanitizedData).length > 0 ? sanitizedData : '');
    }
    
    static shouldLog(level) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        return levels[level] >= levels[config.logLevel];
    }
    
    static sanitizeData(data) {
        const sanitized = { ...data };
        
        // Rimuovi informazioni sensibili
        delete sanitized.apiKey;
        delete sanitized.api_key;
        delete sanitized.password;
        delete sanitized.token;
        
        // Tronca response body se troppo lungo
        if (sanitized.responseBody && sanitized.responseBody.length > 1024) {
            sanitized.responseBody = sanitized.responseBody.substring(0, 1024) + '... [troncato]';
        }
        
        return sanitized;
    }
    
    static info(message, data) { this.log('info', message, data); }
    static warn(message, data) { this.log('warn', message, data); }
    static error(message, data) { this.log('error', message, data); }
    static debug(message, data) { this.log('debug', message, data); }
}

/**
 * Validatore per i parametri email
 */
class EmailValidator {
    static validate(params) {
        const errors = [];
        
        // Campo 'to' obbligatorio
        if (!params.to || (Array.isArray(params.to) && params.to.length === 0)) {
            errors.push('Campo "to" obbligatorio');
        }
        
        // Validazione email format per 'to'
        if (params.to) {
            const emails = Array.isArray(params.to) ? params.to : [params.to];
            emails.forEach(email => {
                if (typeof email === 'string') {
                    if (!this.isValidEmail(email)) {
                        errors.push(`Email non valida: ${email}`);
                    }
                } else if (email && typeof email === 'object') {
                    if (!email.email || !this.isValidEmail(email.email)) {
                        errors.push(`Email non valida nell'oggetto destinatario: ${email.email}`);
                    }
                }
            });
        }
        
        // Lunghezza subject ≤ 255 caratteri
        if (params.subject && params.subject.length > 255) {
            errors.push('Subject deve essere ≤ 255 caratteri');
        }
        
        // Presenza di almeno uno tra 'html' o 'text'
        if (!params.html && !params.text) {
            errors.push('Deve essere presente almeno uno tra "html" o "text"');
        }
        
        return errors;
    }
    
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    static sanitizeSubject(subject) {
        if (!subject) return subject;
        
        // Rimuovi caratteri potenzialmente pericolosi
        return subject
            .replace(/[\r\n]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 255);
    }
}

/**
 * Gestore per il sistema di retry con backoff esponenziale
 */
class RetryHandler {
    static async executeWithRetry(operation, maxRetries = config.maxRetries) {
        let lastError;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();
                
                if (attempt > 0) {
                    SecureLogger.info(`Operazione riuscita al tentativo ${attempt + 1}`);
                }
                
                return result;
            } catch (error) {
                lastError = error;
                
                // Non fare retry per errori 4xx (eccetto 429)
                if (error.status >= 400 && error.status < 500 && error.status !== 429) {
                    SecureLogger.error('Errore client non recuperabile', { 
                        status: error.status, 
                        message: error.message 
                    });
                    throw error;
                }
                
                if (attempt < maxRetries) {
                    const delay = this.calculateDelay(attempt);
                    SecureLogger.warn(`Tentativo ${attempt + 1} fallito, retry tra ${delay}ms`, {
                        status: error.status,
                        message: error.message
                    });
                    
                    await this.sleep(delay);
                } else {
                    SecureLogger.error(`Tutti i ${maxRetries + 1} tentativi falliti`, {
                        status: error.status,
                        message: error.message
                    });
                }
            }
        }
        
        throw lastError;
    }
    
    static calculateDelay(attempt) {
        // Backoff esponenziale: 500ms → 1s → 2s
        return Math.min(500 * Math.pow(2, attempt), 2000);
    }
    
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Gestore per il sistema outbox
 */
class OutboxManager {
    static async addToOutbox(emailPayload) {
        try {
            let outbox = [];
            
            // Leggi outbox esistente
            try {
                const data = await fs.readFile(config.outboxFile, 'utf8');
                outbox = JSON.parse(data);
            } catch (error) {
                // File non esiste o è vuoto, inizializza array vuoto
                if (error.code !== 'ENOENT') {
                    SecureLogger.warn('Errore lettura outbox, inizializzo nuovo file', { error: error.message });
                }
            }
            
            // Aggiungi nuovo messaggio
            const outboxItem = {
                id: this.generateId(),
                timestamp: new Date().toISOString(),
                payload: emailPayload,
                attempts: 0
            };
            
            outbox.push(outboxItem);
            
            // Salva outbox
            await fs.writeFile(config.outboxFile, JSON.stringify(outbox, null, 2));
            
            SecureLogger.info('Email aggiunta all\'outbox', { 
                outboxId: outboxItem.id,
                outboxSize: outbox.length 
            });
            
            return outboxItem.id;
        } catch (error) {
            SecureLogger.error('Errore aggiunta email all\'outbox', { error: error.message });
            throw error;
        }
    }
    
    static async getOutbox() {
        try {
            const data = await fs.readFile(config.outboxFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    
    static async removeFromOutbox(id) {
        try {
            const outbox = await this.getOutbox();
            const filtered = outbox.filter(item => item.id !== id);
            await fs.writeFile(config.outboxFile, JSON.stringify(filtered, null, 2));
            
            SecureLogger.info('Email rimossa dall\'outbox', { outboxId: id });
        } catch (error) {
            SecureLogger.error('Errore rimozione email dall\'outbox', { 
                outboxId: id, 
                error: error.message 
            });
        }
    }
    
    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}

/**
 * Funzione principale per l'invio email tramite Brevo
 */
async function sendBrevoEmail(params) {
    // Validazione configurazione
    if (!config.apiKey || !config.senderEmail || !config.senderName) {
        throw new Error('Configurazione Brevo incompleta. Verifica le variabili ambiente.');
    }
    
    // Validazione parametri
    const validationErrors = EmailValidator.validate(params);
    if (validationErrors.length > 0) {
        throw new Error(`Errori di validazione: ${validationErrors.join(', ')}`);
    }
    
    // Helper: normalizza destinatari per Brevo API (richiede oggetti { email, name? })
    const normalizeRecipients = (recipients) => {
        const list = Array.isArray(recipients) ? recipients : [recipients];
        return list
            .filter(r => !!r)
            .map(r => {
                if (typeof r === 'string') {
                    return { email: r };
                }
                if (typeof r === 'object' && r.email) {
                    return { email: r.email, name: r.name };
                }
                // Fallback: ignora voci non valide
                return null;
            })
            .filter(Boolean);
    };

    // Prepara payload per API Brevo con formati corretti
    const combinedTags = [...(config.defaultTags || []), ...(params.tags || [])].filter(t => !!t && t.trim && t.trim() !== '');
    const payload = {
        sender: {
            email: config.senderEmail,
            name: config.senderName
        },
        to: normalizeRecipients(params.to),
        subject: EmailValidator.sanitizeSubject(params.subject),
        htmlContent: params.html,
        textContent: params.text,
        replyTo: params.replyTo ? { email: params.replyTo } : 
                 config.replyTo ? { email: config.replyTo } : undefined
    };
    if (combinedTags.length > 0) {
        payload.tags = combinedTags;
    }
    
    // Aggiungi CC e BCC se presenti
    if (params.cc) {
        const ccList = normalizeRecipients(params.cc);
        if (ccList.length) payload.cc = ccList;
    }
    if (params.bcc) {
        const bccList = normalizeRecipients(params.bcc);
        if (bccList.length) payload.bcc = bccList;
    }
    
    // Rimuovi campi undefined
    Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
            delete payload[key];
        }
    });
    
    const requestId = OutboxManager.generateId();
    
    try {
        SecureLogger.info('Invio email in corso', { 
            requestId,
            to: payload.to.length,
            subject: payload.subject?.substring(0, 50) + '...' 
        });
        
        const result = await RetryHandler.executeWithRetry(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);
            
            try {
                const response = await fetch(BREVO_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'api-key': config.apiKey
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                const responseText = await response.text();
                let responseData;
                
                try {
                    responseData = JSON.parse(responseText);
                } catch {
                    responseData = { raw: responseText };
                }
                
                if (!response.ok) {
                    const error = new Error(`Brevo API Error: ${response.status} ${response.statusText}`);
                    error.status = response.status;
                    error.response = responseData;
                    // Log dettagli dell'errore API (sanificati)
                    SecureLogger.error('Brevo API risposta di errore', {
                        status: response.status,
                        statusText: response.statusText,
                        responseBody: typeof responseData === 'string' ? responseData : JSON.stringify(responseData)
                    });
                    throw error;
                }
                
                SecureLogger.info('Email inviata con successo', {
                    requestId,
                    status: response.status,
                    messageId: responseData.messageId
                });
                
                return {
                    success: true,
                    messageId: responseData.messageId,
                    requestId
                };
                
            } catch (error) {
                clearTimeout(timeoutId);
                
                if (error.name === 'AbortError') {
                    const timeoutError = new Error('Timeout richiesta');
                    timeoutError.status = 408;
                    throw timeoutError;
                }
                
                throw error;
            }
        });
        
        return result;
        
    } catch (error) {
        SecureLogger.error('Invio email fallito definitivamente', {
            requestId,
            status: error.status,
            message: error.message,
            responseBody: error.response ? (typeof error.response === 'string' ? error.response : JSON.stringify(error.response)) : undefined
        });
        
        // Aggiungi all'outbox per retry futuro
        try {
            const outboxId = await OutboxManager.addToOutbox({
                ...params,
                originalRequestId: requestId,
                failureReason: error.message,
                failureStatus: error.status,
                failureResponse: error.response
            });
            
            return {
                success: false,
                error: error.message,
                outboxId,
                requestId
            };
        } catch (outboxError) {
            SecureLogger.error('Errore aggiunta all\'outbox', { 
                requestId,
                error: outboxError.message 
            });
            
            // Se anche l'outbox fallisce, rilancia l'errore originale
            throw error;
        }
    }
}

/**
 * Helper semplificato per invii base
 */
async function sendBrevoSimple(to, subject, html) {
    return await sendBrevoEmail({ to, subject, html });
}

/**
 * Invii multipli con gestione concorrenza
 */
async function sendBrevoBulk({ recipients, subject, htmlTemplate, paramsList = [], concurrency = 5 }) {
    if (!recipients || recipients.length === 0) {
        throw new Error('Lista recipients vuota');
    }
    
    if (recipients.length !== paramsList.length && paramsList.length > 0) {
        throw new Error('Lunghezza recipients e paramsList deve coincidere');
    }
    
    const results = [];
    const chunks = [];
    
    // Dividi in chunk per gestire concorrenza
    for (let i = 0; i < recipients.length; i += concurrency) {
        chunks.push(recipients.slice(i, i + concurrency));
    }
    
    SecureLogger.info('Avvio invio bulk', {
        totalRecipients: recipients.length,
        chunks: chunks.length,
        concurrency
    });
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const chunkPromises = chunk.map(async (recipient, index) => {
            const globalIndex = chunkIndex * concurrency + index;
            const params = paramsList[globalIndex] || {};
            
            // Sostituisci placeholder nel template HTML
            let html = htmlTemplate;
            if (params && typeof params === 'object') {
                Object.keys(params).forEach(key => {
                    const placeholder = new RegExp(`{{${key}}}`, 'g');
                    html = html.replace(placeholder, params[key] || '');
                });
            }
            
            try {
                const result = await sendBrevoEmail({
                    to: recipient,
                    subject,
                    html
                });
                
                return {
                    recipient,
                    success: result.success,
                    messageId: result.messageId,
                    requestId: result.requestId,
                    outboxId: result.outboxId
                };
            } catch (error) {
                return {
                    recipient,
                    success: false,
                    error: error.message
                };
            }
        });
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
        
        SecureLogger.info(`Chunk ${chunkIndex + 1}/${chunks.length} completato`, {
            successful: chunkResults.filter(r => r.success).length,
            failed: chunkResults.filter(r => !r.success).length
        });
        
        // Pausa tra chunk per evitare rate limiting
        if (chunkIndex < chunks.length - 1) {
            await RetryHandler.sleep(100);
        }
    }
    
    const summary = {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
    };
    
    SecureLogger.info('Invio bulk completato', {
        total: summary.total,
        successful: summary.successful,
        failed: summary.failed
    });
    
    return summary;
}

/**
 * Ritentativo invio messaggi dall'outbox
 */
async function flushOutbox() {
    try {
        const outbox = await OutboxManager.getOutbox();
        
        if (outbox.length === 0) {
            SecureLogger.info('Outbox vuota, nessun messaggio da reinviare');
            return { processed: 0, successful: 0, failed: 0 };
        }
        
        SecureLogger.info(`Elaborazione outbox: ${outbox.length} messaggi`);
        
        let successful = 0;
        let failed = 0;
        
        for (const item of outbox) {
            try {
                item.attempts = (item.attempts || 0) + 1;
                
                SecureLogger.info(`Ritentativo invio messaggio outbox`, {
                    outboxId: item.id,
                    attempt: item.attempts
                });
                
                const result = await sendBrevoEmail(item.payload);
                
                if (result.success) {
                    await OutboxManager.removeFromOutbox(item.id);
                    successful++;
                    
                    SecureLogger.info('Messaggio outbox inviato con successo', {
                        outboxId: item.id,
                        messageId: result.messageId
                    });
                } else {
                    failed++;
                    SecureLogger.warn('Messaggio outbox fallito nuovamente', {
                        outboxId: item.id,
                        error: result.error
                    });
                }
                
            } catch (error) {
                failed++;
                SecureLogger.error('Errore elaborazione messaggio outbox', {
                    outboxId: item.id,
                    error: error.message
                });
            }
            
            // Pausa tra messaggi
            await RetryHandler.sleep(200);
        }
        
        const summary = {
            processed: outbox.length,
            successful,
            failed
        };
        
        SecureLogger.info('Elaborazione outbox completata', summary);
        
        return summary;
        
    } catch (error) {
        SecureLogger.error('Errore elaborazione outbox', { error: error.message });
        throw error;
    }
}

// Export delle funzioni pubbliche
module.exports = {
    sendBrevoEmail,
    sendBrevoSimple,
    sendBrevoBulk,
    flushOutbox,
    
    // Utility per testing e debugging
    config: { ...config, apiKey: '[HIDDEN]' }, // Nascondi API key nei log
    OutboxManager,
    SecureLogger
};

// Auto-flush outbox all'avvio se configurato
if (process.env.AUTO_FLUSH_OUTBOX === 'true') {
    setTimeout(() => {
        flushOutbox().catch(error => {
            SecureLogger.error('Errore auto-flush outbox all\'avvio', { error: error.message });
        });
    }, 5000);
}