# Documentazione Sistema di Mappatura Dati Email

## Panoramica
Il sistema di mappatura automatica dei dati email è stato implementato per garantire che le email inviate contengano sempre dati aggiornati e validati estratti direttamente dai `div` elementi dell'interfaccia utente.

## Architettura del Sistema

### 1. Estrazione Dati
Il sistema estrae automaticamente i dati dai seguenti elementi `div`:

#### Per Email Articoli in Scadenza:
- **Selettore**: `.expiring-items .item-row`
- **Dati estratti**:
  - Codice articolo (`.item-code`)
  - Nome articolo (`.item-name`)
  - Quantità (`.item-quantity`)
  - Data scadenza (`.item-expiry`)
  - Ubicazione (`.item-location`)

#### Per Email Quantità Zero:
- **Selettore**: `.zero-quantity-items .item-row`
- **Dati estratti**:
  - Codice articolo (`.item-code`)
  - Nome articolo (`.item-name`)
  - Quantità (`.item-quantity`)
  - Data scadenza (`.item-expiry`)
  - Ubicazione (`.item-location`)

### 2. Funzioni di Estrazione

#### `extractExpiringItemsData()`
```javascript
// Estrae dati dagli elementi div degli articoli in scadenza
// Ritorna: Array di oggetti con proprietà {code, name, quantity, expiry, location}
```

#### `extractZeroQuantityItemsData()`
```javascript
// Estrae dati dagli elementi div degli articoli con quantità zero
// Ritorna: Array di oggetti con proprietà {code, name, quantity, expiry, location}
```

### 3. Funzioni di Utilità

#### `sanitizeText(text)`
- Pulisce e normalizza il testo estratto
- Rimuove spazi extra e caratteri speciali
- Gestisce valori null/undefined

#### `extractQuantityFromText(text)`
- Estrae valori numerici dal testo della quantità
- Gestisce formati diversi (es. "5 pz", "10 unità")
- Ritorna numero o 0 se non valido

#### `extractDateFromText(text)`
- Estrae e formatta date dal testo
- Supporta formati DD/MM/YYYY e DD-MM-YYYY
- Ritorna data formattata o stringa originale

#### `extractLocationFromText(text)`
- Estrae informazioni di ubicazione
- Normalizza il formato dell'ubicazione
- Gestisce ubicazioni multiple

### 4. Validazione Dati

#### `validateItemData(item)`
Valida un singolo elemento con i seguenti controlli:
- **Codice**: Obbligatorio, lunghezza 1-50 caratteri
- **Nome**: Obbligatorio, lunghezza 1-200 caratteri
- **Quantità**: Deve essere numero >= 0
- **Scadenza**: Formato data valido
- **Ubicazione**: Opzionale, max 100 caratteri

#### `validateEmailData(data, type)`
Valida l'intero dataset per l'email:
- Verifica che ci siano elementi da processare
- Valida ogni singolo elemento
- Controlla coerenza dei dati per tipo email
- Ritorna oggetto `{isValid: boolean, errors: string[]}`

### 5. Formattazione Email

#### `formatDataForEmail(data, type)`
Formatta i dati estratti secondo lo standard aziendale:

**Header Standard**:
```
=== REPORT [TIPO] - [DATA] ===
Generato automaticamente dal Sistema First Aid Manager
```

**Tabella Dati**:
- Formato HTML con stili CSS inline
- Colonne: Codice, Nome, Quantità, Scadenza, Ubicazione
- Righe alternate per migliore leggibilità

**Footer Standard**:
```
---
Questo report è stato generato automaticamente.
Per informazioni contattare l'amministratore del sistema.
Data generazione: [TIMESTAMP]
```

### 6. Popolamento Automatico

#### `populateEmailFromDivData(type)`
Funzione principale che:
1. Estrae dati dai div appropriati
2. Valida l'integrità dei dati
3. Formatta secondo standard aziendale
4. Popola il textarea dell'email
5. Gestisce errori e notifiche utente

#### `addEmailMappingButtons()`
Aggiunge pulsanti "Popola Automaticamente da Dati" alle sezioni email:
- Posizionati accanto ai textarea
- Stile coerente con l'interfaccia esistente
- Gestione eventi click per attivazione mappatura

### 7. Gestione Errori

#### `showEmailError(message)`
Sistema centralizzato per la gestione errori:
- Mostra messaggi di errore all'utente
- Log degli errori per debugging
- Formattazione consistente dei messaggi

**Tipi di Errori Gestiti**:
- Dati mancanti o incompleti
- Formato email non valido
- Errori di validazione dati
- Errori di rete durante invio
- Problemi di integrità dati

### 8. Integrazione con Sistema Esistente

#### Modifiche alle Funzioni di Invio Email

**`sendExpiringItemsEmail()`**:
- Aggiunta validazione email recipient
- Controllo integrità dati prima invio
- Logging dettagliato operazioni
- Gestione errori migliorata

**`sendZeroQuantityEmail()`**:
- Stesse migliorie della funzione precedente
- Validazione specifica per dati quantità zero

#### Inizializzazione Sistema
- Pulsanti mappatura aggiunti durante `init()`
- Timeout di 1 secondo per garantire DOM ready
- Integrazione seamless con sistema esistente

## Flusso Operativo

### 1. Caricamento Pagina
```
init() → setTimeout(1000ms) → addEmailMappingButtons()
```

### 2. Mappatura Manuale
```
Click Pulsante → populateEmailFromDivData() → 
extractData() → validateData() → formatData() → 
populateTextarea() → showSuccess/Error
```

### 3. Invio Email
```
sendEmail() → validateRecipient() → validateContent() → 
extractData() → validateData() → buildTable() → 
sendRequest() → logResult()
```

## Configurazione e Personalizzazione

### Selettori CSS Personalizzabili
I selettori per l'estrazione dati possono essere modificati nelle costanti:
```javascript
const EXPIRING_ITEMS_SELECTOR = '.expiring-items .item-row';
const ZERO_QUANTITY_SELECTOR = '.zero-quantity-items .item-row';
```

### Template Email Personalizzabili
I template per header e footer possono essere modificati nella funzione `formatDataForEmail()`.

### Validazione Personalizzabile
I criteri di validazione possono essere modificati nella funzione `validateItemData()`.

## Manutenzione e Troubleshooting

### Log e Debugging
- Tutti gli invii email vengono loggati in console
- Errori di validazione mostrano dettagli specifici
- Timestamp per tracciabilità operazioni

### Test di Integrità
Per testare il sistema:
1. Verificare presenza elementi div con classi corrette
2. Testare estrazione dati con `extractExpiringItemsData()`
3. Validare formattazione con `formatDataForEmail()`
4. Testare popolamento con pulsanti mappatura

### Problemi Comuni
- **Pulsanti non visibili**: Verificare timing inizializzazione
- **Dati non estratti**: Controllare selettori CSS
- **Validazione fallisce**: Verificare formato dati nei div
- **Email non formattata**: Controllare template formatting

## Versioning e Aggiornamenti

**Versione Corrente**: 1.0
**Data Implementazione**: [DATA_CORRENTE]
**Compatibilità**: First Aid Manager v1.x

### Changelog
- v1.0: Implementazione iniziale sistema mappatura automatica
  - Estrazione dati da div
  - Validazione integrità
  - Formattazione standard aziendale
  - Integrazione con sistema email esistente