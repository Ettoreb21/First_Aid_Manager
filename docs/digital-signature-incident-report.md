Titolo: Indagine e Ripristino Funzionalità Firma Digitale (PNG e Crypto)

Data: 2025-11-01
Ambiente: First_Aid_Manager (Node.js, PDFKit, Java PDFBox)

Obiettivo
- Ripristinare la piena funzionalità di firma digitale, garantendo che `input` possa acquisire correttamente la firma scannerizzata (PNG) caricata dall’utente e che la firma crittografica (digest) venga generata e verificata.

Sintomo
- In alcuni ordini, nel PDF appare il placeholder “Firma non disponibile” al posto della firma scannerizzata.

Fasi Operative e Risultati

1) Verifica stato del servizio di firma digitale
- Backend attivo: server avviato su `http://localhost:3000` (log: “Server First Aid Manager avviato …”).
- Connettività remota: non applicabile. Il servizio di firma è locale (Node `crypto`). Non usa server remoti esterni.
- Risorse di sistema: non risultano saturazioni dal log runtime; generazione PDF completata in ~200–300ms.

2) Controllo configurazione certificato digitale
- Implementazione: `services/signatureService.js` supporta due modalità:
  - RSA: richiede `SIGN_PRIVATE_KEY_PEM` e `SIGN_PUBLIC_KEY_PEM` in `.env`.
  - Fallback HMAC-SHA256: usa `SIGN_SECRET` se non sono disponibili le chiavi RSA.
- Keystore: non presente. Le chiavi sono lette da variabili d’ambiente PEM (stringhe). Nessun keystore esterno.
- Validità/Revoca: non applicabile (chiavi locali PEM, non certificati X.509 verificati contro CRL/OCSP).
- Permessi accesso: le chiavi vengono lette da env; non risultano errori di permesso.

3) Analisi log di sistema/applicativi
- Log backend: `ORDER_PDF_SUCCESS` con `signatureId`, `signedAt` indica firma digitale generata correttamente.
- Log firma immagine PNG: placeholder “Firma non disponibile” appare se `signaturePath` è assente o non leggibile.
- Log directory firme: nel passato sono presenti “Firma non trovata … in assets/firme” per operatori non configurati; per operatori configurati (Admin, Operatore 1) la firma è trovata.

4) Verifica componenti di firma
- Librerie crittografiche: Node `crypto` ok; PDFKit per rendering immagine; Java PDFBox per generatore report compatibile.
- Compatibilità: non emersi conflitti di versione; generazione PDF e firma digitale completano.
- Configurazione: server aggiorna e passa `signaturePath` all’order-pdf-generator in modo robusto.

5) Test end-to-end con certificato di prova
- Test API: `node test-order-endpoint.js` → risposta 200 con `signatureId` e `outputUrl` del PDF generato.
- Verifica flusso: firma digitale generata (`signatureId`), ledger aggiornato (`output/signatures.json`).
- Firma scannerizzata: confermata la pipeline lato server (data URL → PNG temporaneo; `settings.json`; fallback `assets/firme`), con posizionamento immediatamente sotto la tabella e proporzioni mantenute.

Root Cause
- Il placeholder “Firma non disponibile” si verifica quando `signaturePath` non viene risolto o non è leggibile per l’ordine specifico. Le cause principali:
  - La UI non invia `operatorSignature` (data URL) per l’operatore selezionato.
  - L’operatore non è configurato in `config/settings.json` (`operatori[].firma_png_path`) e non esiste il file `assets/firme/<nome_cognome>.png` normalizzato.
  - Permessi di lettura negati sul file immagine (raro ma gestito con fallback).

Soluzione Implementata
- Server (`server.js`):
  - Supporto `operatorSignature`: se è una data URL PNG/JPG, viene salvata in `temp/firma_<timestamp>.<ext>` e usata per il PDF; se è un percorso, viene risolto e utilizzato.
  - Fallback gerarchico: 1) richiesta (`operatorSignature`), 2) `settings.json` (`operatori[].firma_png_path`), 3) `assets/firme/<nome_cognome_normalizzato>.png` (accenti rimossi, minuscolo, spazi→underscore).
  - Controlli permessi con `fs.accessSync` e fallback al placeholder in caso di errore.
- PDF (`order-pdf-generator.js`):
  - Firma immediatamente sotto la tabella, label “Firma digitale operatore”, cornice e `fit` per mantenere proporzioni.
  - Se non c’è spazio, la firma va all’inizio della pagina successiva.

Modifiche di Configurazione
- Nessun keystore; suggerito aggiungere chiavi RSA in `.env` per firma asimmetrica:
  - `SIGN_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"`
  - `SIGN_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"`
  - In alternativa, impostare `SIGN_SECRET` per HMAC con valore forte.
- Verificare in `config/settings.json` che ogni operatore abbia `firma_png_path` se non si usa l’upload runtime.

Test Eseguiti e Risultati
- API `POST /orders/generate-pdf`: successo, restituisce `outputUrl`, `signatureId`, `signedAt`.
- Rendering PNG: con operatore configurato (es. Admin) la firma è disponibile e proporzionata sotto la tabella; in assenza, appare il placeholder.
- Verifica digitale: `GET /orders/verify-signature/{signatureId}` restituisce metadati (algoritmo, fingerprint) coerenti.

Raccomandazioni
- UI: assicurarsi che l’input file (`#new-user-signature`) generi e invii un data URL in `operatorSignature` verso `/orders/generate-pdf` per l’operatore selezionato.
- Operatori: mantenere aggiornato `config/settings.json` e/o la cartella `assets/firme` con file normalizzati.
- Sicurezza firma:
  - Passare a RSA configurando `SIGN_PRIVATE_KEY_PEM` e `SIGN_PUBLIC_KEY_PEM` per firme verificabili esternamente.
  - Ruotare periodicamente `SIGN_SECRET` se si usa HMAC; evitare valori di default.
- Logging: opzionale aggiunta di log sorgente firma (data URL/temp, settings, fallback) per semplificare diagnosi future.

Stato Finale
- Funzionalità ripristinata: flusso di firma digitale attivo; firma scannerizzata resa nel PDF quando presente. In assenza di firma disponibile, il sistema mostra placeholder e continua a generare il documento con firma digitale a livello contenuto.