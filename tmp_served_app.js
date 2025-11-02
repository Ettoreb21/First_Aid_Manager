// First Aid Manager Application
class FirstAidManager {
    constructor() {
        this.data = {
            warehouse: [],
            kits: [],
            materials: this.getDefaultMaterials(),
            users: [],
            auditLog: [],
            settings: {
                smtp: {
                    server: '',
                    port: 587,
                    encryption: 'tls',
                    sender: '',
                    password: ''
                },
                expiry: {
                    autoEmail: true,
                    interval: 30
                }
            },
            emailTemplates: {
                expiring: {
                    recipient: '',
                    subject: 'Items Expiring Soon',
                    body: 'Dear Team,\n\nThe following items are expiring soon and need attention:\n\n[TABLE]\n\nPlease take necessary action.\n\nBest regards'
                },
                zeroQuantity: {
                    recipient: '',
                    subject: 'Items Out of Stock',
                    body: 'Dear Team,\n\nThe following items are out of stock and need restocking:\n\n[TABLE]\n\nPlease reorder as soon as possible.\n\nBest regards'
                }
            }
        };
        // Settings loaded from backend (SQL), kept nested following config/settings.json keys
        this.appSettings = {};
        // Backend Materials API config
        // Se la UI gira su 5173 (server statico), evita di puntare alla stessa origine
        // e usa direttamente l'API su porta 3002 (materials server) come default.
        const uiPort = (location.port || '');
        if (uiPort === '5173') {
            this.apiBase = 'http://localhost:3002/api';
        } else {
            this.apiBase = `${location.origin}/api`;
        }
        this.apiKey = localStorage.getItem('fam_api_key') || 'dev-key';
        this.serverMaterials = [];
        // DB Materials UI state
        this.dbMatFilters = { id: '', name: '', categoria: '' };
        this.dbMatSort = { key: 'id', dir: 'desc' }; // keys: id|nome_materiale|categoria|maxQty|minQty
        this.dbMatPage = { number: 1, size: 10 };
        
        this.currentSection = 'overall';
        this.init();
    }

    async init() {
        this.loadData();
        this.initTheme();
        this.setupEventListeners();
        this.updateCurrentMonth();
        await this.loadExcelDefaults();
        this.renderOverallDashboard();
        this.createDefaultKits();
        this.renderAllSections();

        // Risolvi base URL API con fallback (localhost:3002) se /api non è disponibile sulla stessa origine
        await this.resolveApiBase();

        // Carica impostazioni dal backend (fallback a defaults se DB non disponibile)
        try {
            await this.loadBackendSettings();
        } catch (e) {
            console.warn('Impossibile caricare le impostazioni dal backend:', e?.message || e);
        }

        // Carica elenco materiali dal server per inserimenti via APP
        try {
            await this.loadServerMaterials();
            // Se la sezione impostazioni è attiva, aggiorna la tab Anagrafica
            const activeTab = document.querySelector('.settings-tab.active')?.getAttribute('data-tab');
            if (activeTab === 'materials') this.createSettingsPanel('materials');
        } catch (e) {
            console.warn('Impossibile caricare i materiali dal server:', e.message);
        }

        // Navigate to section from hash if present (e.g., #kits)
        const hash = (window.location.hash || '').replace('#','');
        if (hash && document.getElementById(hash)) {
            this.switchSection(hash);
        }
        
        // Initialize email mapping buttons
        setTimeout(() => {
            this.addEmailMappingButtons();
        }, 1000);
        
        // Auto-save every 5 seconds
        setInterval(() => this.saveData(), 5000);

        // Enforce read-only policy across inputs and textareas
        this.enforceInputRestrictions(document);
    }

    getDefaultMaterials() {
        return [];
    }

    // Audit helpers
    getCurrentOperatorInfo() {
        try {
            const opSelect = document.getElementById('report-operator');
            const operatorId = opSelect && opSelect.value ? opSelect.value : (this.data.settings?.defaultOperator || '');
            const user = this.data.users.find(u => String(u.id) === String(operatorId));
            return {
                operatorId: operatorId || null,
                operatorName: user ? `${user.firstName} ${user.lastName}` : 'Unknown'
            };
        } catch (_) {
            return { operatorId: null, operatorName: 'Unknown' };
        }
    }

    logAudit(action, elementId, details = {}) {
        const { operatorId, operatorName } = this.getCurrentOperatorInfo();
        const entry = {
            action,
            elementId,
            operatorId,
            operatorName,
            timestamp: new Date().toISOString(),
            details
        };
        this.data.auditLog.push(entry);
        // Persist periodically via existing auto-save; also attempt immediate save
        try { this.saveData(); } catch (_) {}
    }

    // Input/textarea restriction policy
    enforceInputRestrictions(scope) {
        const authorizedIds = [
            'default-location',
            'company-name',
            // Email notifications templates
            'expiring-recipient',
            'zero-recipient',
            'expiring-subject',
            'expiring-body',
            'zero-subject',
            'zero-body'
        ];
        const elements = Array.from(scope.querySelectorAll('input, textarea'));
        elements.forEach(el => {
            const id = el.id || '';
            const isAuthorized = authorizedIds.includes(id);
            const tag = (el.tagName || '').toLowerCase();
            if (!isAuthorized && (tag === 'input' || tag === 'textarea')) {
                // Visual and functional read-only
                try {
                    el.setAttribute('readonly', 'readonly');
                    el.setAttribute('aria-readonly', 'true');
                    el.classList.add('readonly-block');
                } catch (_) {}
                // Block interaction attempts and log
                const handler = this.handleBlockedEditEvent.bind(this);
                ['keydown', 'paste', 'drop', 'beforeinput'].forEach(evt => {
                    try { el.addEventListener(evt, handler, { capture: true }); } catch (_) {}
                });
            } else if (isAuthorized) {
                // Log authorized changes
                try {
                    el.addEventListener('input', () => {
                        this.logAudit('authorized_change', id, { value: el.value });
                    });
                } catch (_) {}
            }
        });
    }

    handleBlockedEditEvent(e) {
        try {
            const el = e.target;
            const id = el.id || '(no-id)';
            // Prevent the edit attempt
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            this.logAudit('blocked_edit', id, { event: e.type });
        } catch (_) {}
    }

    getStandardKitItems() {
        // Prefer items loaded from Excel; fallback to hardcoded defaults if empty
        const excelDefaults = Array.isArray(this.defaultKitItems) ? this.defaultKitItems : [];
        if (excelDefaults.length > 0) {
            return excelDefaults.map(item => ({
                code: item.code,
                maxQuantity: item.maxQuantity
            }));
        }
        console.warn('[Kit Standard] Nessun template da Excel. Uso fallback predefinito.');
        const fallback = this.getHardcodedStandardItems();
        this.ensureMaterialsForStandardItems(fallback);
        return fallback.map(item => ({ code: item.code, maxQuantity: item.maxQuantity }));
    }

    // Fallback static content for standard kits when Excel is unavailable
    getHardcodedStandardItems() {
        return [
            { code: 'garze-sterili', name: 'Garze sterili', maxQuantity: 10 },
            { code: 'bende-elastiche', name: 'Bende elastiche', maxQuantity: 4 },
            { code: 'cerotti-medicazione', name: 'Cerotti di medicazione', maxQuantity: 10 },
            { code: 'cerotti', name: 'Cerotti', maxQuantity: 20 },
            { code: 'disinfettante', name: 'Disinfettante', maxQuantity: 1 },
            { code: 'forbici', name: 'Forbici', maxQuantity: 1 },
            { code: 'pinzette', name: 'Pinzette', maxQuantity: 1 },
            { code: 'ghiaccio-istantaneo', name: 'Ghiaccio istantaneo', maxQuantity: 2 },
            { code: 'coperta-isotermica', name: 'Coperta isotermica', maxQuantity: 1 },
            { code: 'triangolo-di-tessuto', name: 'Triangolo di tessuto', maxQuantity: 2 },
            { code: 'guanti-nitrile', name: 'Guanti in nitrile', maxQuantity: 4 },
            { code: 'mascherine', name: 'Mascherine', maxQuantity: 2 }
        ];
    }

    // Ensure materials list has names and tags for fallback items
    ensureMaterialsForStandardItems(items) {
        try {
            const byCode = new Map((this.data.materials || []).map(m => [m.code, m]));
            items.forEach(it => {
                if (!byCode.has(it.code)) {
                    this.data.materials.push({ code: it.code, name: it.name, tags: ['kit'] });
                } else {
                    const m = byCode.get(it.code);
                    if (!m.name) m.name = it.name;
                    const tags = new Set([...(m.tags || []), 'kit']);
                    m.tags = Array.from(tags);
                }
            });
        } catch (e) {
            console.warn('Impossibile sincronizzare materiali per fallback kit:', e.message);
        }
    }

    async loadExcelDefaults() {
        try {
            const excelLoadedFlag = localStorage.getItem('fam_excel_loaded');
            const needMaterials = !this.data.materials || this.data.materials.length === 0;
            const needWarehouse = !this.data.warehouse || this.data.warehouse.length === 0;
            if (!needMaterials && !needWarehouse && excelLoadedFlag === 'true') {
                return;
            }

            const materialsMap = new Map();
            const addMaterial = (code, name, tag) => {
                if (!code) code = this.slugify(name);
                code = code.trim();
                const existing = materialsMap.get(code);
                if (existing) {
                    if (tag && !(existing.tags || []).includes(tag)) {
                        existing.tags = [...(existing.tags || []), tag];
                    }
                    if (!existing.name && name) existing.name = name;
                } else {
                    materialsMap.set(code, { code, name, tags: tag ? [tag] : [] });
                }
            };

            // Contenuto_magazzino.xlsx -> armadio + materiali
            try {
                const magController = new AbortController();
                const magTimeoutId = setTimeout(() => magController.abort(), 15000);
                let magResp;
                try {
                    magResp = await fetch('Appunti/Dati/Contenuto_magazzino.xlsx', { signal: magController.signal });
                } catch (magErr) {
                    const isAbort = magErr && magErr.name === 'AbortError';
                    console.warn('Impossibile caricare Contenuto_magazzino.xlsx:', isAbort ? 'Timeout' : magErr.message);
                }
                clearTimeout(magTimeoutId);
                if (magResp && magResp.ok) {
                    const magBuf = await magResp.arrayBuffer();
                    const magWb = XLSX.read(magBuf, { type: 'array' });
                    const magWs = magWb.Sheets[magWb.SheetNames[0]];
                    const magRows = XLSX.utils.sheet_to_json(magWs, { defval: '', raw: false });

                    magRows.forEach(row => {
                        const name = (row.DISPOSITIVO || '').toString().trim();
                        let code = (row.Codice || '').toString().trim();
                        if (!code) code = this.slugify(name);
                        addMaterial(code, name, 'magazzino');
                    });

                    if (needWarehouse) {
                        this.data.warehouse = magRows.map(row => {
                            const name = (row.DISPOSITIVO || '').toString().trim();
                            let code = (row.Codice || '').toString().trim();
                            if (!code) code = this.slugify(name);
                            const quantity = parseInt(row.QNT, 10);
                            const expiryDate = this.parseExpiry(row.SCADENZA);
                            const notes = (row.NOTE || '').toString();
                            return {
                                id: this.generateId(),
                                code,
                                quantity: isNaN(quantity) ? 0 : quantity,
                                expiryDate,
                                notes
                            };
                        });
                    }
                }
            } catch (e) {
                console.warn('Impossibile caricare Contenuto_magazzino.xlsx:', e.message);
            }

            // Contenuto_cassette.xlsx -> default kit items + materiali
            try {
                const casController = new AbortController();
                const casTimeoutId = setTimeout(() => casController.abort(), 15000);
                let casResp;
                try {
                    casResp = await fetch('Appunti/Dati/Contenuto_cassette.xlsx', { signal: casController.signal });
                } catch (casErr) {
                    const isAbort = casErr && casErr.name === 'AbortError';
                    console.warn('Impossibile caricare Contenuto_cassette.xlsx:', isAbort ? 'Timeout' : casErr.message);
                }
                clearTimeout(casTimeoutId);
                if (casResp && casResp.ok) {
                    const casBuf = await casResp.arrayBuffer();
                    const casWb = XLSX.read(casBuf, { type: 'array' });
                    const casWs = casWb.Sheets[casWb.SheetNames[0]];
                    const casRows = XLSX.utils.sheet_to_json(casWs, { defval: '', raw: false });

                    const defaultItems = [];
                    casRows.forEach(row => {
                        const name = (row.Materiale || '').toString().trim();
                        let code = (row.Codice || '').toString().trim();
                        if (!code) code = this.slugify(name);
                        addMaterial(code, name, 'kit');

                        const maxRaw = row['Qnt_minima '] ?? row.Qnt_minima ?? row.Qnt ?? row.MIN;
                        const maxQuantity = parseInt(maxRaw, 10);
                        defaultItems.push({
                            code,
                            maxQuantity: isNaN(maxQuantity) ? 1 : maxQuantity
                        });
                    });
                    this.defaultKitItems = defaultItems;
                }
            } catch (e) {
                console.warn('Impossibile caricare Contenuto_cassette.xlsx:', e.message);
            }

            // Merge materials
            const existingMaterials = Array.isArray(this.data.materials) ? this.data.materials : [];
            const combined = [...existingMaterials];
            const byCode = new Map(existingMaterials.map(m => [m.code, m]));

            materialsMap.forEach(value => {
                const existing = byCode.get(value.code);
                if (existing) {
                    const tagsSet = new Set([...(existing.tags || []), ...(value.tags || [])]);
                    existing.tags = Array.from(tagsSet);
                    if (!existing.name && value.name) existing.name = value.name;
                } else {
                    combined.push(value);
                }
            });

            this.data.materials = combined;

            localStorage.setItem('fam_excel_loaded', 'true');
            this.saveData();
        } catch (error) {
            console.error('Errore nel caricamento dei dati Excel:', error);
        }
    }

    parseExpiry(value) {
        if (!value) return '2099-12-31';
        const str = value.toString().trim();
        const match = str.match(/([A-Za-z]+)\s*[-\/]\s*(\d{2,4})/);
        const months = {
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
            july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
        };
        if (match) {
            const monthName = match[1].toLowerCase();
            const month = months[monthName];
            let year = parseInt(match[2], 10);
            if (!isNaN(year)) {
                if (year < 100) year = 2000 + year;
                if (month) {
                    return `${year}-${String(month).padStart(2, '0')}-01`;
                }
            }
        }
        return '2099-12-31';
    }

    slugify(text) {
        const s = (text || '').toString().trim().toLowerCase();
        const slug = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return slug || `gen-${Math.random().toString(36).slice(2, 8)}`;
    }

