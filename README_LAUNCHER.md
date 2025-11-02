# Launcher Java App - Istruzioni d'uso

## Struttura consigliata

```
ProjectRoot/
├─ app/
│  └─ app.jar
└─ scripts/
   ├─ run_app.command
   └─ run_app.bat
```

## Parametri configurabili

I launcher utilizzano questi parametri di default:

- **APP_JAR** = `../app/app.jar`
- **BASE_URL** = `http://localhost:8000`
- **HEALTH_PATH** = `/` (endpoint per verificare che l'app sia attiva)

### Personalizzazione parametri

Se necessario, modifica i parametri nei file launcher:

- Per percorsi diversi del JAR, cambia `APP_JAR`
- Per porte diverse, cambia `BASE_URL`
- Se l'app ha un endpoint di salute specifico (es. `/actuator/health` per Spring), cambia `HEALTH_PATH`

## Istruzioni per l'uso

### macOS

1. **Preparazione** (solo la prima volta):
   ```bash
   chmod +x scripts/run_app.command
   ```

2. **Avvio**:
   - Doppio clic su `scripts/run_app.command`
   - Oppure trascina il file nel Dock per accesso rapido

### Windows

1. **Avvio**:
   - Doppio clic su `scripts\run_app.bat`
   - Puoi creare un collegamento sul Desktop o nella Barra delle applicazioni

## Come funzionano i launcher

1. **Avviano** l'applicazione Java in background con `java -jar`
2. **Aspettano** che l'endpoint di salute risponda con codice 200
3. **Aprono** automaticamente l'URL nel browser predefinito del sistema
4. **Nessun errore** se l'app impiega tempo ad avviarsi

## Requisiti

- **Java**: `java -version` deve funzionare nel PATH
- **macOS**: `curl` (già presente nel sistema)
- **Windows**: PowerShell (presente da Windows 10 in poi)

## Note importanti

- **Nessun auto-avvio**: I launcher si attivano solo quando li esegui manualmente
- **Browser predefinito**: Usano il browser di default del sistema (non forzano Chrome)
- **Offline-first**: Tutti i percorsi sono relativi al progetto
- **Endpoint di salute**: Se `/` non restituisce 200, usa un endpoint specifico come `/actuator/health`

## Risoluzione problemi

- Se l'app non si avvia, verifica che `java -version` funzioni
- Se il browser non si apre, controlla che `BASE_URL` sia corretto
- Se l'attesa è troppo lunga, verifica che `HEALTH_PATH` sia l'endpoint giusto

## Personalizzazione avanzata

Per modificare il comportamento, edita direttamente i file:
- `scripts/run_app.command` per macOS
- `scripts/run_app.bat` per Windows

Tutti i parametri sono chiaramente definiti all'inizio di ogni file.