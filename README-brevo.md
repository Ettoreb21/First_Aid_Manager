# 📧 AssistBot - Invio Email via Brevo (SMTP/API)

Questa guida descrive la configurazione dell’invio email in First Aid Manager tramite Brevo (Sendinblue), con supporto sia API v3 sia SMTP.
Di seguito i passi per l’account mittente `assistenza.tecnica@isokit.it` con nome "Assistenza Tecnica ISOKIT".

## Dipendenze

```
npm install nodemailer dotenv
```

## Configurazione `.env`
Imposta il provider e le variabili Brevo (vedi `.env.example` aggiornato):

```
EMAIL_PROVIDER=brevo

# Mittente
BREVO_SENDER_EMAIL=assistenza.tecnica@isokit.it
BREVO_SENDER_NAME=Assistenza Tecnica ISOKIT
BREVO_REPLY_TO=assistenza.tecnica@isokit.it

# Chiavi
# - API v3: xkeysib-...
# - SMTP:   xsmtpsib-...
BREVO_API_KEY=xsmtpsib-REPLACE_WITH_YOUR_SMTP_KEY

# SMTP Brevo
BREVO_SMTP_ENABLE=true
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_SECURE=false   # usa true se scegli la porta 465
BREVO_SMTP_USER=assistenza.tecnica@isokit.it
BREVO_SMTP_PASS=xsmtpsib-REPLACE_WITH_YOUR_SMTP_KEY
```

Note:
- Per usare SMTP, genera una "SMTP key" in Brevo (prefisso `xsmtpsib-`).
- Username è in genere l’email di login dell’account.
- Puoi usare STARTTLS su 587 (`BREVO_SMTP_SECURE=false`) o SSL/TLS su 465 (`true`).

## Servizio email
`services/emailService.js` esporta `sendEmail(toEmail, subject, htmlContent)` e seleziona automaticamente:
- Brevo SMTP se `BREVO_SMTP_ENABLE=true` oppure se la chiave ha prefisso `xsmtpsib-`
- Brevo API v3 se la chiave ha prefisso `xkeysib-`

## Test di invio
Invio rapido di prova:

```
node scripts/send-to-ettore.js
```

Oppure verifica solo trasporto:

```
node scripts/verify-smtp.js
```

## Test manuale
Esegui:

```
node scripts/test-assistbot-email.js
```

Dovresti vedere un log con `[AssistBot] Email inviata a ... (messageId=...)`.

## Limiti & policy di invio
- Attieniti alle policy di invio Brevo (rate, contenuti, reputazione dominio).
- Imposta un limite applicativo se necessario nei tuoi job (non gestito qui).

## Autenticazione del dominio (SPF/DKIM/DMARC)
Per garantire deliverability e autenticità:
- SPF: pubblica un record TXT `v=spf1 include:spf.brevo.com ~all` nel DNS del dominio.
- DKIM: configura i record CNAME/TXT forniti da Brevo per il tuo dominio (`mail._domainkey`).
- DMARC: aggiungi un record TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com; ruf=mailto:dmarc@yourdomain.com` e adegua la policy.

Esegui la verifica in Brevo per il dominio `isokit.it` finché SPF/DKIM risultano validi.

## Editor UI Configurazione SMTP

Per modificare le impostazioni SMTP dall’interfaccia:

- Vai in `Impostazioni` > tab `SMTP`.
- L’editor è identificato dal div `#smtp-config-editor` e mostra i campi host, porta, username, password e l’opzione `TLS`.
- Permessi di modifica:
  - Serve un `x-api-key` valido (memorizzato come `localStorage.fam_api_key`) oppure l’abilitazione amministrativa tramite la chiave `ui.edit.smtp.enabled`.
  - Se i permessi mancano, i campi sono in sola lettura e compare un messaggio di richiesta permessi.
- Salvataggio:
  - Manuale: pulsante `Salva Configurazione SMTP`.
  - Automatico: attiva il toggle `Salvataggio automatico`; le modifiche vengono salvate dopo ~1.2s di inattività.
- Test: inserisci l’email di test e premi `Test Invio Email`.

Le modifiche vengono inviate all’API `/api/settings/bulk` (autenticata tramite `x-api-key`) e replicate localmente come fallback.

## Post-deploy checklist
- `.env` presente e correttamente compilato.
- Server ha accesso ad Internet in uscita (porta 587/465).
- Test di invio riuscito con destinatario reale.
- Mittente e autenticazione dominio (SPF/DKIM/DMARC) OK.

## Sicurezza
- Non inserire credenziali nel codice o nei log.
- Ruota le chiavi SMTP/API in caso di esposizione.
- Limita l’accesso al file `.env` e al server.