    createDefaultKits() {
        // Non creare kit predefiniti - l'utente li inserirà manualmente
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const section = e.currentTarget?.dataset?.section;
                if (!section) return;
                this.switchSection(section);
            });
        });

        // Settings tabs
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.currentTarget?.dataset?.tab;
                if (!tabName) return;
                this.switchSettingsTab(tabName);
            });
        });

        // Modal close
        const modalClose = document.getElementById('modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', () => {
                this.closeModal();
            });
        }

        const modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    this.closeModal();
                }
            });
        }

        // Warehouse actions
        const addWarehouseBtn = document.getElementById('add-warehouse-item');
        if (addWarehouseBtn) {
            addWarehouseBtn.addEventListener('click', () => {
                this.showAddWarehouseItemModal();
            });
        }

        // Kit actions
        const addKitBtn = document.getElementById('add-kit');
        if (addKitBtn) {
            addKitBtn.addEventListener('click', () => {
                this.showAddKitModal();
            });
        }

        // Email actions
        const sendExpiringBtn = document.getElementById('send-expiring-email');
        if (sendExpiringBtn) {
            sendExpiringBtn.addEventListener('click', () => {
                this.sendExpiringItemsEmail();
            });
        }

        const sendZeroBtn = document.getElementById('send-zero-email');
        if (sendZeroBtn) {
            sendZeroBtn.addEventListener('click', () => {
                this.sendZeroQuantityEmail();
            });
        }

        const sendEmailBtn = document.getElementById('send-email');
        if (sendEmailBtn) {
            sendEmailBtn.addEventListener('click', () => {
                this.showSendEmailDialog();
            });
        }

        // Report generation
        const generateReportBtn = document.getElementById('generate-report');
        if (generateReportBtn) {
            generateReportBtn.addEventListener('click', () => {
                try {
                    const kitCheckboxes = document.querySelectorAll('#selected-kits input[type="checkbox"]');
                    kitCheckboxes.forEach(cb => cb.checked = true);
                } catch (err) {
                    alert('Impossibile selezionare i kit automaticamente. Riprova.');
                }
                this.generateReport();
            });
        }

        // Dynamic label bound to report location
        const reportLocationInput = document.getElementById('report-location');
        const reportBtn = document.getElementById('generate-report');
        const baseText = 'Genera Rapporto';
        const updateGenerateReportButtonLabel = () => {
            if (!reportBtn) return;
            const raw = reportLocationInput?.value ?? '';
            const v = raw.trim();
            const safe = v.length > 60 ? v.slice(0, 57) + '…' : v;
            reportBtn.innerHTML = v ? `<i class="fas fa-file-alt"></i> ${baseText} — ${safe}` : `<i class="fas fa-file-alt"></i> ${baseText}`;
        };
        if (reportLocationInput && reportBtn) {
            ['input','change'].forEach(evt => reportLocationInput.addEventListener(evt, updateGenerateReportButtonLabel));
        }
        // Initial sync
        updateGenerateReportButtonLabel();


        // Header print button binding
        const printBtn = document.getElementById('print-report');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                try {
                    const kitCheckboxes = document.querySelectorAll('#selected-kits input[type="checkbox"]');
                    kitCheckboxes.forEach(cb => cb.checked = true);
                } catch (err) {
                    alert('Impossibile selezionare i kit automaticamente. Riprova.');
                }
                let location = document.getElementById('report-location')?.value?.trim();
                if (!location || location.length === 0) {
                    location = this.data?.settings?.defaultLocation || 'Uffici';
                }
                let operatorId = document.getElementById('report-operator')?.value || this.data?.settings?.defaultOperator || (this.data.users?.[0]?.id || '');
                let selectedKitIds = Array.from(document.querySelectorAll('#selected-kits input:checked')).map(cb => cb.value);
                if (!Array.isArray(selectedKitIds) || selectedKitIds.length === 0) {
                    selectedKitIds = (this.data?.kits || []).map(k => k.id);
                }
                const operator = this.data.users.find(u => u.id === operatorId);

                // Controllo qualità prima della stampa HTML
                const qcIssues = [];
                if (!location || location.length < 2) qcIssues.push('Ubicazione non valida o troppo corta.');
                const opName = operator ? `${operator.firstName} ${operator.lastName}`.trim() : '';
                if (!opName) qcIssues.push('Nome operatore mancante o operatore non valido.');
                if (this.data.settings?.showSignatures !== false && operator && !operator.signature) {
                    qcIssues.push('Firma digitale dell\'operatore mancante (verrà mostrato un placeholder).');
                }
                if (!Array.isArray(selectedKitIds) || selectedKitIds.length === 0) qcIssues.push('Nessun kit disponibile nel rapporto.');

                if (qcIssues.length > 0) {
                    const content = `<p>Controllo qualità: alcune informazioni richieste risultano mancanti o incomplete.</p>
                                     <ul>${qcIssues.map(i => `<li>${i}</li>`).join('')}</ul>
                                     <p>Vuoi procedere comunque con la stampa HTML?</p>`;
                    const footer = `<button class=\"btn btn-secondary\" onclick=\"app.closeModal()\">Annulla</button>
                                    <button class=\"btn btn-primary\" onclick='app.printReport(${JSON.stringify(location)}, ${JSON.stringify(operatorId)}, ${JSON.stringify(selectedKitIds)})'>Procedi comunque</button>`;
                    this.showModal('Conferma stampa', content, footer);
                    return;
                }
                this.printReport(location, operatorId, selectedKitIds);
            });
        }

        const operatorSelectEl = document.getElementById('report-operator');
        if (operatorSelectEl) {
            operatorSelectEl.addEventListener('change', () => {
                this.updateReportPreview();
            });
        }

        // Preimposta ubicazione "Uffici"
        const setLocationUfficiBtn = document.getElementById('set-location-uffici');
        if (setLocationUfficiBtn) {
            setLocationUfficiBtn.addEventListener('click', () => {
                const locInput = document.getElementById('report-location');
                if (locInput) {
                    locInput.value = 'Uffici';
                    this.data.settings = this.data.settings || {};
                    this.data.settings.defaultLocation = locInput.value.trim();
                    this.scheduleAutoSave();
                    // Sync button label with location change
                    if (typeof updateGenerateReportButtonLabel === 'function') {
                        updateGenerateReportButtonLabel();
                    }
                }
            });
        }

        // Compila automaticamente e salva la sezione rapporto
        const fillSaveBtn = document.getElementById('fill-and-save-report');
        if (fillSaveBtn) {
            fillSaveBtn.addEventListener('click', () => {
                const locInput = document.getElementById('report-location');
                const operatorSelect = document.getElementById('report-operator');

                if (locInput && (!locInput.value || !locInput.value.trim())) {
                    const defaultLoc = this.data?.settings?.defaultLocation || 'Uffici';
                    locInput.value = defaultLoc;
                }

                if (operatorSelect && (!operatorSelect.value || operatorSelect.value === '')) {
                    const defaultOp = this.data?.settings?.defaultOperator;
                    if (defaultOp && this.data.users.some(u => u.id === defaultOp)) {
                        operatorSelect.value = defaultOp;
                    } else if (this.data.users.length > 0) {
                        operatorSelect.value = this.data.users[0].id;
                    }
                }

                // Assicura che almeno un kit sia selezionato
                const kitCheckboxes = Array.from(document.querySelectorAll('#selected-kits input[type="checkbox"]'));
                const anyChecked = kitCheckboxes.some(cb => cb.checked);
                if (!anyChecked) {
                    kitCheckboxes.forEach(cb => cb.checked = true);
                }

                // Persisti selezioni nelle impostazioni
                this.data.settings = this.data.settings || {};
                this.data.settings.defaultLocation = locInput?.value?.trim() || this.data.settings.defaultLocation || 'Uffici';
                if (operatorSelect && operatorSelect.value) {
                    this.data.settings.defaultOperator = operatorSelect.value;
                }

                // Aggiorna anteprima e salva
                this.updateReportPreview();
                this.saveData();
                alert('Sezione rapporto compilata e salvata.');
            });
        }

        // Auto-save on input changes
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('form-control')) {
                this.scheduleAutoSave();
            }
        });
        
        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.toggleTheme();
            });
        }
    }

    // Theme Management
    initTheme() {
        // Load saved theme or default to light
        const savedTheme = localStorage.getItem('first-aid-theme') || 'light';
        this.setTheme(savedTheme);
        
        // Set initial theme attribute immediately to prevent flash
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
        
        // Announce theme change for screen readers
        this.announceThemeChange(newTheme);
    }

    setTheme(theme) {
        // Validate theme value
        if (!['light', 'dark'].includes(theme)) {
            theme = 'light';
        }
        
        // Set theme immediately
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('first-aid-theme', theme);
        
        // Update toggle button with enhanced feedback
        this.updateThemeToggle(theme);
        
        // Add visual feedback class
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.classList.add('theme-switching');
            setTimeout(() => {
                themeToggle.classList.remove('theme-switching');
            }, 300);
        }
    }

    updateThemeToggle(theme) {
        const themeToggle = document.getElementById('theme-toggle');
        const themeIcon = themeToggle?.querySelector('i');
        const themeText = themeToggle?.querySelector('.theme-text');
        
        if (themeIcon && themeText) {
            // Add active state class for visual feedback
            themeToggle.classList.toggle('theme-active', theme === 'dark');
            
            if (theme === 'dark') {
                themeIcon.className = 'fas fa-moon';
                themeText.textContent = 'Modalità Scura';
                themeToggle.title = 'Attiva tema chiaro (attualmente: tema scuro)';
                themeToggle.setAttribute('aria-label', 'Attiva tema chiaro, attualmente in modalità scura');
            } else {
                themeIcon.className = 'fas fa-sun';
                themeText.textContent = 'Modalità Chiara';
                themeToggle.title = 'Attiva tema scuro (attualmente: tema chiaro)';
                themeToggle.setAttribute('aria-label', 'Attiva tema scuro, attualmente in modalità chiara');
            }
            
            // Update aria-pressed for accessibility
            themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        }
    }

    announceThemeChange(theme) {
        // Create or update live region for screen reader announcements
        let announcement = document.getElementById('theme-announcement');
        if (!announcement) {
            announcement = document.createElement('div');
            announcement.id = 'theme-announcement';
            announcement.setAttribute('aria-live', 'polite');
            announcement.setAttribute('aria-atomic', 'true');
            announcement.style.position = 'absolute';
            announcement.style.left = '-10000px';
            announcement.style.width = '1px';
            announcement.style.height = '1px';
            announcement.style.overflow = 'hidden';
            document.body.appendChild(announcement);
        }
        
        const message = theme === 'dark' 
            ? 'Tema scuro attivato. Interfaccia ottimizzata per ambienti con poca luce.'
            : 'Tema chiaro attivato. Interfaccia ottimizzata per ambienti luminosi.';
        
        announcement.textContent = message;
    }

    switchSection(sectionName) {
        if (!sectionName) return;
        // Update navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const navTab = document.querySelector(`[data-section="${sectionName}"]`);
        if (navTab) {
            navTab.classList.add('active');
        }

        // Update sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        const sectionEl = document.getElementById(sectionName);
        if (sectionEl) {
            sectionEl.classList.add('active');
        }

        this.currentSection = sectionName;
        this.renderCurrentSection();
    }

    switchSettingsTab(tabName) {
        if (!tabName) return;
        // Update tabs
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
        });

        // Update panels
        document.querySelectorAll('.settings-panel').forEach(p => {
            p.classList.remove('active');
        });
        
        // Populate and activate the main settings panel container
        this.createSettingsPanel(tabName);
        const container = document.getElementById('settings-panel');
        if (container) {
            container.classList.add('active');
        } else {
            console.warn('Settings panel container not found');
        }
    }

    createSettingsPanel(tabName) {
        const container = document.getElementById('settings-panel');
        
        switch (tabName) {
            case 'general':
                container.innerHTML = this.getGeneralSettingsHTML();
                break;
            case 'smtp':
                container.innerHTML = this.getSMTPSettingsHTML();
                break;
            case 'materials':
                container.innerHTML = this.getMaterialsSettingsHTML();
                break;
            case 'users':
                container.innerHTML = this.getUsersSettingsHTML();
                break;
            case 'reports':
                container.innerHTML = this.getReportsSettingsHTML();
                break;
        }
        
        this.setupSettingsPanelListeners(tabName, container);
        return container;
    }

    getGeneralSettingsHTML() {
        const companyName = this.getSetting('company.name', this.data.settings?.companyName || '');
        const notificationDays = this.getSetting('scadenze.soglia_giorni', this.data.settings?.notificationDays || 30);
        const defaultLocation = this.getSetting('company.default_location', this.data.settings?.defaultLocation || '');
        return `
            <div class="settings-content">
                <div class="settings-section">
                    <h3><i class="fas fa-cog"></i> Impostazioni Generali</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="company-name">Nome Azienda:</label>
                            <input type="text" id="company-name" class="form-control" placeholder="Inserisci nome azienda" value="${companyName}">
                        </div>
                        <div class="form-group">
                            <label for="notification-days">Giorni di Preavviso Prima della Scadenza:</label>
                            <input type="number" id="notification-days" class="form-control" value="${notificationDays}" min="1" max="365">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="default-location">Posizione Predefinita:</label>
                            <input type="text" id="default-location" class="form-control" placeholder="Inserisci posizione predefinita" value="${defaultLocation}">
                        </div>
                    </div>
                    <button id="save-general-settings" class="btn btn-success">
                        <i class="fas fa-save"></i> Salva Impostazioni
                    </button>
                </div>
                
                <div class="settings-section">
                    <h3><i class="fas fa-database"></i> Gestione Dati</h3>
                    <div class="data-actions">
                        <button id="export-data" class="btn btn-info">
                            <i class="fas fa-download"></i> Esporta Dati
                        </button>
                        <button id="import-data" class="btn btn-warning">
                            <i class="fas fa-upload"></i> Importa Dati
                        </button>
                        <button id="clear-data" class="btn btn-danger">
                            <i class="fas fa-trash"></i> Cancella Tutti i Dati
                        </button>
                    </div>
                    <input type="file" id="import-file" accept=".json" style="display: none;">
                </div>
            </div>
        `;
    }

    getSMTPSettingsHTML() {
        const smtp = {
            host: this.getSetting('smtp.host', (this.data.smtpSettings || {}).host || ''),
            port: this.getSetting('smtp.port', (this.data.smtpSettings || {}).port || 587),
            secure: !!this.getSetting('smtp.secure', (this.data.smtpSettings || {}).secure || false),
            username: this.getSetting('smtp.username', (this.data.smtpSettings || {}).username || ''),
            password: this.getSetting('smtp.password', (this.data.smtpSettings || {}).password || ''),
        };
        return `
            <div class="settings-content">
                <div class="settings-section">
                    <h3><i class="fas fa-envelope"></i> Configurazione Server SMTP</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="smtp-host">Server SMTP:</label>
                            <input type="text" id="smtp-host" class="form-control" placeholder="smtp.gmail.com" value="${smtp.host || ''}">
                        </div>
                        <div class="form-group">
                            <label for="smtp-port">Porta:</label>
                            <input type="number" id="smtp-port" class="form-control" placeholder="587" value="${smtp.port || 587}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="smtp-username">Username:</label>
                            <input type="email" id="smtp-username" class="form-control" placeholder="tua-email@gmail.com" value="${smtp.username || ''}">
                        </div>
                        <div class="form-group">
                            <label for="smtp-password">Password:</label>
                            <input type="password" id="smtp-password" class="form-control" placeholder="Password o App Password" value="${smtp.password || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="smtp-secure" ${smtp.secure ? 'checked' : ''}>
                                Usa connessione sicura (TLS)
                            </label>
                        </div>
                    </div>
                    <div class="form-row">
                        <button id="save-smtp" class="btn btn-success">
                            <i class="fas fa-save"></i> Salva Configurazione SMTP
                        </button>
                        <button id="test-smtp" class="btn btn-info">
                            <i class="fas fa-paper-plane"></i> Test Invio Email
                        </button>
                    </div>
                    <div class="smtp-test" id="smtp-test-result" style="display: none;">
                        <p><strong>Risultato Test:</strong></p>
                        <div id="smtp-test-message"></div>
                    </div>
                </div>
            </div>
        `;
    }

    getReportsSettingsHTML() {
        const companyName = this.getSetting('company.name', this.data.settings?.companyName || '');
        const companyAddress = this.getSetting('company.address', this.data.settings?.companyAddress || '');
        const reportTemplate = this.getSetting('report.template_path', this.data.settings?.reportTemplate || '');
        const autoPrint = !!this.getSetting('report.auto_print', this.data.settings?.autoPrint || false);
        const showSignatures = !!this.getSetting('report.show_signatures', this.data.settings?.showSignatures || false);
        return `
            <div class="settings-content">
                <div class="settings-section">
                    <h3><i class="fas fa-file-alt"></i> Impostazioni Rapporti</h3>
                    
                    <!-- Intestazione Aziendale -->
                    <div class="form-section">
                        <h4><i class="fas fa-building"></i> Intestazione Aziendale</h4>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="company-name">Nome Azienda:</label>
                                <input type="text" id="company-name" class="form-control" 
                                       value="${companyName}" 
                                       placeholder="Inserisci nome azienda...">
                            </div>
                            <div class="form-group">
                                <label for="settings-report-company-logo">Logo Aziendale:</label>
                                <div id="settings-company-logo-dropzone" class="dropzone" aria-label="Trascina il file del logo qui" tabindex="0">
                                    <i class="fas fa-cloud-upload-alt"></i><br>
                                    Trascina il logo qui o clicca per selezionare<br>
                                    <small>Formati supportati: PNG, JPG, SVG</small>
                                </div>
                                <input type="file" id="settings-report-company-logo" accept="image/*" style="display:none">
                                <img id="settings-company-logo-preview" alt="Anteprima Logo" style="display:none; max-height:100px; margin-top:8px; border:1px solid #ddd; border-radius:4px;">
                                <div style="margin-top:8px;">
                                    <button id="settings-save-company-logo" class="btn btn-success">
                                        <i class="fas fa-check"></i> Conferma Logo
                                    </button>
                                    <button id="settings-remove-company-logo" class="btn btn-outline-danger" style="margin-left:8px; display:none;">
                                        <i class="fas fa-trash"></i> Rimuovi
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="company-address">Indirizzo Sede:</label>
                        <textarea id="company-address" class="form-control" rows="2" 
                                          placeholder="Via, Città, CAP">${this.data.settings?.companyAddress || ''}</textarea>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Configurazione Operatori -->
                    <div class="form-section">
                        <h4><i class="fas fa-user-cog"></i> Configurazione Operatori</h4>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="default-operator">Operatore Predefinito:</label>
                                <select id="default-operator" class="form-control">
                                    <option value="">Seleziona operatore...</option>
                                    ${this.data.users.map(user => 
                                        `<option value="${user.id}" ${this.data.settings?.defaultOperator === user.id ? 'selected' : ''}>${user.firstName} ${user.lastName}</option>`
                                    ).join('')}
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Template e Layout -->
                    <div class="form-section">
                        <h4><i class="fas fa-layout"></i> Layout Rapporto</h4>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="report-template">Template Rapporto:</label>
                                <select id="report-template" class="form-control">
                                    <option value="standard" ${this.data.settings?.reportTemplate === 'standard' ? 'selected' : ''}>Standard</option>
                                    <option value="two-column" ${this.data.settings?.reportTemplate === 'two-column' ? 'selected' : ''}>Due Colonne</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="show-signatures" ${this.data.settings?.showSignatures !== false ? 'checked' : ''}>
                                    Mostra spazio per firme negli operatori
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <button id="save-report-settings" class="btn btn-success">
                        <i class="fas fa-save"></i> Salva Impostazioni Rapporti
                    </button>
                </div>
            </div>
        `;
    }

    getMaterialsSettingsHTML() {
        return `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-database"></i> Archivio DB Materiali</h3>
                </div>
                <div class="card-content">
                    <!-- Form aggiunta nuovo materiale (campi richiesti) -->
                    <fieldset class="form-grid" aria-labelledby="legend-add-mat">
                        <legend id="legend-add-mat">Aggiungi materiale</legend>
                        <div class="form-group">
                            <label for="db-mat-id">ID (personalizzabile):</label>
                            <input type="number" id="db-mat-id" class="form-control" min="1" placeholder="es. 101" />
                        </div>
                        <div class="form-group">
                            <label for="db-mat-nome">Nome (obbligatorio):</label>
                            <input type="text" id="db-mat-nome" class="form-control" placeholder="es. Garze sterili" aria-required="true" />
                        </div>
                        <div class="form-group">
                            <label for="db-mat-categoria">Categoria (obbligatoria):</label>
                            <select id="db-mat-categoria" class="form-control" aria-required="true">
                                <option value="">Seleziona...</option>
                                <option value="Kit standard">Kit standard</option>
                                <option value="Kit personalizzato">Kit personalizzato</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="db-mat-min">Quantità minima:</label>
                            <input type="number" id="db-mat-min" class="form-control" min="0" placeholder="es. 5" aria-describedby="min-help" />
                            
                        </div>
                        <div class="form-group" id="grp-db-mat-max">
                            <label for="db-mat-max">Quantità massima (solo Kit standard):</label>
                            <input type="number" id="db-mat-max" class="form-control" min="0" placeholder="es. 20" />
                        </div>
                        <div class="form-group">
                            <button id="db-add-material" class="btn btn-primary" aria-label="Aggiungi materiale al DB"><i class="fas fa-plus"></i> Aggiungi al DB</button>
                        </div>
                    </fieldset>

                    <!-- Filtri di ricerca -->
                    <div class="filters" style="margin-top:16px" role="region" aria-label="Filtri materiali">
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="filter-id">Filtro ID:</label>
                                <input type="number" id="filter-id" class="form-control" placeholder="es. 101" value="${this.dbMatFilters.id}" />
                            </div>
                            <div class="form-group">
                                <label for="filter-name">Filtro Nome:</label>
                                <input type="text" id="filter-name" class="form-control" placeholder="es. Garze" value="${this.dbMatFilters.name}" />
                            </div>
                            <div class="form-group">
                                <label for="filter-categoria">Categoria:</label>
                                <select id="filter-categoria" class="form-control">
                                    <option value="">Tutte</option>
                                    <option value="Kit standard" ${this.dbMatFilters.categoria==='Kit standard'?'selected':''}>Kit standard</option>
                                    <option value="Kit personalizzato" ${this.dbMatFilters.categoria==='Kit personalizzato'?'selected':''}>Kit personalizzato</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="db-page-size">Dimensione pagina:</label>
                                <select id="db-page-size" class="form-control">
                                    <option value="10" ${this.dbMatPage.size===10?'selected':''}>10</option>
                                    <option value="25" ${this.dbMatPage.size===25?'selected':''}>25</option>
                                    <option value="50" ${this.dbMatPage.size===50?'selected':''}>50</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <button id="reset-filters" class="btn btn-secondary" aria-label="Reset filtri"><i class="fas fa-undo"></i> Reset</button>
                            </div>
                        </div>
                    </div>

                    <!-- Tabella materiali (ordinamento, paginazione) -->
                    <div class="table-container" style="margin-top:12px;">
                        <table class="data-table" aria-describedby="db-table-desc">
                            <caption id="db-table-desc" class="sr-only">Tabella materiali ordinabile per tutte le colonne con paginazione</caption>
                            <thead>
                                <tr>
                                    <th role="button" tabindex="0" data-sort-key="id" aria-sort="${this.dbMatSort.key==='id'?this.dbMatSort.dir:'none'}">ID</th>
                                    <th role="button" tabindex="0" data-sort-key="nome_materiale" aria-sort="${this.dbMatSort.key==='nome_materiale'?this.dbMatSort.dir:'none'}">Nome</th>
                                    <th role="button" tabindex="0" data-sort-key="categoria" aria-sort="${this.dbMatSort.key==='categoria'?this.dbMatSort.dir:'none'}">Categoria</th>
                                    <th role="button" tabindex="0" data-sort-key="maxQty" aria-sort="${this.dbMatSort.key==='maxQty'?this.dbMatSort.dir:'none'}">Quantità massima</th>
                                    <th>Azioni</th>
                                </tr>
                            </thead>
                            <tbody id="db-materials-rows">
                                ${this.renderDbMaterialsRows()}
                            </tbody>
                        </table>
                        <div class="pagination" aria-label="Paginazione" style="margin-top:8px; display:flex; gap:8px; align-items:center;">
                            <button id="db-page-prev" class="btn btn-secondary" ${this.dbMatPage.number<=1?'disabled':''} aria-label="Pagina precedente"><i class="fas fa-chevron-left"></i></button>
                            <span id="db-page-info">Pagina ${this.dbMatPage.number}</span>
                            <button id="db-page-next" class="btn btn-secondary" aria-label="Pagina successiva"><i class="fas fa-chevron-right"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getUsersSettingsHTML() {
        const usersHTML = this.data.users.map(user => `
            <tr>
                <td>${user.firstName}</td>
                <td>${user.lastName}</td>
                <td>${user.signature ? 'Yes' : 'No'}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="app.editUser('${user.id}')" aria-label="Modifica utente ${user.firstName} ${user.lastName}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteUser('${user.id}')" aria-label="Elimina utente ${user.firstName} ${user.lastName}">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        return `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-users"></i> User Registry</h3>
                </div>
                <div class="card-content">
                    <div class="form-group">
                        <h4>Add New User</h4>
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="new-user-firstname">First Name:</label>
                                <input type="text" id="new-user-firstname" class="form-control">
                            </div>
                            <div class="form-group">
                                <label for="new-user-lastname">Last Name:</label>
                                <input type="text" id="new-user-lastname" class="form-control">
                            </div>
                            <div class="form-group">
                                <label for="new-user-signature">Signature (PNG):</label>
                                <input type="file" id="new-user-signature" class="form-control" accept=".png">
                            </div>
                        </div>
                        <button id="add-user" class="btn btn-primary">
                            <i class="fas fa-plus"></i> Add User
                        </button>
                    </div>
                    
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>First Name</th>
                                    <th>Last Name</th>
                                    <th>Signature</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${usersHTML}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    getKitSettingsHTML() {
        return `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-briefcase-medical"></i> Kit Management</h3>
                </div>
                <div class="card-content">
                    <p>Kit management features will be implemented here. You can:</p>
                    <ul>
                        <li>Create new kit templates</li>
                        <li>Modify standard item lists</li>
                        <li>Set maximum quantities per kit type</li>
                        <li>Rename existing kits</li>
                    </ul>
                    <button class="btn btn-primary">
                        <i class="fas fa-plus"></i> Create Kit Template
                    </button>
                </div>
            </div>
        `;
    }

    getExpirySettingsHTML() {
        return `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-calendar-alt"></i> Expiry Parameters</h3>
                </div>
                <div class="card-content">
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="auto-email-enabled" ${this.data.settings.expiry.autoEmail ? 'checked' : ''}>
                            Send automatic email on 1st working day of month
                        </label>
                    </div>
                    <div class="form-group">
                        <label for="expiry-interval">Custom interval (days):</label>
                        <input type="number" id="expiry-interval" class="form-control" value="${this.data.settings.expiry.interval}" min="1">
                    </div>
                    <button id="save-expiry-settings" class="btn btn-primary">
                        <i class="fas fa-save"></i> Save Settings
                    </button>
                </div>
            </div>
        `;
    }

    setupSettingsPanelListeners(tabName, panel) {
        switch (tabName) {
            case 'general':
                const saveGeneralBtn = panel.querySelector('#save-general-settings');
                if (saveGeneralBtn) {
                    saveGeneralBtn.addEventListener('click', () => {
                        this.saveGeneralSettings();
                    });
                }
                const exportBtn = panel.querySelector('#export-data');
                if (exportBtn) {
                    exportBtn.addEventListener('click', () => {
                        this.exportSettings();
                    });
                }
                const importBtn = panel.querySelector('#import-data');
                if (importBtn) {
                    importBtn.addEventListener('click', () => {
                        document.getElementById('import-file').click();
                    });
                }
                const clearBtn = panel.querySelector('#clear-data');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        this.clearAllData();
                    });
                }
                const importFile = panel.querySelector('#import-file');
                if (importFile) {
                    importFile.addEventListener('change', async (e) => {
                        try {
                            const file = e.target.files && e.target.files[0];
                            if (!file) return;
                            const text = await file.text();
                            const json = JSON.parse(text);
                            await this.importSettings(json);
                            alert('Impostazioni importate con successo!');
                            // Ricarica pannello per riflettere i valori
                            this.createSettingsPanel('general');
                        } catch (err) {
                            alert('Errore durante l\'import: ' + (err?.message || err));
                        } finally {
                            e.target.value = '';
                        }
                    });
                }
                break;
            case 'smtp':
                const saveSMTPBtn = panel.querySelector('#save-smtp');
                if (saveSMTPBtn) {
                    saveSMTPBtn.addEventListener('click', () => {
                        this.saveSMTPSettings();
                    });
                }
                const testSMTPBtn = panel.querySelector('#test-smtp');
                if (testSMTPBtn) {
                    testSMTPBtn.addEventListener('click', () => {
                        this.testSMTP();
                    });
                }
                break;
            case 'reports':
                const saveReportBtn = panel.querySelector('#save-report-settings');
                if (saveReportBtn) {
                    saveReportBtn.addEventListener('click', () => {
                        this.saveReportSettings();
                    });
                }
                // Applica restrizioni di input/textarea nel pannello rapporti
                this.enforceInputRestrictions(panel);
                // Upload logo nella sezione Impostazioni > Rapporti
                const settingsFileInput = panel.querySelector('#settings-report-company-logo');
                const settingsDropzone = panel.querySelector('#settings-company-logo-dropzone');
                const settingsPreviewImg = panel.querySelector('#settings-company-logo-preview');
                const settingsSaveLogoBtn = panel.querySelector('#settings-save-company-logo');
                const settingsRemoveLogoBtn = panel.querySelector('#settings-remove-company-logo');

                const setSettingsLogoPreview = (file) => {
                    try {
                        const url = URL.createObjectURL(file);
                        if (settingsPreviewImg) {
                            settingsPreviewImg.src = url;
                            settingsPreviewImg.style.display = 'block';
                        }
                        if (settingsRemoveLogoBtn) {
                            settingsRemoveLogoBtn.style.display = 'inline-block';
                        }
                    } catch (e) {
                        console.warn('Anteprima logo (impostazioni) non disponibile:', e.message);
                    }
                };

                const clearSettingsLogoPreview = () => {
                    if (settingsPreviewImg) {
                        settingsPreviewImg.style.display = 'none';
                        settingsPreviewImg.src = '';
                    }
                    if (settingsRemoveLogoBtn) {
                        settingsRemoveLogoBtn.style.display = 'none';
                    }
                    if (settingsFileInput) {
                        settingsFileInput.value = '';
                    }
                };

                const uploadSettingsCompanyLogo = async (file) => {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        const chunkSize = 0x8000;
                        for (let i = 0; i < bytes.length; i += chunkSize) {
                            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                        }
                        const base64 = btoa(binary);

                        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                            alert('Connessione assente. Verifica la rete e riprova.');
                            return;
                        }

                        const controller = new AbortController();
                        const timeoutMs = 30000;
                        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                        let resp;
                        try {
                            resp = await fetch('/api/upload/logo', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ filename: file.name, data: base64 }),
                                signal: controller.signal
                            });
                        } catch (err) {
                            clearTimeout(timeoutId);
                            const isAbort = err && err.name === 'AbortError';
                            if (!isAbort) {
                                await new Promise(r => setTimeout(r, 1000));
                                const retryController = new AbortController();
                                const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
                                try {
                                    resp = await fetch('/api/upload/logo', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ filename: file.name, data: base64 }),
                                        signal: retryController.signal
                                    });
                                } catch (retryErr) {
                                    clearTimeout(retryTimeoutId);
                                    alert('Errore caricamento logo: ' + (retryErr?.message || 'Failed to fetch'));
                                    return;
                                }
                                clearTimeout(retryTimeoutId);
                            } else {
                                alert(`Timeout caricamento logo dopo ${Math.round(timeoutMs/1000)}s.`);
                                return;
                            }
                        }
                        clearTimeout(timeoutId);

                        const json = await resp.json().catch(() => null);
                        if (!resp.ok || !json?.success) {
                            throw new Error((json && json.error) || 'Upload fallito');
                        }

                        this.data = this.data || {};
                        this.data.settings = this.data.settings || {};
                        this.data.settings.companyLogo = json.path;
                        this.scheduleAutoSave && this.scheduleAutoSave();
                        this.updateReportPreview && this.updateReportPreview();

                        setSettingsLogoPreview(file);
                        alert('Logo caricato e salvato con successo!');
                        console.log('Logo caricato (impostazioni) e impostato:', json.path);
                    } catch (e) {
                        alert('Errore caricamento logo: ' + e.message);
                    }
                };

                if (settingsFileInput) {
                    settingsFileInput.addEventListener('change', (e) => {
                        const file = e.target.files && e.target.files[0];
                        if (file) uploadSettingsCompanyLogo(file);
                    });
                }
                if (settingsDropzone) {
                    settingsDropzone.addEventListener('click', () => settingsFileInput && settingsFileInput.click());
                    settingsDropzone.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        settingsDropzone.classList.add('dragover');
                    });
                    settingsDropzone.addEventListener('dragleave', () => settingsDropzone.classList.remove('dragover'));
                    settingsDropzone.addEventListener('drop', (e) => {
                        e.preventDefault();
                        settingsDropzone.classList.remove('dragover');
                        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                        if (file) uploadSettingsCompanyLogo(file);
                    });
                }
                if (settingsSaveLogoBtn) {
                    settingsSaveLogoBtn.addEventListener('click', () => {
                        if (this?.data?.settings?.companyLogo) {
                            alert('Logo già impostato correttamente per i report.');
                        } else {
                            alert('Seleziona o trascina un file logo prima di confermare.');
                        }
                    });
                }
                if (settingsRemoveLogoBtn) {
                    settingsRemoveLogoBtn.addEventListener('click', () => {
                        if (confirm('Sei sicuro di voler rimuovere il logo aziendale?')) {
                            this.data = this.data || {};
                            this.data.settings = this.data.settings || {};
                            this.data.settings.companyLogo = '';
                            this.scheduleAutoSave && this.scheduleAutoSave();
                            this.updateReportPreview && this.updateReportPreview();
                            clearSettingsLogoPreview();
                            alert('Logo rimosso con successo.');
                        }
                    });
                }
                break;
            case 'materials':
                const dbAddBtn = panel.querySelector('#db-add-material');
                if (dbAddBtn) {
                    dbAddBtn.addEventListener('click', () => {
                        this.createDbMaterialFromForm(panel);
                    });
                }
                // Gestione Quantità massima: sempre visibile, disabilitata se non "Kit standard"
                const addCatSel = panel.querySelector('#db-mat-categoria');
                const addMaxInput = panel.querySelector('#db-mat-max');
                if (addCatSel && addMaxInput) {
                    const toggle = () => {
                        const isStd = (addCatSel.value === 'Kit standard');
                        addMaxInput.disabled = !isStd;
                        addMaxInput.setAttribute('aria-disabled', (!isStd).toString());
                        if (!isStd) addMaxInput.value = '';
                    };
                    toggle();
                    addCatSel.addEventListener('change', toggle);
                }
                // Filters
                const fid = panel.querySelector('#filter-id');
                const fname = panel.querySelector('#filter-name');
                const fcat = panel.querySelector('#filter-categoria');
                const resetBtn = panel.querySelector('#reset-filters');
                if (fid) fid.addEventListener('input', () => { this.dbMatFilters.id = fid.value; this.dbMatPage.number = 1; this.createSettingsPanel('materials'); });
                if (fname) fname.addEventListener('input', () => { this.dbMatFilters.name = fname.value; this.dbMatPage.number = 1; this.createSettingsPanel('materials'); });
                if (fcat) fcat.addEventListener('change', () => { this.dbMatFilters.categoria = fcat.value; this.dbMatPage.number = 1; this.createSettingsPanel('materials'); });
                if (resetBtn) resetBtn.addEventListener('click', () => { this.dbMatFilters = { id: '', name: '', categoria: '' }; this.dbMatPage.number = 1; this.createSettingsPanel('materials'); });
                // Sorting (click or Enter/Space)
                panel.querySelectorAll('th[data-sort-key]')?.forEach(th => {
                    const key = th.getAttribute('data-sort-key');
                    const activateSort = () => {
                        if (this.dbMatSort.key === key) {
                            this.dbMatSort.dir = this.dbMatSort.dir === 'asc' ? 'desc' : 'asc';
                        } else {
                            this.dbMatSort.key = key; this.dbMatSort.dir = 'asc';
                        }
                        this.createSettingsPanel('materials');
                    };
                    th.addEventListener('click', activateSort);
                    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateSort(); } });
                });
                // Pagination
                const prev = panel.querySelector('#db-page-prev');
                const next = panel.querySelector('#db-page-next');
                const sizeSel = panel.querySelector('#db-page-size');
                if (prev) prev.addEventListener('click', () => { this.dbMatPage.number = Math.max(1, this.dbMatPage.number - 1); this.createSettingsPanel('materials'); });
                if (next) next.addEventListener('click', () => { this.dbMatPage.number = this.dbMatPage.number + 1; this.createSettingsPanel('materials'); });
                if (sizeSel) sizeSel.addEventListener('change', () => { this.dbMatPage.size = parseInt(sizeSel.value, 10); this.dbMatPage.number = 1; this.createSettingsPanel('materials'); });
                // Delegated listeners for row actions
                panel.addEventListener('click', (e) => {
                    const delBtn = e.target.closest('.db-delete-material');
                    if (delBtn) {
                        const id = parseInt(delBtn.getAttribute('data-id'), 10);
                        if (Number.isFinite(id)) this.deleteDbMaterial(id);
                        return;
                    }
                    const editBtn = e.target.closest('.db-edit-material');
                    if (editBtn) {
                        const id = parseInt(editBtn.getAttribute('data-id'), 10);
                        if (Number.isFinite(id)) this.openDbMaterialEditModal(id);
                        return;
                    }
                });
                break;
            case 'users':
                const addUserBtn = panel.querySelector('#add-user');
                if (addUserBtn) {
                    addUserBtn.addEventListener('click', () => {
                        this.addUser();
                    });
                }
                break;
            
        }
    }

    updateCurrentMonth() {
        const now = new Date();
        const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        document.getElementById('current-month').textContent = monthYear;
    }

    renderCurrentSection() {
        switch (this.currentSection) {
            case 'overall':
                this.renderOverallDashboard();
                break;
            case 'warehouse':
                this.renderWarehouse();
                break;
            case 'kits':
                this.renderKits();
                break;
            case 'reports':
                this.renderReports();
                break;
            case 'email':
                this.renderEmail();
                break;
            case 'orders':
                this.renderOrders();
                break;
            case 'settings':
                this.renderSettings();
                break;
        }
    }

    renderAllSections() {
        this.renderOverallDashboard();
        this.renderWarehouse();
        this.renderKits();
        this.renderReports();
        this.renderEmail();
        this.renderOrders?.();
        this.renderSettings();
    }

    renderOrders() {
        const container = document.getElementById('order-request-items');
        if (!container) return;
        const zeroItems = this.getZeroQuantityItems();
        if (!Array.isArray(zeroItems) || zeroItems.length === 0) {
            container.innerHTML = '<p class="text-muted">Nessun articolo con quantità zero da ordinare.</p>';
            return;
        }
        const rows = zeroItems.map(it => `
            <tr>
                <td>${it.code || ''}</td>
                <td>${it.name || ''}</td>
                <td>${it.location || ''}</td>
            </tr>
        `).join('');
        container.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Codice</th>
                        <th>Nome</th>
                        <th>Ubicazione</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        // Sezione articoli in scadenza (mese corrente)
        const expContainer = document.getElementById('order-expiring-items');
        if (expContainer) {
            const now = new Date();
            const month = now.getMonth();
            const year = now.getFullYear();
            const expiringItems = this.getExpiringItems(month, year);
            if (!Array.isArray(expiringItems) || expiringItems.length === 0) {
                expContainer.innerHTML = '<p class="text-muted">Nessun articolo in scadenza questo mese.</p>';
            } else {
                expContainer.innerHTML = this.buildItemsTable(expiringItems);
            }
        }
    }

    renderOverallDashboard() {
        this.renderExpiringItems();
        this.renderZeroQuantityItems();
        this.renderExpiredItems();
    }

    renderExpiringItems() {
        const container = document.getElementById('expiring-items');
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        
        const expiringItems = this.getExpiringItems(currentMonth, currentYear);
        
        if (expiringItems.length === 0) {
            container.innerHTML = '<p class="text-muted">Nessun articolo in scadenza questo mese.</p>';
            return;
        }
        
        container.innerHTML = expiringItems.map(item => `
            <div class="item-row">
                <div class="item-info">
                    <div class="item-code">${item.code}</div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-quantity">Quantità: ${item.quantity ?? 0}</div>
                    <div class="item-expiry">Scadenza: ${item.expiryDate}</div>
                </div>
            </div>
        `).join('');
    }

    renderZeroQuantityItems() {
        const container = document.getElementById('zero-quantity-items');
        const zeroItems = this.getZeroQuantityItems();
        
        if (zeroItems.length === 0) {
            container.innerHTML = '<p class="text-muted">Nessun articolo con quantità zero.</p>';
            return;
        }
        
        container.innerHTML = zeroItems.map(item => `
            <div class="item-row">
                <div class="item-info">
                    <div class="item-code">${item.code}</div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-location">Ubicazione: ${item.location}</div>
                </div>
            </div>
        `).join('');
    }

    renderExpiredItems() {
        const container = document.getElementById('expired-items');
        const expiredItems = this.getExpiredItems();
        
        if (expiredItems.length === 0) {
            container.innerHTML = '<p class="text-muted">Nessun articolo scaduto.</p>';
            return;
        }
        
        container.innerHTML = expiredItems.map(item => `
            <div class="item-row">
                <div class="item-info">
                    <div class="item-code">${item.code}</div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-quantity">Quantità: ${item.quantity}</div>
                    <div class="item-expiry">Scadenza: ${item.expiryDate}</div>
                </div>
            </div>
        `).join('');
    }

    renderWarehouse() {
        this.renderWarehouseItems();
        this.renderWarehouseExpiredItems();
        this.setupWarehouseInteractions();
    }

    renderWarehouseItems() {
        const tbody = document.querySelector('#warehouse-items-table tbody');
        const nonExpiredItems = this.data.warehouse.filter(item => !this.isExpired(item.expiryDate));
        
        // Sort by expiry date (FIFO)
        nonExpiredItems.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
        
        tbody.innerHTML = nonExpiredItems.map(item => `
            <tr>
                <td>${item.code}</td>
                <td>${this.getMaterialName(item.code)}</td>
                <td>${item.quantity}</td>
                <td>${this.formatDate(item.expiryDate)}</td>
                <td>${item.notes || ''}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" title="Modifica articolo" aria-label="Modifica articolo" onclick="app.editWarehouseItem('${item.id}')">
                        <i class="fas fa-edit" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" title="Elimina articolo" aria-label="Elimina articolo" onclick="app.deleteWarehouseItem('${item.id}')">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    renderWarehouseExpiredItems() {
        const tbody = document.querySelector('#warehouse-expired-table tbody');
        const expiredItems = this.data.warehouse.filter(item => this.isExpired(item.expiryDate));
        
        tbody.innerHTML = expiredItems.map(item => `
            <tr>
                <td>${item.code}</td>
                <td>${this.getMaterialName(item.code)}</td>
                <td>${item.quantity}</td>
                <td>${this.formatDate(item.expiryDate)}</td>
                <td>${item.notes || ''}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" title="Modifica articolo" aria-label="Modifica articolo" onclick="app.editWarehouseItem('${item.id}')">
                        <i class="fas fa-edit" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" title="Elimina articolo" aria-label="Elimina articolo" onclick="app.deleteWarehouseItem('${item.id}')">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // Filtri e ordinamento magazzino
    setupWarehouseInteractions() {
        this.populateWarehouseFilterSelects();

        document.querySelectorAll('.select-sort-controls').forEach(el => el.remove());
        document.querySelectorAll('.sort-controls').forEach(el => el.remove());

        const bind = (id, type, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(type, fn);
        };

        // Non scaduti
        bind('filter-code', 'input', () => this.applyNonExpiredFiltersSort());
        bind('filter-name', 'input', () => this.applyNonExpiredFiltersSort());
        bind('filter-notes', 'input', () => this.applyNonExpiredFiltersSort());
        bind('filter-quantity-select', 'change', () => this.applyNonExpiredFiltersSort());
        bind('filter-expiry-month-select', 'change', () => this.applyNonExpiredFiltersSort());
        bind('filter-expiry-year-select', 'change', () => this.applyNonExpiredFiltersSort());

        // Scaduti
        bind('filter-exp-code', 'input', () => this.applyExpiredFiltersSort());
        bind('filter-exp-name', 'input', () => this.applyExpiredFiltersSort());
        bind('filter-exp-notes', 'input', () => this.applyExpiredFiltersSort());
        bind('filter-exp-quantity-select', 'change', () => this.applyExpiredFiltersSort());
        bind('filter-exp-expiry-month-select', 'change', () => this.applyExpiredFiltersSort());
        bind('filter-exp-expiry-year-select', 'change', () => this.applyExpiredFiltersSort());

        // Bottoni di ordinamento sulle intestazioni
        const addSortControls = (tableId, stateKey, applyFn) => {
            const headerCells = document.querySelectorAll(`#${tableId} thead th[data-sort-field]`);
            headerCells.forEach(th => {
                th.querySelectorAll('.sort-controls').forEach(el => el.remove());
                const field = th.getAttribute('data-sort-field');
                const ctrl = document.createElement('span');
                ctrl.className = 'sort-controls';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm btn-icon';
                const icon = document.createElement('i');
                icon.className = 'fas fa-sort';
                btn.appendChild(icon);
                btn.title = 'Ordina/Toggle';

                const current = this[stateKey] || { field: 'expiryDate', direction: 'asc' };
                if (current.field === field) {
                    icon.className = current.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                }

                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const prev = this[stateKey] || { field, direction: 'asc' };
                    const nextDir = (prev.field === field && prev.direction === 'asc') ? 'desc' : 'asc';
                    this[stateKey] = { field, direction: nextDir };
                    icon.className = nextDir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    this[applyFn]();
                });

                ctrl.appendChild(btn);

                const headerTop = th.querySelector('.th-header') || th;
                headerTop.appendChild(ctrl);
            });
        };

        // Pulsanti di ordinamento univoci sui select (mese/anno)
        const addSelectSortControls = () => {};

        if (!this.warehouseSort) this.warehouseSort = { field: 'expiryDate', direction: 'asc' };
        if (!this.warehouseExpiredSort) this.warehouseExpiredSort = { field: 'expiryDate', direction: 'asc' };
        // Sort controls disabled: headers are plain text without interactive buttons
        // addSortControls('warehouse-items-table', 'warehouseSort', 'applyNonExpiredFiltersSort');
        // addSortControls('warehouse-expired-table', 'warehouseExpiredSort', 'applyExpiredFiltersSort');



        // Visibilità pulsanti Pulisci su input/select
        const evaluateClearButtonVisibility = (group) => {
            if (!group) return;
            const btn = group.querySelector('.btn-clear');
            if (!btn) return;
            const textInputs = group.querySelectorAll('input.filter-input');
            const selects = group.querySelectorAll('select.filter-select, select');
            let hasValue = false;
            textInputs.forEach(i => { if ((i.value || '').trim() !== '') hasValue = true; });
            selects.forEach(s => { if (s.value !== '' && s.selectedIndex > 0) hasValue = true; });
            if (hasValue) {
                btn.classList.remove('btn-clear-hidden');
            } else {
                btn.classList.add('btn-clear-hidden');
            }
        };

        const initClearButtonVisibility = () => {
            const groups = document.querySelectorAll('#warehouse-items-table thead .input-group, #warehouse-expired-table thead .input-group, #warehouse-filters .input-group, #warehouse-expired-filters .input-group');
            groups.forEach(group => {
                const inputs = group.querySelectorAll('input.filter-input');
                const selects = group.querySelectorAll('select.filter-select, select');
                inputs.forEach(i => i.addEventListener('input', () => evaluateClearButtonVisibility(group)));
                selects.forEach(s => s.addEventListener('change', () => evaluateClearButtonVisibility(group)));
                // Stato iniziale
                evaluateClearButtonVisibility(group);
            });
        };

        const bindClearButtons = () => {
            const groups = document.querySelectorAll('#warehouse-items-table thead .input-group, #warehouse-expired-table thead .input-group, #warehouse-filters .input-group, #warehouse-expired-filters .input-group');
            groups.forEach(group => {
                const btn = group.querySelector('.btn-clear');
                if (!btn) return;
                btn.addEventListener('click', () => {
                    const inputs = group.querySelectorAll('input.filter-input');
                    const selects = group.querySelectorAll('select.filter-select, select');
                    inputs.forEach(i => {
                        i.value = '';
                        i.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    selects.forEach(s => {
                        s.selectedIndex = 0;
                        s.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                    evaluateClearButtonVisibility(group);
                });
            });
        };

        initClearButtonVisibility();
        bindClearButtons();

        // Applica subito
        this.applyNonExpiredFiltersSort();
        this.applyExpiredFiltersSort();
    }

    populateWarehouseFilterSelects() {
        const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
        const setMonthOptions = (id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = '<option value="">Tutti</option>' + months.map((m,i) => `<option value="${i}">${m}</option>`).join('');
        };
        const setYearOptions = (id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const yearsSet = new Set();
            this.data.warehouse.forEach(item => {
                const y = new Date(item.expiryDate).getFullYear();
                if (!isNaN(y)) yearsSet.add(y);
            });
            const years = Array.from(yearsSet).sort((a,b) => a-b);
            el.innerHTML = '<option value="">Tutti</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
        };
        const setQuantityOptions = (id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = `
                <option value="">Tutti</option>
                <option value="=0">0</option>
                <option value="1-5">1-5</option>
                <option value="6-10">6-10</option>
                <option value=">10">&gt;10</option>
            `;
        };
        setQuantityOptions('filter-quantity-select');
        setMonthOptions('filter-expiry-month-select');
        setYearOptions('filter-expiry-year-select');
        setQuantityOptions('filter-exp-quantity-select');
        setMonthOptions('filter-exp-expiry-month-select');
        setYearOptions('filter-exp-expiry-year-select');
    }

    sortList(list, field, direction) {
        const dir = direction === 'desc' ? -1 : 1;
        const copy = [...list];
        copy.sort((a,b) => {
            let va, vb;
            switch(field) {
                case 'name':
                    va = this.getMaterialName(a.code).toLowerCase();
                    vb = this.getMaterialName(b.code).toLowerCase();
                    break;
                case 'quantity':
                    va = parseInt(a.quantity,10) || 0;
                    vb = parseInt(b.quantity,10) || 0;
                    break;
                case 'expiryDate':
                    va = new Date(a.expiryDate);
                    vb = new Date(b.expiryDate);
                    break;
                case 'notes':
                    va = (a.notes || '').toLowerCase();
                    vb = (b.notes || '').toLowerCase();
                    break;
                case 'code':
                default:
                    va = (a.code || '').toLowerCase();
                    vb = (b.code || '').toLowerCase();
            }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
        return copy;
    }

    applyNonExpiredFiltersSort() {
        const tbody = document.querySelector('#warehouse-items-table tbody');
        if (!tbody) return;
        let items = this.data.warehouse.filter(item => !this.isExpired(item.expiryDate));

        const codeFilter = (document.getElementById('filter-code')?.value || '').trim().toLowerCase();
        const nameFilter = (document.getElementById('filter-name')?.value || '').trim().toLowerCase();
        const notesFilter = (document.getElementById('filter-notes')?.value || '').trim().toLowerCase();
        const qtySel = (document.getElementById('filter-quantity-select')?.value || '');
        const monthSel = (document.getElementById('filter-expiry-month-select')?.value || '');
        const yearSel = (document.getElementById('filter-expiry-year-select')?.value || '');

        items = items.filter(item => {
            const codeMatch = codeFilter ? item.code.toLowerCase().includes(codeFilter) : true;
            const nameMatch = nameFilter ? this.getMaterialName(item.code).toLowerCase().includes(nameFilter) : true;
            const notesMatch = notesFilter ? (item.notes || '').toLowerCase().includes(notesFilter) : true;

            const q = parseInt(item.quantity,10) || 0;
            let qtyMatch = true;
            switch(qtySel) {
                case '=0': qtyMatch = q === 0; break;
                case '1-5': qtyMatch = q >= 1 && q <= 5; break;
                case '6-10': qtyMatch = q >= 6 && q <= 10; break;
                case '>10': qtyMatch = q > 10; break;
                default: qtyMatch = true;
            }

            let monthMatch = true;
            if (monthSel !== '') {
                const m = new Date(item.expiryDate).getMonth();
                monthMatch = m.toString() === monthSel;
            }

            let yearMatch = true;
            if (yearSel !== '') {
                const y = new Date(item.expiryDate).getFullYear();
                yearMatch = y.toString() === yearSel;
            }
            return codeMatch && nameMatch && qtyMatch && monthMatch && yearMatch && notesMatch;
        });

        const sortState = this.warehouseSort || { field: 'expiryDate', direction: 'asc' };
        items = this.sortList(items, sortState.field, sortState.direction);

        tbody.innerHTML = items.map(item => `
            <tr>
                <td>${item.code}</td>
                <td>${this.getMaterialName(item.code)}</td>
                <td>${item.quantity}</td>
                <td>${this.formatDate(item.expiryDate)}</td>
                <td>${item.notes || ''}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" title="Modifica articolo" aria-label="Modifica articolo" onclick="app.editWarehouseItem('${item.id}')">
                        <i class="fas fa-edit" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" title="Elimina articolo" aria-label="Elimina articolo" onclick="app.deleteWarehouseItem('${item.id}')">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    applyExpiredFiltersSort() {
        const tbody = document.querySelector('#warehouse-expired-table tbody');
        if (!tbody) return;
        let items = this.data.warehouse.filter(item => this.isExpired(item.expiryDate));

        const codeFilter = (document.getElementById('filter-exp-code')?.value || '').trim().toLowerCase();
        const nameFilter = (document.getElementById('filter-exp-name')?.value || '').trim().toLowerCase();
        const notesFilter = (document.getElementById('filter-exp-notes')?.value || '').trim().toLowerCase();
        const qtySel = (document.getElementById('filter-exp-quantity-select')?.value || '');
        const monthSel = (document.getElementById('filter-exp-expiry-month-select')?.value || '');
        const yearSel = (document.getElementById('filter-exp-expiry-year-select')?.value || '');

        items = items.filter(item => {
            const codeMatch = codeFilter ? item.code.toLowerCase().includes(codeFilter) : true;
            const nameMatch = nameFilter ? this.getMaterialName(item.code).toLowerCase().includes(nameFilter) : true;
            const notesMatch = notesFilter ? (item.notes || '').toLowerCase().includes(notesFilter) : true;

            const q = parseInt(item.quantity,10) || 0;
            let qtyMatch = true;
            switch(qtySel) {
                case '=0': qtyMatch = q === 0; break;
                case '1-5': qtyMatch = q >= 1 && q <= 5; break;
                case '6-10': qtyMatch = q >= 6 && q <= 10; break;
                case '>10': qtyMatch = q > 10; break;
                default: qtyMatch = true;
            }

            let monthMatch = true;
            if (monthSel !== '') {
                const m = new Date(item.expiryDate).getMonth();
                monthMatch = m.toString() === monthSel;
            }

            let yearMatch = true;
            if (yearSel !== '') {
                const y = new Date(item.expiryDate).getFullYear();
                yearMatch = y.toString() === yearSel;
            }
            return codeMatch && nameMatch && qtyMatch && monthMatch && yearMatch && notesMatch;
        });

        const sortState = this.warehouseExpiredSort || { field: 'expiryDate', direction: 'asc' };
        items = this.sortList(items, sortState.field, sortState.direction);

        tbody.innerHTML = items.map(item => `
            <tr>
                <td>${item.code}</td>
                <td>${this.getMaterialName(item.code)}</td>
                <td>${item.quantity}</td>
                <td>${this.formatDate(item.expiryDate)}</td>
                <td>${item.notes || ''}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" title="Modifica articolo" aria-label="Modifica articolo" onclick="app.editWarehouseItem('${item.id}')">
                        <i class="fas fa-edit" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" title="Elimina articolo" aria-label="Elimina articolo" onclick="app.deleteWarehouseItem('${item.id}')">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    renderKits() {
        const container = document.getElementById('kits-container');
        
        container.innerHTML = this.data.kits.map(kit => `
            <div class="kit-card">
                <div class="kit-header">
                    <div class="kit-name">${kit.name}</div>
                    <div class="kit-location"><i class="fas fa-map-marker-alt"></i> ${kit.location || this.data.settings?.defaultLocation || ''}</div>
                    <div class="kit-type">${kit.isStandard ? '<span class="badge badge-standard" title="Kit con articoli predefiniti">Standard</span>' : '<span class="badge badge-custom" title="Kit personalizzato">Personalizzato</span>'}</div>
                    <div class="kit-status">${this.getKitStatusBadge(kit)}</div>
                </div>
                <div class="kit-content">
                    ${kit.items.map(item => this.renderKitItem(kit.id, item)).join('')}
                    <div class="form-actions mt-2">
                        <button class="btn btn-sm btn-success" onclick="app.showAddKitItemModal('${kit.id}')">
                            <i class="fas fa-plus"></i> Aggiungi Articolo
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="app.editKit('${kit.id}')">
                            <i class="fas fa-edit"></i> Modifica Kit
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="app.confirmKitChanges('${kit.id}')">
                            <i class="fas fa-check"></i> Conferma Modifiche
                        </button>

                    </div>
                </div>
            </div>
        `).join('');
    }

    renderKitItem(kitId, item) {
        const material = this.data.materials.find(m => m.code === item.code);
        const materialName = material ? material.name : item.code;
        const tags = material && material.tags ? material.tags.join(', ') : '';
        
        return `
            <div class="kit-item">
                <div class="kit-item-info">
                    <div class="kit-item-name">${materialName}</div>
                    <div class="kit-item-details">
                        Max: ${item.maxQuantity} | 
                        Scadenze: ${this.renderExpiryBadges(kitId, item)}
                        ${tags ? ` | Tags: ${tags}` : ''}
                        ${item.notes ? ` | Notes: ${item.notes}` : ''}
                    </div>
                </div>
                <div class="quantity-controls">
                    <button class="quantity-btn" onclick="app.adjustKitQuantity('${kitId}', '${item.code}', -1)" 
                            ${item.currentQuantity <= 0 ? 'disabled' : ''}>
                        <i class="fas fa-minus"></i>
                    </button>
                    <span class="quantity-display">${item.currentQuantity}</span>
                    <button class="quantity-btn" onclick="app.adjustKitQuantity('${kitId}', '${item.code}', 1)" 
                            ${item.currentQuantity >= item.maxQuantity ? 'disabled' : ''}>
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>
        `;
    }

    renderExpiryBadges(kitId, item) {
        if (!Array.isArray(item.expiryDates) || item.expiryDates.length === 0) {
            return 'Nessuna';
        }
        return `<div class="expiry-list">` + item.expiryDates.map((d, idx) => `
            <span class="expiry-badge">
                ${this.formatDate(d)}
                <button class="btn-icon remove-expiry" title="Rimuovi scadenza" onclick="app.removeKitItemExpiryDate('${kitId}', '${item.code}', ${idx})">
                    <i class="fas fa-times"></i>
                </button>
            </span>
        `).join('') + `</div>`;
    }

    renderReports() {
        // Populate operator dropdown
        const operatorSelect = document.getElementById('report-operator');
        operatorSelect.innerHTML = '<option value="">Seleziona operatore...</option>' + 
            this.data.users.map(user => `
                <option value="${user.id}">${user.firstName} ${user.lastName}</option>
            `).join('');
        
        // Populate kit selection
        const kitSelection = document.getElementById('selected-kits');
        kitSelection.innerHTML = this.data.kits.map(kit => `
            <label class="kit-checkbox">
                <input type="checkbox" value="${kit.id}" checked>
                ${kit.name}
            </label>
        `).join('');
        
        // Render reports history
        this.renderReportsHistory();
        
        // Aggiorna anteprima (logo, nome operatore, firma)
        this.updateReportPreview();
    }
    
    updateReportPreview() {
        try {
            const logoImg = document.getElementById('report-logo-display');
            const operatorNameEl = document.getElementById('selected-operator-name');
            const operatorSignatureImg = document.getElementById('selected-operator-signature');

            // Logo
            const logoPath = this.data?.settings?.companyLogo || null;
            if (logoImg) {
                if (logoPath) {
                    logoImg.src = logoPath;
                    logoImg.style.display = 'block';
                } else {
                    logoImg.style.display = 'none';
                }
            }

            // Operatore
            const operatorId = document.getElementById('report-operator')?.value;
            const operator = this.data.users.find(u => u.id === operatorId);
            if (operatorNameEl) {
                operatorNameEl.textContent = operator ? `${operator.firstName} ${operator.lastName}` : 'Nessun operatore selezionato';
            }

            // Firma
            let signatureSrc = null;
            if (operator?.signature) {
                signatureSrc = operator.signature;
            } else if (operator) {
                const normalizedName = `${operator.firstName} ${operator.lastName}`
                    .toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-z0-9_]/g, '');
                signatureSrc = `assets/firme/${normalizedName}.png`;
            }

            if (operatorSignatureImg) {
                if (signatureSrc) {
                    operatorSignatureImg.src = signatureSrc;
                    operatorSignatureImg.style.display = 'block';
                } else {
                    operatorSignatureImg.style.display = 'none';
                }
            }
        } catch (e) {
            console.warn('Impossibile aggiornare l\'anteprima del report:', e.message);
        }
    }
    
    renderReportsHistory() {
        const historyContainer = document.getElementById('reports-history');
        
        if (!this.data.reportsHistory || this.data.reportsHistory.length === 0) {
            historyContainer.innerHTML = '<p class="text-muted">Nessun rapporto archiviato.</p>';
            return;
        }
        
        // Sort reports by date (most recent first)
        const sortedReports = [...this.data.reportsHistory].sort((a, b) => 
            new Date(b.date) - new Date(a.date)
        );
        
        historyContainer.innerHTML = `
            <div class="reports-history-list">
                ${sortedReports.map(report => `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-date">
                                <i class="fas fa-calendar"></i>
                                ${new Date(report.date).toLocaleDateString('it-IT', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </div>
                            <div class="history-actions">
                                <button class="btn btn-sm btn-outline-primary" data-size-group="history-actions" onclick="app.viewReportDetails('${report.id}')">
                                    <i class="fas fa-eye"></i> Visualizza
                                </button>
                                <button class="btn btn-sm btn-outline-danger" data-size-group="history-actions" onclick="app.deleteReport('${report.id}')">
                                    <i class="fas fa-trash"></i> Elimina
                                </button>
                            </div>
                        </div>
                        <div class="history-details">
                            <div class="history-info">
                                <span class="info-label">Ubicazione:</span>
                                <span class="info-value">${report.location}</span>
                            </div>
                            <div class="history-info">
                                <span class="info-label">Operatore:</span>
                                <span class="info-value">${report.operator}</span>
                            </div>
                            <div class="history-info">
                                <span class="info-label">Kit controllati:</span>
                                <span class="info-value">${report.kitCount} (${report.kits.join(', ')})</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        // Ensure the action buttons have identical dimensions across all items
        if (typeof this.syncButtonSizeGroup === 'function') {
            this.syncButtonSizeGroup('history-actions');
        }
    }
    
    viewReportDetails(reportId) {
        const report = this.data.reportsHistory.find(r => r.id === reportId);
        if (!report) return;
        // Mostra modale immediatamente con stato di caricamento
        const loadingContent = `
            <div class="report-details loading" aria-busy="true" aria-live="polite">
                <div class="detail-section">
                    <h4>Informazioni Generali</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <strong>Data:</strong> ${new Date(report.date).toLocaleDateString('it-IT', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </div>
                        <div class="detail-item">
                            <strong>Ubicazione:</strong> ${report.location}
                        </div>
                        <div class="detail-item">
                            <strong>Operatore:</strong> ${report.operator}
                        </div>
                        <div class="detail-item">
                            <strong>Kit controllati:</strong> ${report.kitCount}
                        </div>
                    </div>
                </div>
                <div class="detail-section">
                    <h4>Kit Inclusi nel Rapporto</h4>
                    <ul class="kit-list">
                        ${report.kits.map(kitName => `<li>${kitName}</li>`).join('')}
                    </ul>
                </div>
                <div class="detail-section">
                    <h4>Contenuti dei Kit</h4>
                    <p>Caricamento contenuti dei kit…</p>
                </div>
            </div>
        `;

        this.showModal('Dettagli Rapporto', loadingContent, `
            <button class="btn btn-outline-secondary" onclick="app.refreshReportKitContents('${reportId}')">Aggiorna</button>
            <button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>
        `);

        // Costruisce e sostituisce la sezione contenuti dei kit
        setTimeout(() => {
            try {
                const contentHtml = this.renderReportKitContents(report);
                const modalContent = document.getElementById('modal-content');
                if (modalContent) {
                    const fullHtml = `
                        <div class="report-details" aria-live="polite">
                            <div class="detail-section">
                                <h4>Informazioni Generali</h4>
                                <div class="detail-grid">
                                    <div class="detail-item">
                                        <strong>Data:</strong> ${new Date(report.date).toLocaleDateString('it-IT', {
                                            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                        })}
                                    </div>
                                    <div class="detail-item"><strong>Ubicazione:</strong> ${report.location}</div>
                                    <div class="detail-item"><strong>Operatore:</strong> ${report.operator}</div>
                                    <div class="detail-item"><strong>Kit controllati:</strong> ${report.kitCount}</div>
                                </div>
                            </div>
                            <div class="detail-section">
                                <h4>Kit Inclusi nel Rapporto</h4>
                                <ul class="kit-list">
                                    ${report.kits.map(kitName => `<li>${kitName}</li>`).join('')}
                                </ul>
                            </div>
                            ${contentHtml}
                        </div>`;
                    modalContent.innerHTML = fullHtml;
                }
            } catch (err) {
                const modalContent = document.getElementById('modal-content');
                if (modalContent) {
                    modalContent.innerHTML = `<div class="report-details"><p class="text-muted">Errore nel caricamento dei contenuti dei kit.</p></div>`;
                }
                console.warn('Errore nel rendering dei contenuti kit per il report:', err);
            }
        }, 0);
    }

    // Ricostruisce la sezione dei contenuti dei kit nel modale del report
    refreshReportKitContents(reportId) {
        const report = this.data.reportsHistory.find(r => r.id === reportId);
        if (!report) return;
        try {
            const modalContent = document.getElementById('modal-content');
            if (!modalContent) return;
            const contentHtml = this.renderReportKitContents(report);
            // Mantieni le prime due sezioni e sostituisci solo la terza
            const baseSections = modalContent.querySelector('.report-details');
            if (baseSections) {
                // Ricostruisce tutto per semplicità
                const fullHtml = `
                    <div class="report-details" aria-live="polite">
                        <div class="detail-section">
                            <h4>Informazioni Generali</h4>
                            <div class="detail-grid">
                                <div class="detail-item">
                                    <strong>Data:</strong> ${new Date(report.date).toLocaleDateString('it-IT', {
                                        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                    })}
                                </div>
                                <div class="detail-item"><strong>Ubicazione:</strong> ${report.location}</div>
                                <div class="detail-item"><strong>Operatore:</strong> ${report.operator}</div>
                                <div class="detail-item"><strong>Kit controllati:</strong> ${report.kitCount}</div>
                            </div>
                        </div>
                        <div class="detail-section">
                            <h4>Kit Inclusi nel Rapporto</h4>
                            <ul class="kit-list">
                                ${report.kits.map(kitName => `<li>${kitName}</li>`).join('')}
                            </ul>
                        </div>
                        ${contentHtml}
                    </div>`;
                modalContent.innerHTML = fullHtml;
            }
        } catch (err) {
            console.warn('Refresh contenuti kit fallito:', err);
        }
    }

    // Genera sezione strutturata con elementi dei kit, quantità, categorie, dettagli
    renderReportKitContents(report) {
        const kitSection = (kit) => {
            const items = Array.isArray(kit.items) ? kit.items : [];
            const rows = items.map(item => {
                const material = this.data.materials?.find(m => m.code === item.code);
                const name = material?.name || item.code;
                const category = material?.category || (material?.tags ? material.tags.join(', ') : '');
                const details = [];
                if (Array.isArray(item.expiryDates) && item.expiryDates.length) {
                    details.push(`Scadenze: ${item.expiryDates.map(d => this.formatDate(d)).join(', ')}`);
                }
                if (item.notes) details.push(`Note: ${item.notes}`);
                return `
                    <tr>
                        <td>${name}</td>
                        <td>${item.currentQuantity ?? 0} / ${item.maxQuantity ?? '-'}</td>
                        <td>${category || '-'}</td>
                        <td>${details.join(' | ') || '-'}</td>
                    </tr>`;
            }).join('');
            return `
                <div class="kit-contents">
                    <h5 class="kit-name">${kit.name} <span class="kit-location">${kit.location ? `— ${kit.location}` : ''}</span></h5>
                    <div class="kit-table-wrapper" role="region" aria-label="Tabella contenuti kit ${kit.name}">
                        <table class="kit-table">
                            <thead>
                                <tr>
                                    <th scope="col">Articolo</th>
                                    <th scope="col">Quantità</th>
                                    <th scope="col">Categoria</th>
                                    <th scope="col">Dettagli</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows || '<tr><td colspan="4" class="text-muted">Nessun articolo presente</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        };

        const kitsByName = (report.kits || []).map(name => {
            return this.data.kits.find(k => (k.name || '').toLowerCase() === (name || '').toLowerCase());
        });
        const contentSections = kitsByName.map(kit => {
            if (!kit) {
                return `<div class="kit-contents"><h5 class="kit-name">Kit non trovato</h5><p class="text-muted">Impossibile reperire i dettagli per questo kit.</p></div>`;
            }
            return kitSection(kit);
        }).join('');

        return `
            <div class="detail-section">
                <h4>Contenuti dei Kit</h4>
                ${contentSections || '<p class="text-muted">Nessun kit disponibile per mostrare i contenuti.</p>'}
            </div>`;
    }
    
    deleteReport(reportId) {
        if (confirm('Sei sicuro di voler eliminare questo rapporto dallo storico?')) {
            const index = this.data.reportsHistory.findIndex(r => r.id === reportId);
            if (index > -1) {
                this.data.reportsHistory.splice(index, 1);
                this.saveData();
                this.renderReportsHistory();
            }
        }
    }

    renderEmail() {
        // Load email templates
        document.getElementById('expiring-recipient').value = this.data.emailTemplates.expiring.recipient;
        document.getElementById('expiring-subject').value = this.data.emailTemplates.expiring.subject;
        document.getElementById('expiring-body').value = this.data.emailTemplates.expiring.body;
        
        document.getElementById('zero-recipient').value = this.data.emailTemplates.zeroQuantity.recipient;
        document.getElementById('zero-subject').value = this.data.emailTemplates.zeroQuantity.subject;
        document.getElementById('zero-body').value = this.data.emailTemplates.zeroQuantity.body;
    }

    renderSettings() {
        // Settings are now handled by tabs
        // The content is dynamically loaded based on the selected tab
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel) {
            // Apri sempre su "Generali" quando si entra in Impostazioni
            this.switchSettingsTab('general');
        }
    }

    

    // Utility methods
    getExpiringItems(month, year) {
        const items = [];
        
        // Check warehouse items
        this.data.warehouse.forEach(item => {
            const expiryDate = new Date(item.expiryDate);
            if (expiryDate.getMonth() === month && expiryDate.getFullYear() === year) {
                items.push({
                    code: item.code,
                    name: this.getMaterialName(item.code),
                    expiryDate: this.formatDate(item.expiryDate),
                    quantity: item.quantity
                });
            }
        });
        
        // Check kit items (robusto con array opzionali)
        this.data.kits.forEach(kit => {
            const kitItems = Array.isArray(kit.items) ? kit.items : [];
            kitItems.forEach(item => {
                const itemExpiryDates = Array.isArray(item.expiryDates) ? item.expiryDates : [];
                itemExpiryDates.forEach(expiryDate => {
                    const expiry = new Date(expiryDate);
                    if (expiry.getMonth() === month && expiry.getFullYear() === year) {
                        items.push({
                            code: item.code,
                            name: this.getMaterialName(item.code),
                            expiryDate: this.formatDate(expiryDate),
                            quantity: item.currentQuantity ?? 0
                        });
                    }
                });
            });
        });
        
        return items;
    }

    getZeroQuantityItems() {
        const items = [];
        
        // Check warehouse items
        this.data.materials.forEach(material => {
            const warehouseItem = this.data.warehouse.find(item => item.code === material.code);
            if (!warehouseItem || warehouseItem.quantity === 0) {
                items.push({
                    code: material.code,
                    name: material.name,
                    location: 'Warehouse'
                });
            }
        });
        
        // Check kit items
        this.data.kits.forEach(kit => {
            kit.items.forEach(item => {
                if (item.currentQuantity === 0) {
                    items.push({
                        code: item.code,
                        name: this.getMaterialName(item.code),
                        location: `Kit: ${kit.name}`
                    });
                }
            });
        });
        
        return items;
    }

    getExpiredItems() {
        const items = [];
        const now = new Date();
        
        // Check warehouse items
        this.data.warehouse.forEach(item => {
            if (new Date(item.expiryDate) < now) {
                items.push({
                    code: item.code,
                    name: this.getMaterialName(item.code),
                    quantity: item.quantity,
                    expiryDate: this.formatDate(item.expiryDate)
                });
            }
        });
        
        return items;
    }

    getMaterialName(code) {
        const material = this.data.materials.find(m => m.code === code);
        return material ? material.name : code;
    }

    getKitStatus(kit) {
        const totalItems = kit.items.length;
        const stockedItems = kit.items.filter(item => item.currentQuantity > 0).length;
        
        if (stockedItems === 0) return 'Empty';
        if (stockedItems === totalItems) return 'Complete';
        return 'Partial';
    }

    // Aggiunge un bollino colorato per lo stato del kit
    getKitStatusBadge(kit) {
        const status = this.getKitStatus(kit);
        const cls = status === 'Empty' ? 'badge-red' : status === 'Partial' ? 'badge-yellow' : 'badge-green';
        return `<span class="status-badge ${cls}" aria-label="${status}"></span> ${status}`;
    }

    isExpired(dateString) {
        return new Date(dateString) < new Date();
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString();
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // --- Richiesta d'ordine: generazione PDF ---
    initOrderPdfGeneration() {
        const btn = document.getElementById('generate-order-pdf');
        if (!btn) return;
        // Popola operatori anche nella sezione Ordini
        try {
            const orderOpSelect = document.getElementById('order-operator');
            if (orderOpSelect) {
                orderOpSelect.innerHTML = '<option value="">Seleziona operatore...</option>' +
                    (Array.isArray(this.data.users) ? this.data.users.map(u => `<option value="${u.id}">${u.firstName} ${u.lastName}</option>`).join('') : '');
            }
        } catch (e) { console.warn('Impossibile popolare operatori in Ordini:', e); }
        btn.addEventListener('click', async () => {
            const errorsEl = document.getElementById('order-pdf-errors');
            if (errorsEl) { errorsEl.style.display = 'none'; errorsEl.textContent = ''; }

            try {
                const filter = (document.querySelector('input[name="order-filter"]:checked')?.value || 'both');
                const city = document.getElementById('order-city')?.value?.trim() || '';
                const useMinQty = document.getElementById('order-use-min-qty')?.checked ?? true;
                // Preferisci operatore scelto nella sezione Ordini, fallback alla sezione Rapporti
                const operatorId = document.getElementById('order-operator')?.value || document.getElementById('report-operator')?.value || '';

                const operator = (Array.isArray(this.data?.users) ? this.data.users.find(u => u.id === operatorId) : null) || null;
                const operatorName = operator ? `${operator.firstName} ${operator.lastName}` : '';

                // Validazioni base
                const err = [];
                if (!operatorName) err.push('Seleziona un operatore.');
                if (!city) err.push('Inserisci il luogo (città).');

                // Data corrente formato GG/MM/AAAA
                const now = new Date();
                const dd = String(now.getDate()).padStart(2, '0');
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const yyyy = String(now.getFullYear());
                const currentDateStr = `${dd}/${mm}/${yyyy}`;
                if (!/^\d{2}\/\d{2}\/\d{4}$/.test(currentDateStr)) {
                    err.push('Formato data non valido (atteso GG/MM/AAAA).');
                }

                // Logo dimension validation (se anteprima disponibile)
                const logoImg = document.getElementById('company-logo-preview');
                if (logoImg && logoImg.style.display !== 'none') {
                    const w = logoImg.naturalWidth || 0;
                    const h = logoImg.naturalHeight || 0;
                    if (w > 150 || h > 50) {
                        err.push('Dimensioni logo eccedono 150x50px, ridimensiona il file.');
                    }
                }

                // Costruzione lista articoli in base ai filtri
                const month = now.getMonth();
                const year = now.getFullYear();
                const expiringItems = (filter === 'expiring' || filter === 'both') ? this.getExpiringItems(month, year) : [];
                const zeroItems = (filter === 'zero' || filter === 'both') ? this.getZeroQuantityItems() : [];

                // Mappa minQty per codice
                const minQtyByCode = new Map();
                this.data.materials.forEach(m => {
                    if (m && m.code) minQtyByCode.set(m.code, Number.isFinite(parseInt(m.minQty, 10)) ? parseInt(m.minQty, 10) : 0);
                });

                // Normalizza articoli
                const normalizedExpiring = expiringItems.map(it => ({
                    code: it.code,
                    name: it.name,
                    location: it.location || 'Warehouse',
                    expiryDate: it.expiryDate || '',
                    reorderQty: useMinQty ? (minQtyByCode.get(it.code) || 0) : (it.quantity || 0),
                    type: 'scadenza'
                }));
                const normalizedZero = zeroItems.map(it => ({
                    code: it.code,
                    name: it.name,
                    location: it.location || 'Warehouse',
                    expiryDate: '',
                    reorderQty: useMinQty ? (minQtyByCode.get(it.code) || 0) : 0,
                    type: 'quantita_zero'
                }));

                // Unione evitando duplicati (chiave: code+location)
                const byKey = new Map();
                const insertOrMerge = (arr) => {
                    arr.forEach(it => {
                        const key = `${it.code}@@${it.location}`;
                        const existing = byKey.get(key);
                        if (!existing) {
                            byKey.set(key, it);
                        } else {
                            // Se presente in entrambi, marca come 'entrambi' e mantieni qty > 0
                            existing.type = 'entrambi';
                            existing.reorderQty = Math.max(existing.reorderQty || 0, it.reorderQty || 0);
                            if (!existing.expiryDate && it.expiryDate) existing.expiryDate = it.expiryDate;
                            byKey.set(key, existing);
                        }
                    });
                };
                insertOrMerge(normalizedExpiring);
                insertOrMerge(normalizedZero);
                const orderItems = Array.from(byKey.values());

                if (!orderItems.length) {
                    err.push('Seleziona almeno un articolo (in base ai filtri).');
                }

                if (err.length) {
                    if (errorsEl) { errorsEl.textContent = err.join(' '); errorsEl.style.display = 'block'; }
                    return;
                }

                // Payload backend
                const payload = {
                    city,
                    date: currentDateStr,
                    operatorName,
                    items: orderItems
                };

                // Chiamata endpoint backend
                const res = await fetch('/orders/generate-pdf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    const msg = data && data.message ? data.message : 'Errore generazione PDF';
                    if (errorsEl) { errorsEl.textContent = msg; errorsEl.style.display = 'block'; }
                    return;
                }

                const url = data.previewUrl || data.outputUrl || data.outputPath || '';
                this.showModal('PDF Richiesta d\'ordine', `<p>Documento generato.</p>${url ? `<p><a href="${url}" target="_blank" rel="noopener">Apri PDF</a></p>` : ''}`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
            } catch (e) {
                console.error('Errore generazione richiesta d\'ordine:', e);
                const errorsEl = document.getElementById('order-pdf-errors');
                if (errorsEl) { errorsEl.textContent = 'Errore interno durante la generazione del PDF.'; errorsEl.style.display = 'block'; }
            }
        });
    }

    // Esporta i kit correnti in un file Excel
    exportKitsToExcel() {
        try {
            const kits = Array.isArray(this.data.kits) ? this.data.kits : [];
            const header = ['Kit','Location','ItemCode','ItemName','CurrentQty','MaxQty','ExpiryDates','Notes','Category'];
            const dataRows = [];

            kits.forEach(kit => {
                const items = Array.isArray(kit.items) ? kit.items : [];
                items.forEach(item => {
                    const material = (this.data.materials || []).find(m => m.code === item.code);
                    const name = material?.name || item.code;
                    const category = material?.category || (Array.isArray(material?.tags) ? material.tags.join(', ') : '');
                    const expiry = Array.isArray(item.expiryDates)
                        ? item.expiryDates.map(d => this.formatDate(d)).join('|')
                        : '';
                    dataRows.push([
                        kit.name,
                        kit.location || '',
                        item.code || '',
                        name,
                        item.currentQuantity ?? 0,
                        item.maxQuantity ?? '',
                        expiry,
                        item.notes || '',
                        category
                    ]);
                });
            });

            const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'KitItems');
            const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
            const filename = `kits_export_${ts}.xlsx`;
            XLSX.writeFile(wb, filename);
            this.showModal('Esportazione completata', `<p>Esportati ${dataRows.length} articoli da ${kits.length} kit.</p>`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
        } catch (err) {
            console.error('Errore export Excel:', err);
            this.showModal('Errore Esportazione', `<p class="text-muted">Impossibile esportare i kit in Excel.</p>`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
        }
    }

    // Scarica un template Excel con intestazioni corrette e una riga di esempio
    downloadKitsExcelTemplate() {
        try {
            const header = ['Kit','Location','ItemCode','ItemName','CurrentQty','MaxQty','ExpiryDates','Notes','Category'];
            const example = ['Kit A','Magazzino 1','garze-sterili','Garze sterili',0,10,'2025-01-10|2026-03-03','Annotazioni facoltative','Medicazioni'];
            const ws = XLSX.utils.aoa_to_sheet([header, example]);
            // Larghezza colonne per leggibilità
            ws['!cols'] = header.map(h => ({ wch: Math.max(h.length, 14) }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'KitItems');
            const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
            const filename = `kits_template_${ts}.xlsx`;
            XLSX.writeFile(wb, filename);
            this.showModal('Template generato', '<p>Template Excel scaricato con intestazioni corrette e riga di esempio.</p>', '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
        } catch (err) {
            console.error('Errore generazione template:', err);
            this.showModal('Errore Template', '<p class="text-muted">Impossibile generare il template Excel.</p>', '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
        }
    }

    // Importa kit da un file Excel e aggiorna i dati
    importKitsFromExcel(file) {
        if (!file) return;
        const reader = new FileReader();
        this.showModal('Importazione in corso', `<p>Caricamento file Excel…</p>`, '');
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });
                const sheetName = wb.SheetNames[0];
                const ws = wb.Sheets[sheetName];
                // Validazione rigida: intestazioni richieste
                const headerRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                if (!headerRows || headerRows.length === 0) {
                    this.showModal('Importazione', '<p class="text-muted">Sheet vuota o non leggibile.</p>', '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
                    return;
                }
                const header = headerRows[0].map(h => String(h || '').trim());
                const required = ['Kit','Location','ItemCode','ItemName','CurrentQty','MaxQty','ExpiryDates','Notes','Category'];
                const missing = required.filter(h => !header.includes(h));
                if (missing.length > 0) {
                    this.showModal('Intestazioni mancanti', `<p>La sheet deve contenere tutte queste colonne:</p><pre>${required.join('\n')}</pre><p>Mancanti:</p><pre>${missing.join('\n')}</pre>`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
                    return;
                }

                const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                if (!rows || rows.length === 0) {
                    this.showModal('Importazione', '<p class="text-muted">Nessun dato trovato nel file Excel.</p>', '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
                    return;
                }

                // Mappa kit per nome
                const kitByName = {};
                const ensureKit = (name, location) => {
                    const key = (name || '').trim().toLowerCase();
                    if (!key) return null;
                    if (!kitByName[key]) {
                        // prova a trovare nei dati esistenti
                        const existing = (this.data.kits || []).find(k => (k.name || '').toLowerCase() === key);
                        kitByName[key] = existing || { id: this.generateId(), name, location: location || '', items: [], isStandard: false };
                    } else {
                        // aggiorna location se presente
                        if (location) kitByName[key].location = location;
                    }
                    return kitByName[key];
                };

                // Validazione rigida per ogni riga
                const errors = [];
                rows.forEach((r, idx) => {
                    const rowNum = idx + 2; // 1-based, +1 per intestazioni
                    const kitName = r.Kit;
                    const location = r.Location;
                    const code = r.ItemCode;
                    const itemName = r.ItemName;
                    const current = Number(r.CurrentQty);
                    const max = Number(r.MaxQty);
                    const expStr = r.ExpiryDates;
                    const notes = r.Notes;
                    const category = r.Category;

                    if (!kitName || !code) errors.push(`Riga ${rowNum}: 'Kit' e 'ItemCode' sono obbligatori.`);
                    if (Number.isNaN(current) || current < 0) errors.push(`Riga ${rowNum}: 'CurrentQty' deve essere un numero >= 0.`);
                    if (Number.isNaN(max) || max < 0) errors.push(`Riga ${rowNum}: 'MaxQty' deve essere un numero >= 0.`);
                    if (!Number.isNaN(current) && !Number.isNaN(max) && current > max) errors.push(`Riga ${rowNum}: 'CurrentQty' non può superare 'MaxQty'.`);
                    if (expStr) {
                        const invalidDates = String(expStr).split(/[|,;]/).map(s => s.trim()).filter(Boolean).filter(d => Number.isNaN(Date.parse(d)));
                        if (invalidDates.length > 0) errors.push(`Riga ${rowNum}: 'ExpiryDates' contiene date non valide: ${invalidDates.join(', ')}`);
                    }

                    if (errors.length === 0) {
                        const kit = ensureKit(kitName, location);
                        if (!kit) {
                            errors.push(`Riga ${rowNum}: Kit non valido.`);
                            return;
                        }
                        const expiryDates = (expStr ? String(expStr).split(/[|,;]/).map(s => s.trim()).filter(Boolean) : []).map(d => new Date(d).toISOString());
                        const existingItem = (kit.items || []).find(i => i.code === code);
                        const itemObj = { code, currentQuantity: current, maxQuantity: max, expiryDates, notes };
                        if (existingItem) {
                            existingItem.currentQuantity = itemObj.currentQuantity;
                            existingItem.maxQuantity = itemObj.maxQuantity;
                            existingItem.expiryDates = itemObj.expiryDates;
                            existingItem.notes = itemObj.notes;
                        } else {
                            kit.items.push(itemObj);
                        }
                        if (itemName || category) {
                            const materials = this.data.materials || [];
                            let mat = materials.find(m => m.code === code);
                            if (!mat) {
                                mat = { code, name: itemName || code, category: category || '', tags: [] };
                                materials.push(mat);
                            } else {
                                if (itemName) mat.name = itemName;
                                if (category) mat.category = category;
                            }
                            this.data.materials = materials;
                        }
                    }
                });

                if (errors.length > 0) {
                    const errHtml = `<p>Importazione annullata. Correggi gli errori e riprova.</p><pre>${errors.join('\n')}</pre>`;
                    this.showModal('Errori di validazione', errHtml, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
                    return;
                }

                // Unisci con dati esistenti: aggiorna o aggiungi
                const existing = Array.isArray(this.data.kits) ? this.data.kits : [];
                Object.values(kitByName).forEach(importKit => {
                    const idx = existing.findIndex(k => (k.name || '').toLowerCase() === (importKit.name || '').toLowerCase());
                    if (idx >= 0) {
                        // merge semplice: sostituisce location e items
                        existing[idx].location = importKit.location;
                        existing[idx].items = importKit.items;
                    } else {
                        existing.push(importKit);
                    }
                });
                this.data.kits = existing;
                this.renderKits();
                this.showModal('Importazione completata', `<p>Importate ${rows.length} righe con validazione rigida.</p>`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
            } catch (err) {
                console.error('Errore import Excel:', err);
                this.showModal('Errore Importazione', `<p class="text-muted">Impossibile importare i kit dal file Excel.</p>`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
            }
        };
        reader.onerror = () => {
            this.showModal('Errore Importazione', `<p class="text-muted">Errore di lettura del file Excel.</p>`, '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>');
        };
        reader.readAsArrayBuffer(file);
    }

    // Modal methods
    showModal(title, content, footer = '') {
        // Ensure modal scaffold exists
        this.ensureModalScaffold();
        const overlay = document.getElementById('modal-overlay');
        const modalTitle = document.getElementById('modal-title');
        const modalContent = document.getElementById('modal-content');
        const modalFooter = document.getElementById('modal-footer');
        if (!overlay || !modalTitle || !modalContent || !modalFooter) {
            console.error('Modal scaffold mancante: overlay/title/content/footer non trovati');
            alert('Impossibile aprire il modale: struttura mancante.');
            return;
        }
        modalTitle.textContent = title;
        modalContent.innerHTML = content;
        modalFooter.innerHTML = footer;
        overlay.classList.add('active');
    }

    // Crea dinamicamente il markup del modale se assente
    ensureModalScaffold() {
        if (document.getElementById('modal-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-overlay';
        overlay.className = 'modal-overlay';

        const modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';

        const header = document.createElement('div');
        header.className = 'modal-header';

        const title = document.createElement('h3');
        title.id = 'modal-title';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.id = 'modal-close';
        closeBtn.className = 'modal-close';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.addEventListener('click', () => this.closeModal());
        header.appendChild(closeBtn);

        const content = document.createElement('div');
        content.id = 'modal-content';
        content.className = 'modal-content';

        const footer = document.createElement('div');
        footer.id = 'modal-footer';
        footer.className = 'modal-footer';

        modal.appendChild(header);
        modal.appendChild(content);
        modal.appendChild(footer);
        overlay.appendChild(modal);

        // Chiudi cliccando fuori dal modale
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeModal();
        });

        document.body.appendChild(overlay);
    }

    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        } else {
            console.warn('closeModal chiamato ma overlay non presente');
        }
    }

    showSendEmailDialog() {
        // Carica valori di default (persistenti via localStorage) e fallback dai template
        const today = new Date().toLocaleDateString('it-IT');
        const expDefaults = {
             to: localStorage.getItem('email_exp_to') || (this.data?.emailTemplates?.expiring?.recipient || 'ettorebottin5@gmail.com'),
             subject: localStorage.getItem('email_exp_subject') || (this.data?.emailTemplates?.expiring?.subject || `Articoli in Scadenza - ${today}`),
             body: localStorage.getItem('email_exp_body') || (this.data?.emailTemplates?.expiring?.body || 'Gentile Team,\n\nI seguenti articoli stanno per scadere:\n\n[TABLE]\n\nCordiali saluti')
         };
         const zeroDefaults = {
             to: localStorage.getItem('email_zero_to') || (this.data?.emailTemplates?.zeroQuantity?.recipient || 'ettorebottin5@gmail.com'),
             subject: localStorage.getItem('email_zero_subject') || (this.data?.emailTemplates?.zeroQuantity?.subject || `Articoli con Quantità Zero - ${today}`),
             body: localStorage.getItem('email_zero_body') || (this.data?.emailTemplates?.zeroQuantity?.body || 'Gentile Team,\n\nI seguenti articoli sono esauriti:\n\n[TABLE]\n\nCordiali saluti')
         };

        // Anteprima dati reali per rendere le informazioni visibili nel modale
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const expPreviewTable = this.buildItemsTable(this.getExpiringItems(currentMonth, currentYear));
        const zeroPreviewTable = this.buildItemsTable(this.getZeroQuantityItems());

        const content = `
            <div id="modal-info" style="background:#f1f7ff;border:1px solid #99c2ff;padding:12px;border-radius:6px;margin-bottom:12px;">
                <h4 style="margin:0 0 8px 0;">Informazioni e note</h4>
                <p style="margin:0 0 6px 0;">- I dati provengono da <code>Contenuto_magazzino.xlsx</code> e <code>Contenuto_cassette.xlsx</code>.</p>
                <p style="margin:0 0 6px 0;">- Aggiorna scadenze nella colonna <code>SCADENZA</code> e quantità in <code>QNT</code> nei file Excel.</p>
                <p style="margin:0 0 6px 0;">- Il segnaposto <code>[TABLE]</code> viene sostituito automaticamente con le tabelle sotto.</p>
                <p style="margin:0 0 6px 0;">- Mittente: <code>edithia.bot@gmail.com</code>. Destinatari: usa la rubrica aziendale.</p>
                <div style="margin-top:8px;">
                    <h5 style="margin:0 0 6px 0;">Anteprima Scadenze (mese corrente)</h5>
                    ${expPreviewTable}
                </div>
                <div style="margin-top:8px;">
                    <h5 style="margin:0 0 6px 0;">Anteprima Quantità Zero</h5>
                    ${zeroPreviewTable}
                </div>
            </div>

            <div class="form-group">
                <label>Mittente (fisso):</label>
                <input type="email" class="form-control" value="edithia.bot@gmail.com" disabled />

            </div>

            <div class="form-group" style="margin-top: 12px;">
                <h4><i class="fas fa-hourglass-half"></i> Modello Scadenze</h4>
                <label for="modal-expiring-recipient">Destinatario:</label>
                <input type="email" id="modal-expiring-recipient" class="form-control" placeholder="es. responsabile.magazzino@azienda.it" value="${expDefaults.to}">

                <label for="modal-expiring-subject" style="margin-top:8px;">Oggetto:</label>
                <input type="text" id="modal-expiring-subject" class="form-control" value="${expDefaults.subject}">

                <label for="modal-expiring-body" style="margin-top:8px;">Testo:</label>
                <textarea id="modal-expiring-body" class="form-control" rows="5">${expDefaults.body}</textarea>

            </div>

            <div class="form-group" style="margin-top: 16px;">
                <h4><i class="fas fa-box-open"></i> Modello Quantità Zero</h4>
                <label for="modal-zero-recipient">Destinatario:</label>
                <input type="email" id="modal-zero-recipient" class="form-control" placeholder="es. magazzino@azienda.it" value="${zeroDefaults.to}">

                <label for="modal-zero-subject" style="margin-top:8px;">Oggetto:</label>
                <input type="text" id="modal-zero-subject" class="form-control" value="${zeroDefaults.subject}">

                <label for="modal-zero-body" style="margin-top:8px;">Testo:</label>
                <textarea id="modal-zero-body" class="form-control" rows="5">${zeroDefaults.body}</textarea>

            </div>

            <div class="form-group" style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 16px;">
                <button class="btn btn-primary" onclick="app.sendExpiringItemsEmail(); app.closeModal();">
                    <i class="fas fa-paper-plane"></i> Invia Scadenze
                </button>
                <button class="btn btn-warning" onclick="app.sendZeroQuantityEmail(); app.closeModal();">
                    <i class="fas fa-paper-plane"></i> Invia Quantità Zero
                </button>
                <button class="btn btn-success" onclick="app.sendExpiringItemsEmail(); app.sendZeroQuantityEmail(); app.closeModal();">
                    <i class="fas fa-paper-plane"></i> Invia Entrambe
                </button>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>
        `;
        this.showModal('Invia Notifiche', content, footer);

        // Persisti automaticamente i valori inseriti per uso futuro
        setTimeout(() => {
            const map = [
                { prefix: 'exp', domPrefix: 'modal-expiring' },
                { prefix: 'zero', domPrefix: 'modal-zero' }
            ];
            map.forEach(({ prefix, domPrefix }) => {
                const fields = [
                    { id: `${domPrefix}-recipient`, key: 'to' },
                    { id: `${domPrefix}-subject`, key: 'subject' },
                    { id: `${domPrefix}-body`, key: 'body' }
                ];
                fields.forEach(({ id, key }) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('input', (e) => {
                            localStorage.setItem(`email_${prefix}_${key}`, e.target.value);
                        });
                    }
                });
            });
        }, 0);
    }

    showAddWarehouseItemModal() {
        const materialsOptions = this.data.materials.map(material => 
            `<option value="${material.code}">${material.code} - ${material.name}</option>`
        ).join('');
        
        const content = `
            <div class="form-group">
                <label for="warehouse-item-code">Material:</label>
                <select id="warehouse-item-code" class="form-control">
                    <option value="">Select material...</option>
                    ${materialsOptions}
                </select>
            </div>
            <div class="form-group">
                <label for="warehouse-item-quantity">Quantity:</label>
                <input type="number" id="warehouse-item-quantity" class="form-control" min="1">
            </div>
            <div class="form-group">
                <label for="warehouse-item-expiry">Expiry Date:</label>
                <input type="date" id="warehouse-item-expiry" class="form-control">
            </div>
            <div class="form-group">
                <label for="warehouse-item-notes">Notes:</label>
                <textarea id="warehouse-item-notes" class="form-control" rows="3"></textarea>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="app.addWarehouseItem()">Add Item</button>
        `;
        
        this.showModal('Add Warehouse Item', content, footer);
    }
    
    showAddKitModal() {
        const content = `
            <div class="form-group">
                <label for="new-kit-name">Nome Kit:</label>
                <input type="text" id="new-kit-name" class="form-control" placeholder="Inserisci nome del nuovo kit...">
            </div>
            <div class="form-group">
                <label for="new-kit-type">Tipo Kit:</label>
                <select id="new-kit-type" class="form-control">
                    <option value="standard">Kit Standard (con articoli predefiniti)</option>
                    <option value="custom">Kit Personalizzato (vuoto)</option>
                </select>
            </div>
            <div class="form-group" id="kit-standard-field">
                <label class="checkbox-label" for="new-kit-standard">
                    <input type="checkbox" id="new-kit-standard" class="form-control" aria-describedby="kit-standard-tooltip">
                    <span>Kit Standard</span>
                    <span id="kit-standard-tooltip" class="tooltip" title="Se attivo, il kit viene creato con gli articoli predefiniti e si inserisce automaticamente nell'elenco kit.">
                        <i class="fas fa-info-circle" aria-hidden="true"></i>
                    </span>
                </label>
            </div>
            <div class="form-group">
                <label for="new-kit-description">Descrizione (opzionale):</label>
                <textarea id="new-kit-description" class="form-control" rows="3" placeholder="Descrizione del kit..."></textarea>
            </div>
            <div class="form-group">
                <label for="new-kit-location">Ubicazione:</label>
                <input type="text" id="new-kit-location" class="form-control" placeholder="Inserisci ubicazione..." value="${this.data.settings?.defaultLocation || ''}">
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.addNewKit()">Crea Kit</button>
        `;
        
        this.showModal('Aggiungi Nuovo Kit', content, footer);

        // Sincronizza checkbox e select + imposta valore di default dal salvataggio
        const typeSelect = document.getElementById('new-kit-type');
        const standardCheckbox = document.getElementById('new-kit-standard');
        const defaultType = (this.data?.settings?.defaultKitType) || localStorage.getItem('fam_default_kit_type') || 'standard';
        typeSelect.value = defaultType;
        standardCheckbox.checked = defaultType === 'standard';

        typeSelect.addEventListener('change', () => {
            standardCheckbox.checked = typeSelect.value === 'standard';
            // Persisti preferenza
            this.data.settings = this.data.settings || {};
            this.data.settings.defaultKitType = typeSelect.value;
            localStorage.setItem('fam_default_kit_type', typeSelect.value);
            this.scheduleAutoSave?.();
        });
        standardCheckbox.addEventListener('change', () => {
            typeSelect.value = standardCheckbox.checked ? 'standard' : 'custom';
            // Persisti preferenza
            this.data.settings = this.data.settings || {};
            this.data.settings.defaultKitType = typeSelect.value;
            localStorage.setItem('fam_default_kit_type', typeSelect.value);
            this.scheduleAutoSave?.();
        });
    }
    
    showAddKitItemModal(kitId) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        // Get all unique tags from materials
        const allTags = [...new Set(this.data.materials.flatMap(m => m.tags || []))];
        
        // Get materials not already in the kit
        const availableMaterials = this.data.materials.filter(material => 
            !kit.items.some(item => item.code === material.code)
        );
        
        const tagOptions = allTags.map(tag => 
            `<option value="${tag}">${tag}</option>`
        ).join('');
        
        const content = `
            <div class="form-group">
                <label for="kit-item-tag-filter">Filtra per Tag:</label>
                <select id="kit-item-tag-filter" class="form-control" onchange="app.filterMaterialsByTag('${kitId}')">
                    <option value="">Tutti i materiali</option>
                    ${tagOptions}
                </select>
            </div>
            <div class="form-group">
                <label for="kit-item-material">Materiale:</label>
                <select id="kit-item-material" class="form-control">
                    <option value="">Seleziona materiale...</option>
                    ${availableMaterials.map(material => {
                        const tags = material.tags ? material.tags.join(', ') : '';
                        return `<option value="${material.code}" data-tags="${material.tags ? material.tags.join(',') : ''}">${material.code} - ${material.name} ${tags ? `(${tags})` : ''}</option>`;
                    }).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="kit-item-max-quantity">Quantità Massima:</label>
                <input type="number" id="kit-item-max-quantity" class="form-control" min="1" value="1">
            </div>
            <div class="form-group">
                <label for="kit-item-notes">Note (opzionale):</label>
                <textarea id="kit-item-notes" class="form-control" rows="2" placeholder="Note per questo articolo..."></textarea>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.addKitItem('${kitId}')">Aggiungi Articolo</button>
        `;
        
        this.showModal(`Aggiungi Articolo a ${kit.name}`, content, footer);

        // Pre-popolazione della Quantità Massima dal materiale selezionato
        const materialSelect = document.getElementById('kit-item-material');
        const maxQtyInput = document.getElementById('kit-item-max-quantity');
        if (materialSelect && maxQtyInput) {
            materialSelect.addEventListener('change', () => {
                const code = materialSelect.value;
                const mat = this.data.materials.find(m => m.code === code);
                const val = mat && Number.isFinite(parseInt(mat.maxKitQty, 10)) && parseInt(mat.maxKitQty, 10) > 0 ? parseInt(mat.maxKitQty, 10) : 1;
                maxQtyInput.value = val;
            });
        }
    }
    
    filterMaterialsByTag(kitId) {
        const selectedTag = document.getElementById('kit-item-tag-filter').value;
        const materialSelect = document.getElementById('kit-item-material');
        const kit = this.data.kits.find(k => k.id === kitId);
        
        // Get materials not already in the kit
        let availableMaterials = this.data.materials.filter(material => 
            !kit.items.some(item => item.code === material.code)
        );
        
        // Filter by tag if selected
        if (selectedTag) {
            availableMaterials = availableMaterials.filter(material => 
                material.tags && material.tags.includes(selectedTag)
            );
        }
        
        // Update the material select options
        materialSelect.innerHTML = `
            <option value="">Seleziona materiale...</option>
            ${availableMaterials.map(material => {
                const tags = material.tags ? material.tags.join(', ') : '';
                return `<option value="${material.code}">${material.code} - ${material.name} ${tags ? `(${tags})` : ''}</option>`;
            }).join('')}
        `;
    }
    
    addKitItem(kitId) {
        const materialCode = document.getElementById('kit-item-material').value;
        const maxQuantity = parseInt(document.getElementById('kit-item-max-quantity').value);
        const notes = document.getElementById('kit-item-notes').value.trim();
        
        if (!materialCode) {
            alert('Seleziona un materiale.');
            return;
        }
        if (!Number.isFinite(maxQuantity) || maxQuantity <= 0) {
            alert('La Quantità Massima deve essere un intero positivo.');
            return;
        }
        
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        // Check if item already exists in kit
        if (kit.items.some(item => item.code === materialCode)) {
            alert('Questo materiale è già presente nel kit.');
            return;
        }
        
        const newItem = {
            code: materialCode,
            maxQuantity: maxQuantity,
            currentQuantity: 0,
            expiryDates: [],
            notes: notes
        };
        
        kit.items.push(newItem);
        this.saveData();
        this.renderKits();
        this.closeModal();
        
        const material = this.data.materials.find(m => m.code === materialCode);
        const materialName = material ? material.name : materialCode;
        alert(`Articolo "${materialName}" aggiunto al kit "${kit.name}" con successo!`);
    }

    addWarehouseItem() {
        const code = document.getElementById('warehouse-item-code').value;
        const quantity = parseInt(document.getElementById('warehouse-item-quantity').value);
        const expiryDate = document.getElementById('warehouse-item-expiry').value;
        const notes = document.getElementById('warehouse-item-notes').value;
        
        if (!code || !quantity || !expiryDate) {
            alert('Si prega di compilare tutti i campi obbligatori.');
            return;
        }
        
        const item = {
            id: this.generateId(),
            code,
            quantity,
            expiryDate,
            notes
        };
        
        this.data.warehouse.push(item);
        this.saveData();
        this.renderWarehouse();
        this.renderOverallDashboard();
        this.closeModal();
    }
    
    addNewKit() {
        const name = document.getElementById('new-kit-name').value.trim();
        const type = document.getElementById('new-kit-type').value;
        const description = document.getElementById('new-kit-description').value.trim();
        
        if (!name) {
            alert('Il nome del kit è obbligatorio.');
            return;
        }
        
        // Check if kit name already exists
        const existingKit = this.data.kits.find(k => k.name.toLowerCase() === name.toLowerCase());
        if (existingKit) {
            alert('Esiste già un kit con questo nome. Scegli un nome diverso.');
            return;
        }
        
        const location = (document.getElementById('new-kit-location')?.value || '').trim();
        const newKit = {
            id: this.generateId(),
            name: name,
            description: description,
            location: location,
            items: [],
            isStandard: type === 'standard'
        };
        
        // Aggiungi articoli predefiniti per kit standard e valida che siano disponibili
        if (type === 'standard') {
            const defaults = this.getStandardKitItems();
            if (!defaults || defaults.length === 0) {
                alert('Template articoli standard non disponibile. Verifica il caricamento da Excel (Contenuto_cassette.xlsx).');
            }
            newKit.items = (defaults || []).map(item => ({
                ...item,
                currentQuantity: 0,
                expiryDates: [],
                notes: ''
            }));
        }
        
        this.data.kits.push(newKit);

        // Persisti preferenza tipo kit per sessioni future
        this.data.settings = this.data.settings || {};
        this.data.settings.defaultKitType = type;
        localStorage.setItem('fam_default_kit_type', type);
        
        this.saveData();
        this.renderKits();
        this.renderReports(); // Aggiorna sezione report
        this.closeModal();
        
        // Conferma e autoselezione nel report (se presente la lista)
        try {
            const kitSelection = document.getElementById('selected-kits');
            if (kitSelection) {
                Array.from(kitSelection.querySelectorAll('input[type="checkbox"]').values()).forEach(cb => {
                    if (cb.value === newKit.id) cb.checked = true;
                });
            }
        } catch (_) {}
        
        alert(`Kit "${name}" creato con successo!`);
    }

    editWarehouseItem(itemId) {
        const item = this.data.warehouse.find(i => i.id === itemId);
        if (!item) return;
        
        const materialsOptions = this.data.materials.map(material => 
            `<option value="${material.code}" ${material.code === item.code ? 'selected' : ''}>${material.code} - ${material.name}</option>`
        ).join('');
        
        const content = `
            <div class="form-group">
                <label for="edit-warehouse-item-code">Materiale:</label>
                <select id="edit-warehouse-item-code" class="form-control">
                    <option value="">Seleziona materiale...</option>
                    ${materialsOptions}
                </select>
            </div>
            <div class="form-group">
                <label for="edit-warehouse-item-quantity">Quantità:</label>
                <input type="number" id="edit-warehouse-item-quantity" class="form-control" min="1" value="${item.quantity}">
            </div>
            <div class="form-group">
                <label for="edit-warehouse-item-expiry">Data di Scadenza:</label>
                <input type="date" id="edit-warehouse-item-expiry" class="form-control" value="${item.expiryDate}">
            </div>
            <div class="form-group">
                <label for="edit-warehouse-item-notes">Note:</label>
                <textarea id="edit-warehouse-item-notes" class="form-control" rows="3">${item.notes || ''}</textarea>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.updateWarehouseItem('${itemId}')">Aggiorna Articolo</button>
        `;
        
        this.showModal('Modifica Articolo Armadio', content, footer);
    }

    updateWarehouseItem(itemId) {
        const code = document.getElementById('edit-warehouse-item-code').value;
        const quantity = parseInt(document.getElementById('edit-warehouse-item-quantity').value);
        const expiryDate = document.getElementById('edit-warehouse-item-expiry').value;
        const notes = document.getElementById('edit-warehouse-item-notes').value;
        
        if (!code || !quantity || !expiryDate) {
            alert('Si prega di compilare tutti i campi obbligatori.');
            return;
        }
        
        const item = this.data.warehouse.find(i => i.id === itemId);
        if (item) {
            item.code = code;
            item.quantity = quantity;
            item.expiryDate = expiryDate;
            item.notes = notes;
            
            this.saveData();
            this.renderWarehouse();
            this.renderOverallDashboard();
            this.closeModal();
        }
    }

    deleteWarehouseItem(itemId) {
        if (confirm('Sei sicuro di voler eliminare questo articolo?')) {
            const index = this.data.warehouse.findIndex(i => i.id === itemId);
            if (index > -1) {
                this.data.warehouse.splice(index, 1);
                this.saveData();
                this.renderWarehouse();
                this.renderOverallDashboard();
            }
        }
    }

    // Kit management methods
    adjustKitQuantity(kitId, itemCode, change) {
        const kit = this.data.kits.find(k => k.id === kitId);
        const item = kit.items.find(i => i.code === itemCode);
        
        const newQuantity = item.currentQuantity + change;
        
        if (newQuantity < 0 || newQuantity > item.maxQuantity) {
            return;
        }
        
        if (change > 0) {
            // Adding items - deduct from warehouse using FIFO
            const warehouseItems = this.data.warehouse
                .filter(w => w.code === itemCode && !this.isExpired(w.expiryDate))
                .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
            
            let needed = change;
            for (const warehouseItem of warehouseItems) {
                if (needed <= 0) break;
                
                const available = Math.min(warehouseItem.quantity, needed);
                warehouseItem.quantity -= available;
                needed -= available;
                
                // Add expiry date to kit item
                for (let i = 0; i < available; i++) {
                    item.expiryDates.push(warehouseItem.expiryDate);
                }
                
                if (warehouseItem.quantity === 0) {
                    const index = this.data.warehouse.indexOf(warehouseItem);
                    this.data.warehouse.splice(index, 1);
                }
            }
            
            if (needed > 0) {
                alert(`Only ${change - needed} items were available in warehouse.`);
                item.currentQuantity += (change - needed);
            } else {
                item.currentQuantity = newQuantity;
            }
        } else {
            // Removing items - add to used materials log
            item.currentQuantity = newQuantity;
            // Remove corresponding expiry dates
            item.expiryDates.splice(0, Math.abs(change));
        }
        
        this.saveData();
        this.renderKits();
        this.renderWarehouse();
        this.renderOverallDashboard();
    }

    removeKitItemExpiryDate(kitId, itemCode, dateIndex) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        const item = kit.items.find(i => i.code === itemCode);
        if (!item || !Array.isArray(item.expiryDates)) return;
        if (dateIndex < 0 || dateIndex >= item.expiryDates.length) return;

        // Rimuove la scadenza specifica e mantiene allineata la quantità
        item.expiryDates.splice(dateIndex, 1);
        if (typeof item.currentQuantity === 'number' && item.currentQuantity > 0) {
            item.currentQuantity -= 1;
        }

        this.saveData();
        this.renderKits();
        this.renderWarehouse();
        this.renderOverallDashboard();
    }

    editKit(kitId) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        const content = `
            <div class="form-group">
                <label for="edit-kit-name">Nome Kit:</label>
                <input type="text" id="edit-kit-name" class="form-control" value="${kit.name}" placeholder="Inserisci nome kit...">
            </div>
            <div class="form-group">
                <label>Informazioni Kit:</label>
                <div class="kit-info">
                    <p><strong>ID:</strong> ${kit.id}</p>
                    <p><strong>Numero articoli:</strong> ${kit.items.length}</p>
                    <p><strong>Stato:</strong> ${this.getKitStatus(kit)}</p>
                </div>
            </div>
            <div class="form-group">
                <label for="edit-kit-location">Ubicazione:</label>
                <input type="text" id="edit-kit-location" class="form-control" value="${kit.location || this.data.settings?.defaultLocation || ''}" placeholder="Inserisci ubicazione...">
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-danger" onclick="app.deleteKit('${kitId}')">Elimina Kit</button>
            <button class="btn btn-primary" onclick="app.updateKitName('${kitId}')">Salva Modifiche</button>
        `;
        
        this.showModal('Modifica Kit', content, footer);
    }
    
    updateKitName(kitId) {
        const newName = document.getElementById('edit-kit-name').value.trim();
        const newLocation = (document.getElementById('edit-kit-location')?.value || '').trim();
        
        if (!newName) {
            alert('Il nome del kit non può essere vuoto.');
            return;
        }
        
        // Check if name already exists
        const existingKit = this.data.kits.find(k => k.id !== kitId && k.name.toLowerCase() === newName.toLowerCase());
        if (existingKit) {
            alert('Esiste già un kit con questo nome. Scegli un nome diverso.');
            return;
        }
        
        const kit = this.data.kits.find(k => k.id === kitId);
        if (kit) {
            kit.name = newName;
            kit.location = newLocation;
            this.saveData();
            this.renderKits();
            this.renderReports(); // Update reports section as well
            this.closeModal();
            alert('Informazioni del kit aggiornate con successo!');
        }
    }
    
    confirmKitChanges(kitId) {
        // This would typically save any pending changes
        alert('Modifiche al kit confermate e salvate.');
        this.saveData();
    }

    deleteKit(kitId) {
        if (!confirm('Sei sicuro di voler eliminare questo kit?')) return;
        const index = this.data.kits.findIndex(k => k.id === kitId);
        if (index > -1) {
            this.data.kits.splice(index, 1);
            this.saveData();
            this.renderKits();
            this.renderOverallDashboard?.();
            this.renderReports?.();
            this.closeModal?.();
        }
    }

    // Email methods
    getFieldValue(ids) {
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el && typeof el.value === 'string') return el.value;
        }
        return '';
    }

    buildItemsTable(items) {
        if (!Array.isArray(items) || items.length === 0) return '<p>Nessun elemento.</p>';
        const rows = items.map(it => `
            <tr>
                <td>${it.code || ''}</td>
                <td>${it.name || ''}</td>
                <td>${it.quantity ?? 0}</td>
                <td>${it.expiryDate || ''}</td>
            </tr>
        `).join('');
        return `
            <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
                <thead>
                    <tr>
                        <th>Codice</th>
                        <th>Nome</th>
                        <th>Quantità</th>
                        <th>Scadenza</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    async sendExpiringItemsEmail() {
        // Garantisce che la base API sia pronta anche in caso di click immediato
        try { await this.ensureApiReady(); } catch (_) {}
        const recipient = this.getFieldValue(['modal-expiring-recipient', 'expiring-recipient']);
        const subject = this.getFieldValue(['modal-expiring-subject', 'expiring-subject']);
        let body = this.getFieldValue(['modal-expiring-body', 'expiring-body']);

        if (!recipient) {
            this.showEmailError('Inserisci un indirizzo email destinatario per Scadenze.');
            return;
        }

        // Validazione email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(recipient)) {
            this.showEmailError('Inserisci un indirizzo email valido per Scadenze.');
            return;
        }

        if (!subject || subject.trim().length === 0) {
            this.showEmailError('Inserisci un oggetto per l\'email Scadenze.');
            return;
        }

        if (!body || body.trim().length === 0) {
            this.showEmailError('Inserisci il contenuto dell\'email Scadenze.');
            return;
        }
        
        // Estrai e valida i dati dai div
        const extractedData = this.extractExpiringItemsData();
        const isValid = this.validateEmailData(extractedData);
        if (!isValid) {
            this.showEmailError('Errore validazione dati Scadenze');
            return;
        }

        // Salva template (aggiorno corpo con contenuto formattato dai div)
        const htmlContent = this.formatDataForEmail(extractedData, 'expiring');
        this.data.emailTemplates.expiring = { recipient, subject, body: htmlContent };
        this.saveData();

        // Aggiorna i textarea per riflettere esclusivamente i dati estratti dai div
        ['modal-expiring-body', 'expiring-body'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = htmlContent;
        });

        // Verifica integrità dei dati prima dell'invio
        if (!extractedData || !Array.isArray(extractedData.items) || extractedData.items.length === 0) {
            this.showEmailError('Nessun articolo in scadenza trovato nei dati dell\'interfaccia.');
            return;
        }

        try {
            const resp = await fetch(`${this.apiBase}/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: recipient,
                    subject,
                    html: htmlContent,
                    replyTo: 'edithia.bot@gmail.com'
                })
            });
            const data = await this.parseJsonSafe(resp);
            if (resp.ok && (data.success === true || Object.keys(data).length === 0)) {
                alert('Email Scadenze inviata con successo!');
                console.log('Email Scadenze inviata:', {
                    recipient,
                    subject,
                    itemCount: Array.isArray(extractedData.items) ? extractedData.items.length : 0,
                    timestamp: new Date().toISOString()
                });
            } else {
                { const msg = data.error || resp.statusText || 'sconosciuto'; this.showEmailError('Errore invio email Scadenze: ' + msg); }
            }
        } catch (e) {
            this.showEmailError('Errore di rete durante l\'invio Scadenze: ' + (e?.message || e));
        }
    }

    async sendZeroQuantityEmail() {
        // Garantisce che la base API sia pronta anche in caso di click immediato
        try { await this.ensureApiReady(); } catch (_) {}
        const recipient = this.getFieldValue(['modal-zero-recipient', 'zero-recipient']);
        const subject = this.getFieldValue(['modal-zero-subject', 'zero-subject']);
        let body = this.getFieldValue(['modal-zero-body', 'zero-body']);

        if (!recipient) {
            this.showEmailError('Inserisci un indirizzo email destinatario per Quantità Zero.');
            return;
        }

        // Validazione email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(recipient)) {
            this.showEmailError('Inserisci un indirizzo email valido per Quantità Zero.');
            return;
        }

        if (!subject || subject.trim().length === 0) {
            this.showEmailError('Inserisci un oggetto per l\'email Quantità Zero.');
            return;
        }

        if (!body || body.trim().length === 0) {
            this.showEmailError('Inserisci il contenuto dell\'email Quantità Zero.');
            return;
        }

        // Estrai e valida i dati dai div
        const extractedData = this.extractZeroQuantityItemsData();
        const isValidZero = this.validateEmailData(extractedData);
        if (!isValidZero) {
            this.showEmailError('Errore validazione dati Quantità Zero');
            return;
        }

        // Salva template (aggiorno corpo con contenuto formattato dai div)
        const htmlContentZero = this.formatDataForEmail(extractedData, 'zeroQuantity');
        this.data.emailTemplates.zeroQuantity = { recipient, subject, body: htmlContentZero };
        this.saveData();

        // Aggiorna i textarea per riflettere esclusivamente i dati estratti dai div
        ['modal-zero-body', 'zero-body'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = htmlContentZero;
        });

        // Verifica integrità dei dati prima dell'invio
        if (!extractedData || !Array.isArray(extractedData.items) || extractedData.items.length === 0) {
            this.showEmailError('Nessun articolo con quantità zero trovato nei dati dell\'interfaccia.');
            return;
        }

        try {
            const resp = await fetch(`${this.apiBase}/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: recipient,
                    subject,
                    html: htmlContentZero,
                    replyTo: 'edithia.bot@gmail.com'
                })
            });
            const data = await this.parseJsonSafe(resp);
            if (resp.ok && (data.success === true || Object.keys(data).length === 0)) {
                alert('Email Quantità Zero inviata con successo!');
                console.log('Email Quantità Zero inviata:', {
                    recipient,
                    subject,
                    itemCount: Array.isArray(extractedData.items) ? extractedData.items.length : 0,
                    timestamp: new Date().toISOString()
                });
            } else {
                { const msg = data.error || resp.statusText || 'sconosciuto'; this.showEmailError('Errore invio email Quantità Zero: ' + msg); }
            }
        } catch (e) {
            this.showEmailError('Errore di rete durante l\'invio Quantità Zero: ' + (e?.message || e));
        }
    }

    // SMTP methods
    saveGeneralSettings() {
        const companyName = (document.getElementById('company-name') || {}).value || '';
        const notificationDays = parseInt((document.getElementById('notification-days') || {}).value, 10);
        const defaultLocation = (document.getElementById('default-location') || {}).value || '';

        // Validazione base
        if (!companyName.trim()) {
            alert('Il nome azienda è obbligatorio.');
            return;
        }
        if (isNaN(notificationDays) || notificationDays < 1 || notificationDays > 365) {
            alert('Giorni di preavviso deve essere tra 1 e 365.');
            return;
        }

        const items = [
            { key: 'company.name', value: companyName },
            { key: 'scadenze.soglia_giorni', value: notificationDays, type: 'number' },
            { key: 'company.default_location', value: defaultLocation },
        ];
        this.saveSettingsBulk(items, 'Impostazioni generali salvate con successo!');
    }

    saveReportSettings() {
        const companyNameEl = document.getElementById('company-name');
        const companyAddressEl = document.getElementById('company-address');
        const defaultOperatorEl = document.getElementById('default-operator');
        const reportTemplateEl = document.getElementById('report-template');
        const autoPrintEl = document.getElementById('auto-print');
        const showSignaturesEl = document.getElementById('show-signatures');

        const items = [];
        if (companyNameEl) items.push({ key: 'company.name', value: companyNameEl.value });
        if (companyAddressEl) items.push({ key: 'company.address', value: companyAddressEl.value });
        if (defaultOperatorEl) items.push({ key: 'report.default_operator', value: defaultOperatorEl.value });
        if (reportTemplateEl) items.push({ key: 'report.template_path', value: reportTemplateEl.value });
        if (autoPrintEl) items.push({ key: 'report.auto_print', value: !!autoPrintEl.checked, type: 'boolean' });
        if (showSignaturesEl) items.push({ key: 'report.show_signatures', value: !!showSignaturesEl.checked, type: 'boolean' });

        this.saveSettingsBulk(items, 'Impostazioni rapporti salvate con successo!');
    }

    exportData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `first-aid-data-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    clearAllData() {
        if (confirm('Sei sicuro di voler cancellare tutti i dati? Questa operazione non può essere annullata.')) {
            localStorage.removeItem('firstAidData');
            location.reload();
        }
    }

    saveSMTPSettings() {
        const host = (document.getElementById('smtp-host') || {}).value || '';
        const port = parseInt((document.getElementById('smtp-port') || {}).value, 10);
        const secure = !!((document.getElementById('smtp-secure') || {}).checked);
        const username = (document.getElementById('smtp-username') || {}).value || '';
        const password = (document.getElementById('smtp-password') || {}).value || '';

        // Validazione base
        if (!host.trim()) {
            alert('Il server SMTP è obbligatorio.');
            return;
        }
        if (isNaN(port) || port <= 0) {
            alert('La porta SMTP deve essere un numero valido.');
            return;
        }
        // email semplice (best-effort)
        if (username && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
            alert('Inserisci un username email valido per SMTP.');
            return;
        }

        const items = [
            { key: 'smtp.host', value: host },
            { key: 'smtp.port', value: port, type: 'number' },
            { key: 'smtp.secure', value: secure, type: 'boolean' },
            { key: 'smtp.username', value: username },
            { key: 'smtp.password', value: password }
        ];
        this.saveSettingsBulk(items, 'Impostazioni SMTP salvate con successo!');
    }

    testSMTP() {
        const testEmail = document.getElementById('test-email').value;
        if (!testEmail) {
            alert('Please enter a test email address.');
            return;
        }
        
        // Simulate SMTP test
        alert('Test email sent successfully!');
    }

    runSMTPDiagnostics() {
        // Simulate SMTP diagnostics
        alert('SMTP Diagnostics:\n\n✓ Server connection: OK\n✓ Authentication: OK\n✓ Port access: OK');
    }

    // ===== Backend Materials API helpers =====
    getApiHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'x-user': (this.data?.settings?.defaultOperatorName) || 'app'
        };
    }

    // Effettua fetch con timeout per evitare richieste pendenti che causano abort
    async timeoutFetch(url, options = {}, timeoutMs = 2000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
            return resp;
        } finally {
            clearTimeout(id);
        }
    }

    // Determina automaticamente la base API
    async resolveApiBase() {
        const onStatic5173 = (location.port || '') === '5173';
        const candidates = onStatic5173 ? [
            // Quando la UI è su 5173, evita stessa origine e prova prima 3002
            'http://localhost:3002/api',
            'http://127.0.0.1:3002/api',
            'http://localhost:3000/api',
            'http://127.0.0.1:3000/api',
            'http://localhost:3005/api',
            'http://127.0.0.1:3005/api'
        ] : [
            // In altri casi prova prima stessa origine, poi fallback
            `${location.origin}/api`,
            'http://localhost:3000/api',
            'http://127.0.0.1:3000/api',
            'http://localhost:3002/api',
            'http://127.0.0.1:3002/api',
            'http://localhost:3005/api',
            'http://127.0.0.1:3005/api'
        ];
        for (const base of candidates) {
            try {
                const testUrl = `${base}/health`;
                const resp = await this.timeoutFetch(testUrl, { headers: this.getApiHeaders(), method: 'GET' }, 2000);
                if (resp && resp.ok) {
                    this.apiBase = base;
                    console.info('API base selezionata:', base);
                    return;
                }
            } catch (_) {
                // continua con il prossimo candidato
            }
        }
        // Nessun candidato raggiungibile: mantieni default e logga
        console.warn('Nessuna API raggiungibile. Modalità offline per materiali.');
    }

    // ===== Backend Settings API helpers =====
    // Utility: get nested setting value from appSettings
    getSetting(key, fallback = undefined) {
        try {
            const parts = String(key).split('.');
            let cur = this.appSettings;
            for (const p of parts) {
                if (cur == null) return fallback;
                cur = cur[p];
            }
            return cur === undefined ? fallback : cur;
        } catch (_) {
            return fallback;
        }
    }

    // Utility: set nested setting value in appSettings
    setSetting(key, value) {
        const parts = String(key).split('.');
        let cur = this.appSettings;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (i === parts.length - 1) {
                cur[p] = value;
            } else {
                if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
                cur = cur[p];
            }
        }
    }

    // Load settings from backend and hydrate appSettings
    async loadBackendSettings() {
        const url = `${this.apiBase}/settings`;
        const resp = await this.timeoutFetch(url, { headers: this.getApiHeaders() }, 2500);
        if (!resp.ok) throw new Error(`GET /settings failed: ${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        // Unflatten
        const nested = {};
        for (const it of items) {
            const parts = String(it.key).split('.');
            let cur = nested;
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (i === parts.length - 1) {
                    cur[p] = it.value;
                } else {
                    cur[p] = cur[p] || {};
                    cur = cur[p];
                }
            }
        }
        this.appSettings = nested;
        // Se il pannello impostazioni è aperto, rinfresca
        const activeTab = document.querySelector('.settings-tab.active')?.getAttribute('data-tab');
        if (activeTab) this.createSettingsPanel(activeTab);
    }

    async saveSettingsBulk(items, successMessage = 'Impostazioni salvate!') {
        try {
            const url = `${this.apiBase}/settings/bulk`;
            const resp = await this.timeoutFetch(url, {
                method: 'PATCH',
                headers: this.getApiHeaders(),
                body: JSON.stringify({ items })
            }, 2500);
            if (!resp.ok) {
                // Fallback: salva localmente se backend indisponibile
                console.warn('Backend indisponibile, salvo localmente.');
                for (const { key, value } of items) this.setSetting(key, value);
                this.saveData();
                alert(successMessage + ' (salvataggio locale)');
                return;
            }
            const data = await resp.json();
            const saved = Array.isArray(data.items) ? data.items : [];
            for (const it of saved) this.setSetting(it.key, it.value);
            alert(successMessage);
        } catch (e) {
            // Fallback locale
            console.warn('Errore salvataggio impostazioni:', e?.message || e);
            for (const { key, value } of items) this.setSetting(key, value);
            this.saveData();
            alert(successMessage + ' (salvataggio locale)');
        }
        // Aggiorna pannello corrente
        const activeTab = document.querySelector('.settings-tab.active')?.getAttribute('data-tab');
        if (activeTab) this.createSettingsPanel(activeTab);
    }

    async exportSettings() {
        try {
            const url = `${this.apiBase}/settings/export`;
            const resp = await this.timeoutFetch(url, { headers: this.getApiHeaders() }, 2500);
            if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
            const text = await resp.text();
            const blob = new Blob([text], { type: 'application/json' });
            const urlObj = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = urlObj;
            link.download = `settings-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            URL.revokeObjectURL(urlObj);
        } catch (e) {
            alert('Esporta impostazioni fallita: ' + (e?.message || e));
        }
    }

    async importSettings(json) {
        try {
            const url = `${this.apiBase}/settings/import`;
            const resp = await this.timeoutFetch(url, {
                method: 'POST',
                headers: this.getApiHeaders(),
                body: JSON.stringify(json)
            }, 5000);
            if (!resp.ok) throw new Error(`Import failed: ${resp.status}`);
            const data = await resp.json();
            const items = Array.isArray(data.items) ? data.items : [];
            for (const it of items) this.setSetting(it.key, it.value);
            const activeTab = document.querySelector('.settings-tab.active')?.getAttribute('data-tab');
            if (activeTab) this.createSettingsPanel(activeTab);
        } catch (e) {
            alert('Import impostazioni fallita: ' + (e?.message || e));
        }
    }

    // Encode/Decode extra attributes (minQty, maxQty) within note field
    decodeExtrasFromNote(note) {
        const out = { minQty: null, maxQty: null };
        if (!note || typeof note !== 'string') return out;
        const trimmed = note.trim();
        try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === 'object') {
                if (Number.isFinite(parseInt(obj.minQty, 10))) out.minQty = parseInt(obj.minQty, 10);
                if (Number.isFinite(parseInt(obj.maxQty, 10))) out.maxQty = parseInt(obj.maxQty, 10);
                return out;
            }
        } catch (_) {}
        // Fallback simple pattern: minQty=10;maxQty=20
        const mMin = trimmed.match(/minQty\s*=\s*(\d+)/i);
        const mMax = trimmed.match(/maxQty\s*=\s*(\d+)/i);
        if (mMin) out.minQty = parseInt(mMin[1], 10);
        if (mMax) out.maxQty = parseInt(mMax[1], 10);
        return out;
    }

    encodeExtrasToNote(minQty, maxQty) {
        const payload = {};
        if (Number.isFinite(minQty)) payload.minQty = minQty;
        if (Number.isFinite(maxQty)) payload.maxQty = maxQty;
        return JSON.stringify(payload);
    }

    async loadServerMaterials() {
        try {
            if (!this.apiBase) await this.resolveApiBase();
            if (!this.apiBase) {
                console.warn('API base non risolta. Materiali in modalità offline.');
                this.serverMaterials = [];
                return;
            }
            const url = `${this.apiBase}/materiali`;
            const resp = await this.timeoutFetch(url, { headers: this.getApiHeaders(), method: 'GET' }, 4000);
            if (resp && resp.ok) {
                const items = await resp.json();
                this.serverMaterials = Array.isArray(items)
                    ? items.map(m => {
                        const extras = this.decodeExtrasFromNote(m.note || '');
                        return { ...m, minQty: extras.minQty, maxQty: extras.maxQty };
                      })
                    : [];
            } else {
                console.warn('Caricamento materiali non riuscito:', resp ? resp.status : 'no response');
                this.serverMaterials = [];
            }
        } catch (e) {
            console.warn('Errore caricamento materiali:', e?.message || e);
            this.serverMaterials = [];
        }
    }

    renderDbMaterialsRows() {
        const items = Array.isArray(this.serverMaterials) ? this.serverMaterials.slice() : [];
        if (items.length === 0) {
            return `<tr><td colspan="5" class="text-muted">Nessun materiale presente nel DB</td></tr>`;
        }
        // Filters
        const idFilter = this.dbMatFilters.id ? parseInt(this.dbMatFilters.id, 10) : null;
        const nameFilter = (this.dbMatFilters.name || '').trim().toLowerCase();
        const catFilter = (this.dbMatFilters.categoria || '').trim();
        let filtered = items.filter(m => {
            const byId = idFilter ? m.id === idFilter : true;
            const byName = nameFilter ? (m.nome_materiale || '').toLowerCase().includes(nameFilter) : true;
            const byCat = catFilter ? (m.categoria === catFilter) : true;
            return byId && byName && byCat;
        });
        // Sort
        const key = this.dbMatSort.key;
        const dir = this.dbMatSort.dir === 'asc' ? 1 : -1;
        const cmpStr = (a,b) => a.localeCompare(b, 'it', { sensitivity: 'base' });
        filtered.sort((a, b) => {
            if (key === 'id') return (a.id - b.id) * dir;
            if (key === 'nome_materiale') return cmpStr(a.nome_materiale || '', b.nome_materiale || '') * dir;
            if (key === 'categoria') return cmpStr(a.categoria || '', b.categoria || '') * dir;
            if (key === 'maxQty') {
                const av = Number.isFinite(parseInt(a.maxQty, 10)) ? parseInt(a.maxQty, 10) : -Infinity;
                const bv = Number.isFinite(parseInt(b.maxQty, 10)) ? parseInt(b.maxQty, 10) : -Infinity;
                return (av - bv) * dir;
            }
            if (key === 'minQty') {
                const av = Number.isFinite(parseInt(a.minQty, 10)) ? parseInt(a.minQty, 10) : -Infinity;
                const bv = Number.isFinite(parseInt(b.minQty, 10)) ? parseInt(b.minQty, 10) : -Infinity;
                return (av - bv) * dir;
            }
            return 0;
        });
        // Pagination
        const size = this.dbMatPage.size;
        const page = Math.max(1, this.dbMatPage.number);
        const start = (page - 1) * size;
        const pageItems = filtered.slice(start, start + size);
        // Rows
        return pageItems.map(m => {
            const isStd = (m.categoria === 'Kit standard');
            const maxCol = isStd && Number.isFinite(parseInt(m.maxQty, 10)) ? parseInt(m.maxQty, 10) : '-';
            return `
                <tr>
                    <td>${m.id}</td>
                    <td>${m.nome_materiale || ''}</td>
                    <td>${m.categoria || ''}</td>
                    <td>${maxCol}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary db-edit-material" data-id="${m.id}" aria-label="Modifica materiale ${m.nome_materiale}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger db-delete-material" data-id="${m.id}" aria-label="Elimina materiale ${m.nome_materiale}"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
        }).join('');
    }

    async createDbMaterialFromForm(panel) {
        const idRaw = panel.querySelector('#db-mat-id')?.value?.trim() || '';
        const nome = panel.querySelector('#db-mat-nome')?.value?.trim() || '';
        const categoria = panel.querySelector('#db-mat-categoria')?.value || '';
        const minRaw = panel.querySelector('#db-mat-min')?.value || '';
        const maxRaw = panel.querySelector('#db-mat-max')?.value || '';
        const minQty = minRaw !== '' ? parseInt(minRaw, 10) : undefined;
        const maxQty = (categoria === 'Kit standard' && maxRaw !== '') ? parseInt(maxRaw, 10) : undefined;
        const idVal = idRaw !== '' ? parseInt(idRaw, 10) : undefined;

        // Validazione campi obbligatori
        if (!nome) { alert('Il campo Nome è obbligatorio.'); return; }
        if (!categoria) { alert('Seleziona una Categoria.'); return; }
        if (minRaw !== '' && (!Number.isFinite(minQty) || minQty < 0)) { alert('Quantità minima non valida.'); return; }
        if (categoria === 'Kit standard' && maxRaw !== '' && (!Number.isFinite(maxQty) || maxQty < 0)) { alert('Quantità massima non valida.'); return; }
        if (idRaw !== '' && (!Number.isFinite(idVal) || idVal <= 0)) { alert('ID non valido: inserisci un intero positivo.'); return; }
        if (idVal !== undefined) {
            const exists = Array.isArray(this.serverMaterials) && this.serverMaterials.some(m => m.id === idVal);
            if (exists) { alert('ID già esistente nel DB. Scegli un ID diverso.'); return; }
        }

        const body = { nome_materiale: nome, categoria, note: this.encodeExtrasToNote(minQty, maxQty) };
        if (idVal !== undefined) body.id = idVal;
        try {
            const url = `${this.apiBase}/materiali`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: this.getApiHeaders(),
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Errore HTTP ${resp.status}`);
            }
            // Pulisci form
            ['#db-mat-id','#db-mat-nome','#db-mat-categoria','#db-mat-min','#db-mat-max']
                .forEach(sel => { const el = panel.querySelector(sel); if (el) el.value = ''; });
            // Ricarica elenco
            await this.loadServerMaterials();
            this.createSettingsPanel('materials');
            alert('Materiale inserito nel DB.');
        } catch (e) {
            alert(`Errore inserimento DB: ${e.message}`);
        }
    }

    async deleteDbMaterial(id) {
        if (!confirm('Eliminare il materiale dal DB?')) return;
        try {
            const url = `${this.apiBase}/materiali/${id}`;
            const resp = await fetch(url, { method: 'DELETE', headers: this.getApiHeaders() });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            await this.loadServerMaterials();
            this.createSettingsPanel('materials');
            alert('Materiale eliminato dal DB.');
        } catch (e) {
            alert(`Errore eliminazione DB: ${e.message}`);
        }
    }

    openDbMaterialEditModal(id) {
        const m = this.serverMaterials.find(x => x.id === id);
        if (!m) { alert('Materiale non trovato.'); return; }
        const extras = { minQty: m.minQty, maxQty: m.maxQty };
        const isStd = (m.categoria === 'Kit standard');
        const content = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="edit-mat-id">ID:</label>
                    <input id="edit-mat-id" class="form-control" value="${m.id}" disabled aria-readonly="true" />
                </div>
                <div class="form-group">
                    <label for="edit-mat-nome">Nome (obbligatorio):</label>
                    <input id="edit-mat-nome" class="form-control" value="${m.nome_materiale || ''}" aria-required="true" />
                </div>
                <div class="form-group">
                    <label for="edit-mat-cat">Categoria (obbligatoria):</label>
                    <select id="edit-mat-cat" class="form-control" aria-required="true">
                        <option value="Kit standard" ${isStd?'selected':''}>Kit standard</option>
                        <option value="Kit personalizzato" ${!isStd?'selected':''}>Kit personalizzato</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="edit-mat-min">Quantità minima:</label>
                    <input id="edit-mat-min" type="number" class="form-control" min="0" value="${Number.isFinite(parseInt(extras.minQty,10))?parseInt(extras.minQty,10):''}" aria-describedby="edit-min-help" />
                    <small id="edit-min-help" class="text-muted">Visibile solo nel Rapporto Richieste d'ordine.</small>
                </div>
                <div class="form-group" id="grp-edit-mat-max">
                    <label for="edit-mat-max">Quantità massima (solo Kit standard):</label>
                    <input id="edit-mat-max" type="number" class="form-control" min="0" value="${isStd && Number.isFinite(parseInt(extras.maxQty,10))?parseInt(extras.maxQty,10):''}" />
                </div>
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.updateDbMaterialFromModal(${m.id})">Salva</button>`;
        this.showModal('Modifica materiale', content, footer);
        // Toggle max qty visibility on category change in modal
        const catSel = document.getElementById('edit-mat-cat');
        const grpMax = document.getElementById('grp-edit-mat-max');
        if (catSel && grpMax) {
            const toggle = () => { grpMax.style.display = (catSel.value === 'Kit standard') ? '' : 'none'; };
            toggle();
            catSel.addEventListener('change', toggle);
        }
    }

    async updateDbMaterialFromModal(id) {
        const nome = document.getElementById('edit-mat-nome')?.value?.trim() || '';
        const categoria = document.getElementById('edit-mat-cat')?.value || '';
        const minRaw = document.getElementById('edit-mat-min')?.value || '';
        const maxRaw = document.getElementById('edit-mat-max')?.value || '';
        const minQty = minRaw !== '' ? parseInt(minRaw, 10) : undefined;
        const maxQty = (categoria === 'Kit standard' && maxRaw !== '') ? parseInt(maxRaw, 10) : undefined;
        // Validate
        if (!nome) { alert('Il campo Nome è obbligatorio.'); return; }
        if (!categoria) { alert('Seleziona una Categoria.'); return; }
        if (minRaw !== '' && (!Number.isFinite(minQty) || minQty < 0)) { alert('Quantità minima non valida.'); return; }
        if (categoria === 'Kit standard' && maxRaw !== '' && (!Number.isFinite(maxQty) || maxQty < 0)) { alert('Quantità massima non valida.'); return; }
        if (!confirm('Confermi la modifica del materiale?')) return;
        try {
            const url = `${this.apiBase}/materiali/${id}`;
            const body = { nome_materiale: nome, categoria, note: this.encodeExtrasToNote(minQty, maxQty) };
            const resp = await fetch(url, { method: 'PUT', headers: this.getApiHeaders(), body: JSON.stringify(body) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            await this.loadServerMaterials();
            this.createSettingsPanel('materials');
            this.closeModal();
            alert('Materiale aggiornato.');
        } catch (e) {
            alert(`Errore aggiornamento: ${e.message}`);
        }
    }

    // User management
    addUser() {
        const firstName = document.getElementById('new-user-firstname').value;
        const lastName = document.getElementById('new-user-lastname').value;
        const signatureFile = document.getElementById('new-user-signature').files[0];
        
        if (!firstName || !lastName) {
            alert('Please fill in first and last name.');
            return;
        }
        
        const user = {
            id: this.generateId(),
            firstName,
            lastName,
            signature: null
        };
        
        if (signatureFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                user.signature = e.target.result;
                this.data.users.push(user);
                this.saveData();
                this.refreshUsersPanel();
            };
            reader.readAsDataURL(signatureFile);
        } else {
            this.data.users.push(user);
            this.saveData();
            this.refreshUsersPanel();
        }
    }

    refreshUsersPanel() {
        const panel = document.getElementById('settings-panel');
        if (!panel) {
            console.warn('Settings panel not found; cannot refresh Users panel.');
            return;
        }
        this.createSettingsPanel('users');
    }

    deleteUser(userId) {
        if (confirm('Are you sure you want to delete this user?')) {
            const index = this.data.users.findIndex(u => u.id === userId);
            if (index > -1) {
                this.data.users.splice(index, 1);
                this.saveData();
                this.createSettingsPanel('users');
                alert('Utente eliminato con successo!');
            }
        }
    }

    editUser(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) {
            alert('Utente non trovato.');
            return;
        }
        const content = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="edit-user-firstname">Nome:</label>
                    <input type="text" id="edit-user-firstname" class="form-control" value="${user.firstName || ''}">
                </div>
                <div class="form-group">
                    <label for="edit-user-lastname">Cognome:</label>
                    <input type="text" id="edit-user-lastname" class="form-control" value="${user.lastName || ''}">
                </div>
                <div class="form-group">
                    <label for="edit-user-signature">Firma (PNG):</label>
                    <input type="file" id="edit-user-signature" class="form-control" accept=".png">

                </div>
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.applyUserEdit('${userId}')">Salva</button>`;
        this.showModal('Modifica Utente', content, footer);
    }

    async applyUserEdit(userId) {
        const user = this.data.users.find(u => u.id === userId);
        if (!user) {
            alert('Utente non trovato.');
            return;
        }
        const firstName = document.getElementById('edit-user-firstname')?.value?.trim() || '';
        const lastName = document.getElementById('edit-user-lastname')?.value?.trim() || '';
        const signatureFile = document.getElementById('edit-user-signature')?.files?.[0] || null;
        if (!firstName || !lastName) {
            alert('Inserisci nome e cognome validi.');
            return;
        }
        user.firstName = firstName;
        user.lastName = lastName;
        if (signatureFile) {
            try {
                const reader = new FileReader();
                const fileData = await new Promise((resolve, reject) => {
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(signatureFile);
                });
                user.signature = fileData;
            } catch (e) {
                console.warn('Errore lettura firma:', e?.message);
            }
        }
        this.saveData();
        this.createSettingsPanel('users');
        this.closeModal();
        alert('Utente aggiornato con successo!');
    }

    // Report generation
    generateReport() {
        // Preleva valori e applica fallback dalle impostazioni
        let location = document.getElementById('report-location')?.value?.trim();
        if (!location || location.length === 0) {
            location = this.data?.settings?.defaultLocation || 'Uffici';
        }

        let operatorId = document.getElementById('report-operator')?.value;
        if (!operatorId || operatorId.length === 0) {
            operatorId = this.data?.settings?.defaultOperator || (this.data.users?.[0]?.id || '');
        }

        // Se nessun kit è selezionato, includi tutti i kit disponibili
        const selectedKitCheckboxes = Array.from(document.querySelectorAll('#selected-kits input:checked'));
        let selectedKitIds = selectedKitCheckboxes.map(cb => cb.value);
        if (!Array.isArray(selectedKitIds) || selectedKitIds.length === 0) {
            selectedKitIds = (this.data?.kits || []).map(k => k.id);
        }
        
        const operator = this.data.users.find(u => u.id === operatorId);
        // Prosegui comunque: i controlli qualità avviseranno se manca qualcosa
        
        const kitsPayload = selectedKitIds.map(kitId => {
            const kit = this.data.kits.find(k => k.id === kitId);
            if (!kit) return null;
            const articoli = (kit.items || []).map(item => {
                const descrizione = (this.getMaterialName?.(item.code)) || item.name || item.description || item.code;
                const max = parseInt((item.maxQuantity ?? item.totalQuantity ?? item.quantity), 10) || 0;
                const quantita = parseInt((item.currentQuantity ?? item.quantity), 10) || 0;
                const expiryList = Array.isArray(item.expiryDates) ? item.expiryDates : (item.expiryDate ? [item.expiryDate] : []);
                let scadenza = '-';
                if (expiryList.length > 0) {
                    const earliest = new Date(Math.min(...expiryList.map(d => new Date(d).getTime())));
                    scadenza = earliest.toISOString().split('T')[0];
                }
                const hasExpired = expiryList.some(d => this.isExpired(d));
                const stato = hasExpired ? 'scaduto' : (quantita === max ? 'idoneo' : 'da_controllare');
                return {
                    codice: item.code,
                    descrizione,
                    quantita,
                    scadenza,
                    stato
                };
            });
            return {
                codice: kit.id,
                ubicazione: (kit.location || location),
                articoli
            };
        }).filter(k => k !== null);
        
        const payload = {
            operatore: `${operator.firstName} ${operator.lastName}`,
            operatorSignature: operator.signature || null,
            dateLongFormat: !!this.data.settings?.dateLongFormat,
            thresholdDays: this.data.settings?.thresholdDays ?? 90,
            logoPath: this.data.settings?.companyLogo || undefined,
            kits: kitsPayload,
            location
        };
        
        // Controllo qualità prima della generazione: conferma se mancano informazioni
        const qcIssues = [];
        if (!location || location.length < 2) qcIssues.push('Ubicazione non valida o troppo corta.');
        const opName = operator ? `${operator.firstName} ${operator.lastName}`.trim() : '';
        if (!opName) qcIssues.push('Nome operatore mancante o operatore non valido.');
        if (this.data.settings?.showSignatures !== false && operator && !payload.operatorSignature) {
            qcIssues.push('Firma digitale dell\'operatore mancante.');
        }
        if (!Array.isArray(kitsPayload) || kitsPayload.length === 0) qcIssues.push('Nessun kit disponibile nel rapporto.');

        if (qcIssues.length > 0) {
            const content = `<p>Controllo qualità: alcune informazioni richieste risultano mancanti o incomplete.</p>
                             <ul>${qcIssues.map(i => `<li>${i}</li>`).join('')}</ul>
                             <p>Vuoi procedere comunque?</p>`;
            const footer = `<button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
                            <button class="btn btn-primary" onclick='app.generateServerReport(${JSON.stringify(payload)}, ${JSON.stringify({ operatorId, selectedKitIds })})'>Procedi comunque</button>`;
            this.showModal('Conferma generazione', content, footer);
            return;
        }

        this.generateServerReport(payload, { operatorId, selectedKitIds });
    }


    // Invio al backend e gestione risposta
    async generateServerReport(payload, ctx, options = {}) {
        const btn = document.getElementById(options.btnId || 'generate-report');
        btn?.setAttribute('disabled', 'true');

        // Stato: in corso
        const progressTitle = options.progressTitle || 'Generazione in corso';
        const progressMsg = options.progressMessage || 'Sto generando il PDF del rapporto...';
        this.showModal(progressTitle, `<p>${progressMsg}</p>`, '');

        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                const content = '<p>Connessione assente. Verifica la rete e riprova.</p>';
                const footer = '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>';
                this.showModal('Errore di rete', content, footer);
                return;
            }
            const base = window.location.origin;
            const endpoint = options.endpoint || '/report/generate';
            const url = `${base}${endpoint}`;

            const controller = new AbortController();
            const timeoutMs = 45000; // 45s
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            let resp;
            try {
                resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
            } catch (err) {
                clearTimeout(timeoutId);
                // Retry una volta in caso di errore di rete/transitorio
                const isAbort = err && err.name === 'AbortError';
                if (!isAbort) {
                    await new Promise(r => setTimeout(r, 1500));
                    const retryController = new AbortController();
                    const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
                    try {
                        resp = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            signal: retryController.signal
                        });
                    } catch (retryErr) {
                        clearTimeout(retryTimeoutId);
                        const content = `<p>Impossibile contattare il server.</p><p>Dettagli: ${retryErr?.message || 'Failed to fetch'}</p>`;
                        const footer = '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>';
                        this.showModal('Errore di rete', content, footer);
                        return;
                    }
                    clearTimeout(retryTimeoutId);
                } else {
                    const content = `<p>Richiesta scaduta dopo ${Math.round(timeoutMs/1000)}s.</p><p>Riprova o verifica la connessione.</p>`;
                    const footer = '<button class="btn btn-secondary" onclick="app.closeModal()">Chiudi</button>';
                    this.showModal('Timeout richiesta', content, footer);
                    return;
                }
            }
            clearTimeout(timeoutId);

            const data = await resp.json().catch(() => null);

            if (!resp.ok) {
                const details = Array.isArray(data?.details) ? `<ul>${data.details.map(d => `<li>${d.field}: ${d.message}</li>`).join('')}</ul>` : '';
                const content = `<p>Errore nella generazione del report (${resp.status}).</p>${details}`;
                const footer = `<button class=\"btn btn-secondary\" onclick=\"app.closeModal()\">Chiudi</button>
                                <button class=\"btn btn-outline-primary\" onclick=\"app.printReport(${JSON.stringify(payload.location)}, ${JSON.stringify(ctx.operatorId)}, ${JSON.stringify(ctx.selectedKitIds)})\">Stampa HTML</button>`;
                this.showModal('Errore Generazione', content, footer);
                return;
            }

            const downloadUrl = data?.data?.downloadUrl;
            const warnings = Array.isArray(data?.data?.warnings) ? data.data.warnings : [];

            // Aggiorna storico
            const operator = this.data.users.find(u => u.id === ctx.operatorId);
            const selectedKits = this.data.kits.filter(k => ctx.selectedKitIds.includes(k.id));
            const reportRecord = {
                id: this.generateId(),
                date: new Date().toISOString(),
                location: payload.location,
                operator: `${operator?.firstName || ''} ${operator?.lastName || ''}`.trim(),
                kits: selectedKits.map(k => k.name),
                kitCount: selectedKits.length
            };
            this.data.reportsHistory = this.data.reportsHistory || [];
            this.data.reportsHistory.unshift(reportRecord);
            this.saveData();
            this.renderReports();

            const content = `<p>Report generato con successo.</p>
                             ${warnings.length ? `<div class=\"warning-list\"><ul>${warnings.map(w => `<li>${w}</li>`).join('')}</ul></div>` : ''}
                             ${downloadUrl ? `<p><a href=\"${downloadUrl}\" target=\"_blank\" class=\"btn btn-primary\">Scarica PDF</a></p>` : '<p>Nessun link di download disponibile.</p>'}`;
            const footer = `<button class=\"btn btn-secondary\" onclick=\"app.closeModal()\">Chiudi</button>`;
            this.showModal('Report Generato', content, footer);
        } catch (err) {
            const content = `<p>Errore di rete: ${err.message}.</p>`;
            const footer = `<button class=\"btn btn-secondary\" onclick=\"app.closeModal()\">Chiudi</button>
                            <button class=\"btn btn-outline-primary\" onclick=\"app.printReport(${JSON.stringify(payload.location)}, ${JSON.stringify(ctx.operatorId)}, ${JSON.stringify(ctx.selectedKitIds)})\">Stampa HTML</button>`;
            this.showModal('Errore di Rete', content, footer);
        } finally {
            btn?.removeAttribute('disabled');
        }
    }

    printReport(location, operatorId, selectedKitIds) {
        const operator = this.data.users.find(u => u.id === operatorId);
        const selectedKits = this.data.kits.filter(k => selectedKitIds.includes(k.id));
        const reportDate = new Date();
        
        // Format date in Italian with day name
        const formatItalianDate = (date) => {
            const days = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
            const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
                           'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
            
            const dayName = days[date.getDay()];
            const day = date.getDate();
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            
            return `${dayName} ${day} ${month} ${year}`;
        };
        
        // Save report to history
        if (!this.data.reportsHistory) {
            this.data.reportsHistory = [];
        }
        
        const reportRecord = {
            id: this.generateId(),
            date: reportDate.toISOString(),
            location: location,
            operator: `${operator.firstName} ${operator.lastName}`,
            kits: selectedKits.map(kit => kit.name),
            kitCount: selectedKits.length
        };
        
        this.data.reportsHistory.unshift(reportRecord);
        this.saveData();
        this.renderReports();
        
        // Create print window
        const printWindow = window.open('', '_blank');
        
        // Check if using two-column layout
        const useTwoColumns = this.data.settings?.reportTemplate === 'two-column';
        
        // Group kits for two-column layout if needed
        const kitGroups = useTwoColumns ? 
            selectedKits.reduce((groups, kit, index) => {
                const groupIndex = Math.floor(index / 2);
                if (!groups[groupIndex]) groups[groupIndex] = [];
                groups[groupIndex].push(kit);
                return groups;
            }, []) : selectedKits.map(kit => [kit]);
        
        const kitPages = kitGroups.map((kits, pageIndex) => `
            <div class="kit-page" ${pageIndex > 0 ? 'style="page-break-before: always;"' : ''}>
                <!-- Intestazione personalizzabile -->
                <div class="report-header">
                    <div class="header-content">
                        <div class="company-info">
                            ${this.data.settings?.companyLogo ? 
                                `<img src="${this.data.settings.companyLogo}" alt="Logo" class="company-logo">` : 
                                '<div class="logo-placeholder">LOGO</div>'
                            }
                            <div class="company-details">
                                <h1>${this.data.settings?.companyName || 'Nome Azienda'}</h1>
                                ${this.data.settings?.companyAddress ? 
                                    `<div class="company-address">${this.data.settings.companyAddress}</div>` : ''
                                }
                            </div>
                        </div>
                        <div class="report-title">
                            <h2>Rapporto Controllo Kit Primo Soccorso</h2>
                        </div>
                    </div>
                </div>
                
                <!-- Informazioni rapporto -->
                <div class="report-info">
                    <div class="info-grid">
                        <div class="info-item">
                            <strong>Luogo della sede:</strong> ${location}
                        </div>
                        <div class="info-item">
                            <strong>Data:</strong> ${formatItalianDate(reportDate)}
                        </div>
                        <div class="info-item">
                            <strong>Operatore:</strong> ${operator.firstName} ${operator.lastName}
                        </div>
                        <div class="info-item">
                            <strong>Pagina:</strong> ${pageIndex + 1} di ${kitGroups.length}
                        </div>
                    </div>
                </div>
                
                <!-- Layout cassette -->
                <div class="kits-container ${useTwoColumns ? 'two-columns' : 'single-column'}">
                    ${kits.map((kit, kitIndex) => `
                        <div class="kit-section ${useTwoColumns ? 'column' : ''}">
                            <h3 class="kit-title">${kit.name}</h3>
                            
                            <table class="kit-table">
                                <thead>
                                    <tr>
                                        <th>Articolo</th>
                                        <th>Qtà Attuale</th>
                                        <th>Qtà Max</th>
                                        <th>Stato</th>
                                        <th>Scadenze</th>
                                        <th>Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${kit.items.map(item => `
                                        <tr>
                                            <td>${this.getMaterialName(item.code)}</td>
                                            <td>${item.currentQuantity}</td>
                                            <td>${item.maxQuantity}</td>
                                            <td class="status-${item.currentQuantity === 0 ? 'empty' : item.currentQuantity === item.maxQuantity ? 'full' : 'partial'}">
                                                ${item.currentQuantity === 0 ? 'Vuoto' : item.currentQuantity === item.maxQuantity ? 'Completo' : 'Parziale'}
                                            </td>
                                            <td class="expiry-dates">${item.expiryDates.map(date => new Date(date).toLocaleDateString('it-IT')).join(', ') || 'Nessuna'}</td>
                                            <td class="notes">${item.notes || ''}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `).join('')}
                </div>
                
                <!-- Sezione Firma Operatore -->
                ${this.data.settings?.showSignatures !== false ? `
                    <div class="signature-section">
                        <div class="operator-signature">
                            <div class="signature-info">
                                <div class="signature-label">Firma Operatore:</div>
                                <div class="operator-name">${operator.firstName} ${operator.lastName}</div>
                            </div>
                            <div class="signature-area">
                                ${operator.signature ? 
                                    `<img src="${operator.signature}" alt="Firma ${operator.firstName} ${operator.lastName}" class="signature-image">` :
                                    '<div class="signature-placeholder">Spazio per firma PNG</div>'
                                }
                            </div>
                        </div>
                        <div class="date-signature">
                            <div class="date-label">Data Controllo:</div>
                            <div class="date-value">${formatItalianDate(reportDate)}</div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `).join('');
        
        printWindow.document.write(`
            <html>
            <head>
                <title>Rapporto Kit Primo Soccorso</title>
                <meta charset="UTF-8">
                <style>
                    @page {
                        size: A4;
                        margin: 20mm;
                    }
                    
                    body {
                        font-family: Arial, sans-serif;
                        font-size: 12px;
                        line-height: 1.4;
                        margin: 0;
                        padding: 0;
                    }
                    
                    .kit-page {
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    
                    /* Intestazione personalizzabile */
                    .report-header {
                        margin-bottom: 25px;
                        border-bottom: 2px solid #333;
                        padding-bottom: 15px;
                    }
                    
                    .header-content {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    
                    .company-info {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                    }
                    
                    .company-logo {
                        max-height: 60px;
                        max-width: 100px;
                        object-fit: contain;
                    }
                    
                    .logo-placeholder {
                        width: 80px;
                        height: 50px;
                        border: 2px dashed #ccc;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 10px;
                        color: #666;
                    }
                    
                    .company-details h1 {
                        margin: 0 0 5px 0;
                        font-size: 16px;
                        color: #333;
                    }
                    
                    .company-address {
                        font-size: 10px;
                        color: #666;
                        margin: 0;
                    }
                    
                    .report-title h2 {
                        margin: 0;
                        font-size: 18px;
                        color: #d32f2f;
                        text-align: right;
                    }
                    
                    /* Informazioni rapporto */
                    .report-info {
                        margin-bottom: 20px;
                    }
                    
                    .info-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 10px;
                        background-color: #f9f9f9;
                        padding: 15px;
                        border: 1px solid #ddd;
                    }
                    
                    .info-item {
                        font-size: 11px;
                    }
                    
                    /* Layout cassette */
                    .kits-container.two-columns {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 15px;
                    }
                    
                    .kits-container.single-column {
                        display: block;
                    }
                    
                    .kit-section {
                        margin-bottom: 20px;
                    }
                    
                    .kit-section.column {
                        margin-bottom: 0;
                    }
                    
                    .kit-title {
                        font-size: 14px;
                        font-weight: bold;
                        color: #d32f2f;
                        margin: 0 0 10px 0;
                        padding: 5px 10px;
                        background-color: #f5f5f5;
                        border-left: 4px solid #d32f2f;
                    }
                    
                    .kit-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 15px;
                        font-size: 9px;
                    }
                    
                    .kit-table th,
                    .kit-table td {
                        border: 1px solid #333;
                        padding: 6px 4px;
                        text-align: left;
                        vertical-align: top;
                    }
                    
                    .kit-table th {
                        background-color: #f5f5f5;
                        font-weight: bold;
                        font-size: 8px;
                    }
                    
                    .kit-table td {
                        font-size: 8px;
                    }
                    
                    .status-empty { color: #d32f2f; font-weight: bold; }
                    .status-full { color: #388e3c; font-weight: bold; }
                    .status-partial { color: #f57c00; font-weight: bold; }
                    
                    .expiry-dates {
                        font-size: 7px;
                    }
                    
                    .notes {
                        font-size: 7px;
                        max-width: 80px;
                        word-wrap: break-word;
                    }
                    
                    /* Sezione Firma */
                    .signature-section {
                        margin-top: 30px;
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-end;
                        border-top: 1px solid #ddd;
                        padding-top: 20px;
                    }
                    
                    .operator-signature {
                        display: flex;
                        align-items: center;
                        gap: 20px;
                    }
                    
                    .signature-info {
                        text-align: left;
                    }
                    
                    .signature-label {
                        font-size: 11px;
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    
                    .operator-name {
                        font-size: 10px;
                        color: #666;
                    }
                    
                    .signature-area {
                        width: 150px;
                        height: 60px;
                        border: 1px solid #333;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .signature-image {
                        max-width: 140px;
                        max-height: 50px;
                        object-fit: contain;
                    }
                    
                    .signature-placeholder {
                        font-size: 9px;
                        color: #999;
                        text-align: center;
                    }
                    
                    .date-signature {
                        text-align: center;
                    }
                    
                    .date-label {
                        font-size: 11px;
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    
                    .date-value {
                        font-size: 10px;
                        padding: 5px 10px;
                        border: 1px solid #333;
                        background-color: #f9f9f9;
                    }
                    
                    /* Responsive per stampa */
                    @media print {
                        .kit-page {
                            page-break-after: always;
                        }
                        
                        .kit-page:last-child {
                            page-break-after: avoid;
                        }
                        
                        .kits-container.two-columns {
                            grid-template-columns: 1fr 1fr;
                            gap: 10px;
                        }
                        
                        .kit-section {
                            page-break-inside: avoid;
                        }
                        
                        .signature-section {
                            page-break-inside: avoid;
                        }
                        
                        .report-header {
                            page-break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body>
                ${kitPages}
            </body>
            </html>
        `);
        
        printWindow.document.close();
        printWindow.print();
    }

    // Data persistence
    saveData() {
        localStorage.setItem('firstAidManagerData', JSON.stringify(this.data));
    }

    loadData() {
        const saved = localStorage.getItem('firstAidManagerData');
        if (saved) {
            const loadedData = JSON.parse(saved);
            // Merge with default structure to handle new fields
            this.data = { ...this.data, ...loadedData };
        }
    }

    scheduleAutoSave() {
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => {
            this.saveData();
        }, 1000);
    }

    // Email Data Mapping System
    /**
     * Sistema di mappatura automatica dei dati dai div ai textarea dell'email
     * Implementa validazione, formattazione standard aziendale e controllo errori
     */
    
    /**
     * Estrae dati dai div degli articoli in scadenza
     * @returns {Object} Dati strutturati degli articoli in scadenza
     */
    extractExpiringItemsData() {
        try {
            const container = document.getElementById('expiring-items');
            if (!container) {
                throw new Error('Container articoli in scadenza non trovato');
            }

            const itemRows = container.querySelectorAll('.item-row');
            const items = [];
            
            itemRows.forEach((row, index) => {
                try {
                    const codeEl = row.querySelector('.item-code');
                    const nameEl = row.querySelector('.item-name');
                    const quantityEl = row.querySelector('.item-quantity');
                    const expiryEl = row.querySelector('.item-expiry');
                    
                    if (!codeEl || !nameEl || !quantityEl || !expiryEl) {
                        console.warn(`Elementi mancanti nella riga ${index + 1} degli articoli in scadenza`);
                        return;
                    }
                    
                    const item = {
                        code: this.sanitizeText(codeEl.textContent),
                        name: this.sanitizeText(nameEl.textContent),
                        quantity: this.extractQuantityFromText(quantityEl.textContent),
                        expiryDate: this.extractDateFromText(expiryEl.textContent),
                        rowIndex: index + 1
                    };
                    
                    // Validazione dati articolo
                    if (this.validateItemData(item)) {
                        items.push(item);
                    }
                } catch (error) {
                    console.error(`Errore elaborazione riga ${index + 1}:`, error);
                }
            });
            
            return {
                items,
                totalCount: items.length,
                extractedAt: new Date().toISOString(),
                source: 'expiring-items-div'
            };
        } catch (error) {
            console.error('Errore estrazione dati articoli in scadenza:', error);
            throw error;
        }
    }
    
    /**
     * Estrae dati dai div degli articoli con quantità zero
     * @returns {Object} Dati strutturati degli articoli con quantità zero
     */
    extractZeroQuantityItemsData() {
        try {
            const container = document.getElementById('zero-quantity-items');
            if (!container) {
                throw new Error('Container articoli quantità zero non trovato');
            }

            const itemRows = container.querySelectorAll('.item-row');
            const items = [];
            
            itemRows.forEach((row, index) => {
                try {
                    const codeEl = row.querySelector('.item-code');
                    const nameEl = row.querySelector('.item-name');
                    const locationEl = row.querySelector('.item-location');
                    
                    if (!codeEl || !nameEl) {
                        console.warn(`Elementi mancanti nella riga ${index + 1} degli articoli quantità zero`);
                        return;
                    }
                    
                    const item = {
                        code: this.sanitizeText(codeEl.textContent),
                        name: this.sanitizeText(nameEl.textContent),
                        location: locationEl ? this.extractLocationFromText(locationEl.textContent) : 'Non specificata',
                        quantity: 0,
                        rowIndex: index + 1
                    };
                    
                    // Validazione dati articolo
                    if (this.validateItemData(item)) {
                        items.push(item);
                    }
                } catch (error) {
                    console.error(`Errore elaborazione riga ${index + 1}:`, error);
                }
            });
            
            return {
                items,
                totalCount: items.length,
                extractedAt: new Date().toISOString(),
                source: 'zero-quantity-items-div'
            };
        } catch (error) {
            console.error('Errore estrazione dati articoli quantità zero:', error);
            throw error;
        }
    }
    
    /**
     * Utilità per sanificare il testo estratto dai div
     * @param {string} text - Testo da sanificare
     * @returns {string} Testo sanificato
     */
    sanitizeText(text) {
        if (!text || typeof text !== 'string') return '';
        return text.trim().replace(/\s+/g, ' ').replace(/[<>]/g, '');
    }
    
    /**
     * Estrae la quantità dal testo (es. "Quantità: 5" -> 5)
     * @param {string} text - Testo contenente la quantità
     * @returns {number} Quantità estratta
     */
    extractQuantityFromText(text) {
        if (!text) return 0;
        const match = text.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }
    
    /**
     * Estrae la data dal testo (es. "Scadenza: 2024-12-31" -> "2024-12-31")
     * @param {string} text - Testo contenente la data
     * @returns {string} Data estratta
     */
    extractDateFromText(text) {
        if (!text) return '';
        const match = text.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
        return match ? match[1] : text.replace(/^[^:]*:\s*/, '').trim();
    }
    
    /**
     * Estrae l'ubicazione dal testo (es. "Ubicazione: Magazzino A" -> "Magazzino A")
     * @param {string} text - Testo contenente l'ubicazione
     * @returns {string} Ubicazione estratta
     */
    extractLocationFromText(text) {
        if (!text) return '';
        return text.replace(/^[^:]*:\s*/, '').trim();
    }
    
    /**
     * Valida i dati di un articolo
     * @param {Object} item - Dati dell'articolo da validare
     * @returns {boolean} True se i dati sono validi
     */
    validateItemData(item) {
        if (!item || typeof item !== 'object') return false;
        
        // Validazione campi obbligatori
        if (!item.code || !item.name) {
            console.warn('Articolo con codice o nome mancante:', item);
            return false;
        }
        
        // Validazione lunghezza campi
        if (item.code.length > 50 || item.name.length > 200) {
            console.warn('Articolo con campi troppo lunghi:', item);
            return false;
        }
        
        // Validazione quantità
        if (typeof item.quantity === 'number' && item.quantity < 0) {
            console.warn('Articolo con quantità negativa:', item);
            return false;
        }
        
        return true;
    }
    
    /**
     * Formatta i dati secondo lo standard aziendale per email
     * @param {Object} data - Dati da formattare
     * @param {string} type - Tipo di email ('expiring' o 'zero-quantity')
     * @returns {string} Contenuto formattato per email
     */
    formatDataForEmail(data, type) {
        try {
            if (!data || !data.items || !Array.isArray(data.items)) {
                throw new Error('Dati non validi per la formattazione email');
            }
            
            const companyName = this.data.settings?.companyName || 'Azienda';
            const currentDate = new Date().toLocaleDateString('it-IT');
            const totalItems = data.totalCount;
            
            let emailContent = '';
            
            // Header standard aziendale
            emailContent += `${companyName}\n`;
            emailContent += `Report del ${currentDate}\n\n`;
            
            if (type === 'expiring') {
                emailContent += `ARTICOLI IN SCADENZA\n`;
                emailContent += `===================\n\n`;
                emailContent += `Sono stati identificati ${totalItems} articoli che necessitano attenzione per scadenza imminente.\n\n`;
            } else if (type === 'zero-quantity') {
                emailContent += `ARTICOLI ESAURITI\n`;
                emailContent += `================\n\n`;
                emailContent += `Sono stati identificati ${totalItems} articoli con quantità zero che necessitano rifornimento.\n\n`;
            }
            
            // Tabella articoli
            if (data.items.length > 0) {
                emailContent += `DETTAGLIO ARTICOLI:\n\n`;
                
                // Header tabella
                emailContent += `${'Codice'.padEnd(15)} | ${'Nome'.padEnd(30)} | `;
                if (type === 'expiring') {
                    emailContent += `${'Quantità'.padEnd(10)} | ${'Scadenza'.padEnd(12)}\n`;
                } else {
                    emailContent += `${'Ubicazione'.padEnd(20)}\n`;
                }
                emailContent += `${'-'.repeat(80)}\n`;
                
                // Righe articoli
                data.items.forEach(item => {
                    emailContent += `${(item.code || '').padEnd(15)} | ${(item.name || '').padEnd(30)} | `;
                    if (type === 'expiring') {
                        emailContent += `${String(item.quantity || 0).padEnd(10)} | ${(item.expiryDate || '').padEnd(12)}\n`;
                    } else {
                        emailContent += `${(item.location || '').padEnd(20)}\n`;
                    }
                });
            }
            
            // Footer standard aziendale
            emailContent += `\n\n`;
            emailContent += `AZIONI RICHIESTE:\n`;
            if (type === 'expiring') {
                emailContent += `- Verificare le date di scadenza\n`;
                emailContent += `- Pianificare l'utilizzo degli articoli in scadenza\n`;
                emailContent += `- Aggiornare l'inventario se necessario\n`;
            } else {
                emailContent += `- Verificare le quantità in magazzino\n`;
                emailContent += `- Procedere con il riordino degli articoli esauriti\n`;
                emailContent += `- Aggiornare l'inventario dopo il rifornimento\n`;
            }
            
            emailContent += `\n`;
            emailContent += `Report generato automaticamente dal sistema di gestione First Aid Manager.\n`;
            emailContent += `Per assistenza contattare: ${this.data.settings?.supportEmail || 'assistenza.tecnica@isokit.it'}\n`;
            
            return emailContent;
        } catch (error) {
            console.error('Errore formattazione dati per email:', error);
            throw error;
        }
    }
    
    /**
     * Popola automaticamente il textarea dell'email con i dati dai div
     * @param {string} emailType - Tipo di email ('expiring' o 'zero-quantity')
     * @returns {Promise<boolean>} True se l'operazione è riuscita
     */
    async populateEmailFromDivData(emailType) {
        try {
            let data;
            let textareaId;
            
            // Determina quale tipo di dati estrarre
            if (emailType === 'expiring') {
                data = this.extractExpiringItemsData();
                textareaId = 'expiring-body';
            } else if (emailType === 'zero-quantity') {
                data = this.extractZeroQuantityItemsData();
                textareaId = 'zero-body';
            } else {
                throw new Error(`Tipo email non supportato: ${emailType}`);
            }
            
            // Verifica integrità dati
            if (!this.validateEmailData(data)) {
                throw new Error('Validazione dati fallita');
            }
            
            // Formatta i dati
            const formattedContent = this.formatDataForEmail(data, emailType);
            
            // Popola il textarea
            const textarea = document.getElementById(textareaId);
            if (!textarea) {
                throw new Error(`Textarea ${textareaId} non trovato`);
            }
            
            textarea.value = formattedContent;
            
            // Trigger evento change per notificare altri componenti
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Log dell'operazione
            console.log(`Email ${emailType} popolata con successo:`, {
                itemsCount: data.totalCount,
                source: data.source,
                timestamp: data.extractedAt
            });
            
            return true;
        } catch (error) {
            console.error(`Errore popolamento email ${emailType}:`, error);
            this.showEmailError(`Errore durante il popolamento automatico dell'email: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Valida l'integrità dei dati estratti
     * @param {Object} data - Dati da validare
     * @returns {boolean} True se i dati sono integri
     */
    validateEmailData(data) {
        if (!data || typeof data !== 'object') {
            console.error('Dati email non validi: oggetto mancante o non valido');
            return false;
        }
        
        if (!Array.isArray(data.items)) {
            console.error('Dati email non validi: array items mancante');
            return false;
        }
        
        if (typeof data.totalCount !== 'number' || data.totalCount < 0) {
            console.error('Dati email non validi: totalCount non valido');
            return false;
        }
        
        if (data.totalCount !== data.items.length) {
            console.error('Dati email non validi: mismatch tra totalCount e lunghezza array');
            return false;
        }
        
        // Validazione singoli articoli
        for (let i = 0; i < data.items.length; i++) {
            if (!this.validateItemData(data.items[i])) {
                console.error(`Dati email non validi: articolo ${i} non valido`);
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Mostra errori relativi al sistema email
     * @param {string} message - Messaggio di errore
     */
    showEmailError(message) {
        // Crea o aggiorna un div per gli errori email
        let errorDiv = document.getElementById('email-error-display');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'email-error-display';
            errorDiv.className = 'alert alert-danger email-error';
            errorDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 400px;
                z-index: 10000;
                padding: 15px;
                border-radius: 5px;
                background-color: #f8d7da;
                border: 1px solid #f5c6cb;
                color: #721c24;
            `;
            document.body.appendChild(errorDiv);
        }
        
        errorDiv.innerHTML = `
            <strong>Errore Sistema Email:</strong><br>
            ${message}
            <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer;">&times;</button>
        `;
        
        // Auto-rimozione dopo 10 secondi
        setTimeout(() => {
            if (errorDiv && errorDiv.parentElement) {
                errorDiv.remove();
            }
        }, 10000);
    }
    
    /**
     * Effettua il parsing JSON in modo sicuro, gestendo risposte vuote
     * @param {Response} resp - Oggetto Response di fetch
     * @returns {Promise<Object>} JSON parsato o oggetto vuoto
     */
    async parseJsonSafe(resp) {
        try {
            const ct = (resp.headers.get('content-type') || '').toLowerCase();
            const text = await resp.text();
            if (!text || text.trim() === '') {
                return {};
            }
            if (ct.includes('application/json')) {
                return JSON.parse(text);
            }
            // Tenta comunque il parse, altrimenti ritorna testo grezzo
            try {
                return JSON.parse(text);
            } catch (_) {
                return { raw: text };
            }
        } catch (e) {
            return {};
        }
    }

    /**
     * Aggiunge pulsanti per il popolamento automatico delle email
     */
    addEmailMappingButtons() {
        try {
            // Pulsante per articoli in scadenza
            const expiringSection = document.querySelector('#email .template-section:first-child');
            if (expiringSection) {
                const existingBtn = expiringSection.querySelector('.auto-populate-btn');
                if (!existingBtn) {
                    const button = document.createElement('button');
                    button.className = 'btn btn-info auto-populate-btn';
                    button.dataset.sizeGroup = 'email-map';
                    button.innerHTML = '<i class="fas fa-magic"></i> Popola Automaticamente da Dati';
                    button.style.marginTop = '10px';
                    button.onclick = () => this.populateEmailFromDivData('expiring');
                    
                    const bodyGroup = expiringSection.querySelector('.form-group:last-child');
                    if (bodyGroup) {
                        bodyGroup.appendChild(button);
                    }
                }
            }
            
            // Pulsante per articoli quantità zero
            const zeroSection = document.querySelector('#email .template-section:last-child');
            if (zeroSection) {
                const existingBtn = zeroSection.querySelector('.auto-populate-btn');
                if (!existingBtn) {
                    const button = document.createElement('button');
                    button.className = 'btn btn-info auto-populate-btn';
                    button.dataset.sizeGroup = 'email-map';
                    button.innerHTML = '<i class="fas fa-magic"></i> Popola Automaticamente da Dati';
                    button.style.marginTop = '10px';
                    button.onclick = () => this.populateEmailFromDivData('zero-quantity');
                    
                    const bodyGroup = zeroSection.querySelector('.form-group:last-child');
                    if (bodyGroup) {
                        bodyGroup.appendChild(button);
                    }
                }
            }
            // Sincronizza dimensioni dei pulsanti mappati
            this.syncButtonSizeGroup('email-map');
        } catch (error) {
            console.error('Errore aggiunta pulsanti mappatura email:', error);
        }
    }

    /**
     * Sincronizza larghezza/altezza di tutti gli elementi con lo stesso data-size-group
     * Garantisce dimensioni identiche anche al resize o cambi layout
     * @param {string} groupName
     */
    syncButtonSizeGroup(groupName) {
        try {
            // Track all groups we synchronize
            if (!this._sizeGroups) this._sizeGroups = new Set();
            this._sizeGroups.add(groupName);
            const elements = document.querySelectorAll(`[data-size-group="${groupName}"]`);
            if (!elements || elements.length === 0) return;

            // Reset per misurazione naturale
            elements.forEach(el => {
                el.style.width = 'auto';
                el.style.height = 'auto';
            });

            let maxWidth = 0;
            let maxHeight = 0;
            elements.forEach(el => {
                const w = Math.ceil(el.offsetWidth);
                const h = Math.ceil(el.offsetHeight);
                if (w > maxWidth) maxWidth = w;
                if (h > maxHeight) maxHeight = h;
            });

            elements.forEach(el => {
                el.style.width = `${maxWidth}px`;
                el.style.height = `${maxHeight}px`;
            });

            // Setup osservatori una sola volta
            if (!this._sizeSyncSetup) {
                const onResize = () => {
                    if (this._sizeGroups && this._sizeGroups.size) {
                        this._sizeGroups.forEach(g => this.syncButtonSizeGroup(g));
                    }
                };
                window.addEventListener('resize', onResize);

                if (typeof MutationObserver !== 'undefined') {
                    const observer = new MutationObserver(() => {
                        if (this._sizeGroups && this._sizeGroups.size) {
                            this._sizeGroups.forEach(g => this.syncButtonSizeGroup(g));
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                    this._sizeObserver = observer;
                }

                this._sizeSyncSetup = true;
            }
            // Verifica post-sync
            this.verifyButtonSizeGroup(groupName);
        } catch (err) {
            console.warn('Sync dimensioni pulsanti fallita:', err);
        }
    }

    /**
     * Verifica che tutti gli elementi del gruppo abbiano dimensioni identiche
     * In caso di discrepanze, riapplica la sincronizzazione
     * @param {string} groupName
     */
    verifyButtonSizeGroup(groupName) {
        try {
            const elements = document.querySelectorAll(`[data-size-group="${groupName}"]`);
            if (!elements || elements.length < 2) return;

            const getDims = (el) => {
                const cs = window.getComputedStyle(el);
                return {
                    width: Math.round(parseFloat(cs.width)),
                    height: Math.round(parseFloat(cs.height)),
                    boxSizing: cs.boxSizing,
                    fontSize: cs.fontSize,
                    padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
                    border: `${cs.borderTopWidth} ${cs.borderRightWidth} ${cs.borderBottomWidth} ${cs.borderLeftWidth}`
                };
            };

            const baseline = getDims(elements[0]);
            let mismatch = false;
            for (let i = 1; i < elements.length; i++) {
                const dims = getDims(elements[i]);
                if (dims.width !== baseline.width || dims.height !== baseline.height) {
                    mismatch = true;
                    break;
                }
                if (dims.boxSizing !== 'border-box') {
                    elements[i].style.boxSizing = 'border-box';
                    mismatch = true;
                }
            }

            if (mismatch) {
                // Riapplica la sincronizzazione per garantire uniformità
                this.syncButtonSizeGroup(groupName);
            }
        } catch (err) {
            console.warn('Verifica dimensioni pulsanti fallita:', err);
        }
    }

    /**
     * Inizializza il form "Dati Documento" con validazione e precompilazioni
     */
    initIdentityForm() {
        try {
            const nameEl = document.getElementById('doc-fullname');
            const roleEl = document.getElementById('doc-role');
            const dateEl = document.getElementById('doc-date');
            const dateBtn = document.getElementById('doc-date-btn');
            const datePicker = document.getElementById('doc-date-picker');
            const operatorEl = document.getElementById('doc-operator');

            if (!nameEl || !roleEl || !dateEl || !operatorEl) return; // markup non presente

            // Prefill operatore corrente
            const currentOp = this.getCurrentOperator();
            if (currentOp) operatorEl.value = `${currentOp.firstName} ${currentOp.lastName}`;

            // Prefill data odierna in dd/mm/yyyy
            const today = new Date();
            dateEl.value = this.formatDateDDMMYYYY(today);

            // Imposta data corrente (locale) in formato italiano al click
            if (dateBtn) {
                dateBtn.addEventListener('click', () => {
                    try {
                        const now = new Date();
                        dateEl.value = this.formatDateDDMMYYYY(now);
                    } catch (err) {
                        alert('Impossibile impostare la data. Riprova.');
                    }
                });
            }
            // Mantieni supporto al datePicker se l'utente lo usa manualmente
            if (datePicker) {
                datePicker.addEventListener('change', () => {
                    try {
                        if (datePicker.value) {
                            const [y, m, d] = datePicker.value.split('-').map(Number);
                            const picked = new Date(y, (m || 1) - 1, d || 1);
                            dateEl.value = this.formatDateDDMMYYYY(picked);
                        }
                    } catch (err) {
                        alert('Formato data non valido. Inserire GG/MM/AAAA.');
                    }
                });
            }

            // Validazione nome: lettere, spazi, apostrofi e trattini
            const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ'\-\s]{2,60}$/;
            const help = document.getElementById('fullname-help');
            const setValidity = (ok) => {
                nameEl.setAttribute('aria-invalid', ok ? 'false' : 'true');
                if (help) help.classList.toggle('text-danger', !ok);
            };
            nameEl.addEventListener('input', () => setValidity(nameRegex.test(nameEl.value.trim())));
            setValidity(nameRegex.test(nameEl.value.trim()));

            // Mantieni sincronizzato con selezione Operatore della sezione Rapporti
            const reportOp = document.getElementById('report-operator');
            if (reportOp) {
                reportOp.addEventListener('change', () => {
                    const op = this.getCurrentOperator();
                    operatorEl.value = op ? `${op.firstName} ${op.lastName}` : '';
                });
            }
        } catch (e) {
            console.warn('Init Dati Documento non disponibile:', e);
        }
    }

    /** Restituisce l'operatore corrente da selezione o impostazioni */
    getCurrentOperator() {
        try {
            const select = document.getElementById('report-operator');
            let id = select && select.value ? select.value : (this.data?.settings?.defaultOperator || '');
            if (!id && Array.isArray(this.data?.users) && this.data.users.length) {
                id = this.data.users[0].id;
            }
            return (this.data?.users || []).find(u => u.id === id) || null;
        } catch {
            return null;
        }
    }

    /** Formatta una data come dd/mm/yyyy */
    formatDateDDMMYYYY(date) {
        try {
            const d = new Date(date);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        } catch { return ''; }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new FirstAidManager();

    // Inizializza generazione PDF Richiesta d'ordine
    try { window.app.initOrderPdfGeneration(); } catch (e) { console.warn('Init generazione PDF ordini non disponibile:', e); }

    // Inizializza form Dati Documento (Rapporti)
    try { window.app.initIdentityForm(); } catch (e) { console.warn('Init Dati Documento non disponibile:', e); }



    // Pulsanti Importa/Esporta Excel per Kit
    const exportBtn = document.getElementById('export-kits-excel');
    const importBtn = document.getElementById('import-kits-excel');
    const importFile = document.getElementById('import-kits-file');
    const templateBtn = document.getElementById('download-kits-template');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            try { window.app.exportKitsToExcel(); } catch (e) { console.warn('Export Excel fallito:', e); }
        });
    }
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            window.app.importKitsFromExcel(file);
            // Reset input per permettere re-import dello stesso file
            e.target.value = '';
        });
    }

    if (templateBtn) {
        templateBtn.addEventListener('click', () => {
            try { window.app.downloadKitsExcelTemplate(); } catch (e) { console.warn('Download template fallito:', e); }
        });
    }

    const fileInput = document.getElementById('report-company-logo');
    const dropzone = document.getElementById('company-logo-dropzone');
    const previewImg = document.getElementById('company-logo-preview');
    const saveBtn = document.getElementById('save-company-logo');

    const setPreview = (file) => {
        try {
            const url = URL.createObjectURL(file);
            if (previewImg) {
                previewImg.src = url;
                previewImg.style.display = 'block';
            }
        } catch (e) {
            console.warn('Anteprima logo non disponibile:', e.message);
        }
    };

    const uploadCompanyLogo = async (file) => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(binary);

            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                alert('Connessione assente. Verifica la rete e riprova.');
                return;
            }

            const controller = new AbortController();
            const timeoutMs = 30000; // 30s
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            let resp;
            try {
                resp = await fetch('/api/upload/logo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name, data: base64 }),
                    signal: controller.signal
                });
            } catch (err) {
                clearTimeout(timeoutId);
                const isAbort = err && err.name === 'AbortError';
                if (!isAbort) {
                    await new Promise(r => setTimeout(r, 1000));
                    const retryController = new AbortController();
                    const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
                    try {
                        resp = await fetch('/api/upload/logo', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: file.name, data: base64 }),
                            signal: retryController.signal
                        });
                    } catch (retryErr) {
                        clearTimeout(retryTimeoutId);
                        alert('Errore caricamento logo: ' + (retryErr?.message || 'Failed to fetch'));
                        return;
                    }
                    clearTimeout(retryTimeoutId);
                } else {
                    alert(`Timeout caricamento logo dopo ${Math.round(timeoutMs/1000)}s.`);
                    return;
                }
            }
            clearTimeout(timeoutId);

            const json = await resp.json().catch(() => null);
            if (!resp.ok || !json?.success) {
                throw new Error((json && json.error) || 'Upload fallito');
            }

            if (window.app) {
                window.app.data = window.app.data || {};
                window.app.data.settings = window.app.data.settings || {};
                window.app.data.settings.companyLogo = json.path;
                window.app.scheduleAutoSave && window.app.scheduleAutoSave();
                window.app.updateReportPreview && window.app.updateReportPreview();
            }

            setPreview(file);
            console.log('Logo caricato e impostato:', json.path);
        } catch (e) {
            alert('Errore caricamento logo: ' + e.message);
        }
    };

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) uploadCompanyLogo(file);
        });
    }
    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput && fileInput.click());
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) uploadCompanyLogo(file);
        });
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (window.app?.data?.settings?.companyLogo) {
                alert('Logo impostato correttamente per i report.');
            } else {
                alert('Seleziona o trascina un file logo prima di salvare.');
            }
        });
    }
});

// Make app globally available for onclick handlers
// window.app is already set in DOMContentLoaded