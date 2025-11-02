Titolo: Prevenzione pagine vuote e visibilità firma operatore

Obiettivo
- Eliminare la generazione di pagine indesiderate nei PDF
- Garantire la corretta visualizzazione della firma dell’operatore
- Verificare l’implementazione della firma digitale e la sua tracciabilità

Modifiche principali
- order-pdf-generator.js
  - La firma dell’operatore viene spostata su una pagina finale dedicata.
  - La pagina finale ora contiene solo la firma (immagine) e la label "Firma digitale operatore"; rimossi testi aggiuntivi (ID firma, algoritmo, data, ecc.).
  - Rimosso il `reservedBottom` nella pagina della tabella (impostato a 0) per evitare riserve di spazio che potevano causare salti di pagina.
  - Pagina nuova (`addPage`) viene creata solo se: 1) la tabella supera lo spazio disponibile; 2) per la pagina firma.

- server.js
  - Aggiunti controlli di permesso (lettura) su `logoPath` e `signaturePath` con `fs.accessSync` (fallback a placeholder in caso di file non leggibile).
  - Confermata la firma digitale: generazione di `signature`, `signatureId`, `signedAt`, `signatureAlgo` con `services/signatureService.js`.
  - Tracciamento su ledger: salvataggio in `output/signatures.json` via `appendLedger`.
  - Endpoint di verifica: `GET /orders/verify-signature/:signatureId` per verificare la presenza e i metadati della firma digitale.

Verifica funzionale
1) Avvio backend: `node server.js` su `http://localhost:3000/`.
2) UI: inserire dati dell’ordine (inclusi azienda e indirizzo se desiderati), generare PDF.
3) Controllo PDF:
   - Nessuna pagina vuota intermedia o finale.
   - Ultima pagina: solo firma operatore (immagine) con label.
   - Nessun contenuto aggiuntivo dopo la firma.
4) Verifica firma digitale:
   - Dalla risposta API `POST /orders/generate-pdf` recuperare `signatureId`.
   - Chiamare `GET /orders/verify-signature/{signatureId}`: deve restituire `success: true` e metadati (`signedAt`, `signatureAlgo`, `publicKeyFingerprint`).

Casi limite e permessi
- Se `settings.report.logo_path` o `operatori[].firma_png_path` non sono leggibili, viene mostrato un placeholder (logo assente; firma “non disponibile”).
- La generazione del PDF è impedita solo per mancanza di dati obbligatori (es. `items` vuoto). La mancanza della firma non blocca ma viene segnalata visivamente.

Soluzione definitiva per prevenire pagine vuote
- Controllo esplicito dello spazio disponibile prima di ogni riga di tabella; aggiunta pagina solo quando necessario.
- Rimozione di riserve di spazio non utilizzate sulla pagina della tabella.
- Pagina firma isolata e priva di contenuti ulteriori: impedisce sovrapposizioni e la necessità di una pagina successiva.
- Controlli permessi su asset (logo/firma) per evitare errori che possano interrompere il layout.

Note
- La firma digitale (critto) è tracciata e verificabile via API, ma non è più mostrata in chiaro nel PDF per mantenere l’ultima pagina minimalista. Se desiderato, è possibile reintrodurre l’ID firma in piccolo testo.
- Altri generatori PDF (`pdf-generator.js`, `error-report-generator.js`) non utilizzano paginazione manuale aggressiva; non sono stati riscontrati casi di pagine finali vuote.