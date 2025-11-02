class FirstAidManager {
    constructor() {
        this.data = {
            warehouse: [],
            kits: [],
            materials: [],
            users: [
                { id: 1, name: 'Admin', role: 'admin' },
                { id: 2, name: 'Operatore 1', role: 'operator' },
                { id: 3, name: 'Operatore 2', role: 'operator' }
            ],
            reports: [],
            settings: {
                companyName: 'Azienda',
                notificationDays: 30,
                defaultLocation: 'Sede Principale',
                defaultOperator: 'Admin',
                reportSignature: 'Responsabile Primo Soccorso',
                reportTemplate: 'standard',
                autoPrint: false
            },
            smtpSettings: {
                host: '',
                port: 587,
                secure: false,
                username: '',
                password: ''
            }
        };
        this.autoSaveTimeout = null;
    }

    showModal(title, content, footer = '') {
        const overlay = document.getElementById('modal-overlay');
        const modalTitle = document.getElementById('modal-title');
        const modalContent = document.getElementById('modal-content');
        const modalFooter = document.getElementById('modal-footer');
        
        if (overlay && modalTitle && modalContent && modalFooter) {
            modalTitle.textContent = title;
            modalContent.innerHTML = content;
            modalFooter.innerHTML = footer;
            overlay.classList.add('active');
        }
    }

    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    // Warehouse methods
    showAddWarehouseItemModal() {
        const content = `
            <div class="form-group">
                <label for="warehouse-code">Codice Materiale:</label>
                <input type="text" id="warehouse-code" class="form-control" required>
            </div>
            <div class="form-group">
                <label for="warehouse-name">Nome Prodotto:</label>
                <input type="text" id="warehouse-name" class="form-control">
            </div>
            <div class="form-group">
                <label for="warehouse-quantity">Quantità:</label>
                <input type="number" id="warehouse-quantity" class="form-control" min="1" required>
            </div>
            <div class="form-group">
                <label for="warehouse-expiry">Data Scadenza:</label>
                <input type="date" id="warehouse-expiry" class="form-control" required>
            </div>
            <div class="form-group">
                <label for="warehouse-notes">Note:</label>
                <textarea id="warehouse-notes" class="form-control" rows="3"></textarea>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.addWarehouseItem()">Aggiungi</button>
        `;
        
        this.showModal('Aggiungi Articolo al Magazzino', content, footer);
    }

    addWarehouseItem() {
        const code = document.getElementById('warehouse-code').value;
        const name = (document.getElementById('warehouse-name')?.value || '').trim();
        const quantity = parseInt(document.getElementById('warehouse-quantity').value);
        const expiryDate = document.getElementById('warehouse-expiry').value;
        const notes = document.getElementById('warehouse-notes').value;
        
        if (code && quantity && expiryDate) {
            const newItem = {
                id: this.generateId(),
                code: code,
                name: name || this.getMaterialName(code),
                quantity: quantity,
                expiryDate: expiryDate,
                notes: notes,
                tags: []
            };
            
            this.data.warehouse.push(newItem);
            this.saveData();
            this.renderWarehouse();
            this.closeModal();
        }
    }

    editWarehouseItem(itemId) {
        const item = this.data.warehouse.find(i => i.id === itemId);
        if (!item) return;
        
        const content = `
            <div class="form-group">
                <label for="edit-warehouse-code">Codice Materiale:</label>
                <input type="text" id="edit-warehouse-code" class="form-control" value="${item.code}">
            </div>
            <div class="form-group">
                <label for="edit-warehouse-name">Nome Prodotto:</label>
                <input type="text" id="edit-warehouse-name" class="form-control" value="${item.name || this.getMaterialName(item.code) || ''}">
            </div>
            <div class="form-group">
                <label for="edit-warehouse-quantity">Quantità:</label>
                <input type="number" id="edit-warehouse-quantity" class="form-control" min="1" value="${item.quantity}">
            </div>
            <div class="form-group">
                <label for="edit-warehouse-expiry">Data Scadenza:</label>
                <input type="date" id="edit-warehouse-expiry" class="form-control" value="${item.expiryDate}">
            </div>
            <div class="form-group">
                <label for="edit-warehouse-notes">Note:</label>
                <textarea id="edit-warehouse-notes" class="form-control" rows="3">${item.notes || ''}</textarea>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.applyEditWarehouseItem('${itemId}')">Salva</button>
        `;
        
        this.showModal('Modifica Articolo', content, footer);
    }

    applyEditWarehouseItem(itemId) {
        const item = this.data.warehouse.find(i => i.id === itemId);
        if (!item) return;
        
        const code = document.getElementById('edit-warehouse-code').value.trim();
        const name = (document.getElementById('edit-warehouse-name')?.value || '').trim();
        const quantity = parseInt(document.getElementById('edit-warehouse-quantity').value);
        const expiryDate = document.getElementById('edit-warehouse-expiry').value;
        const notes = document.getElementById('edit-warehouse-notes').value;
        
        if (!code || !quantity || !expiryDate) {
            alert('Inserire codice, quantità e data di scadenza.');
            return;
        }
        
        item.code = code;
        item.name = name || this.getMaterialName(code);
        item.quantity = quantity;
        item.expiryDate = expiryDate;
        item.notes = notes;
        
        this.saveData();
        this.renderWarehouse();
        this.closeModal();
    }

    deleteWarehouseItem(itemId) {
        if (!confirm('Confermi l’eliminazione della riga?')) return;
        const index = this.data.warehouse.findIndex(i => i.id === itemId);
        if (index >= 0) {
            this.data.warehouse.splice(index, 1);
            this.saveData();
            this.renderWarehouse();
        }
    }

    editWarehouseGroup(code, expiryDate) {
        const items = this.data.warehouse.filter(i => i.code === code && (i.expiryDate || '') === (expiryDate || ''));
        if (items.length === 0) return;
        const sample = items[0];
        const content = `
            <div class="form-group">
                <label for="edit-group-code">Codice Materiale:</label>
                <input type="text" id="edit-group-code" class="form-control" value="${sample.code}">
            </div>
            <div class="form-group">
                <label for="edit-group-name">Nome Prodotto:</label>
                <input type="text" id="edit-group-name" class="form-control" value="${sample.name || this.getMaterialName(sample.code) || ''}">
            </div>
            <div class="form-group">
                <label for="edit-group-expiry">Data Scadenza:</label>
                <input type="date" id="edit-group-expiry" class="form-control" value="${sample.expiryDate}">
            </div>
            <div class="form-group">
                <label for="edit-group-notes">Note:</label>
                <textarea id="edit-group-notes" class="form-control" rows="3">${sample.notes || ''}</textarea>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.applyEditWarehouseGroup('${code}','${expiryDate}')">Salva</button>
        `;
        this.showModal('Modifica Articoli del Gruppo', content, footer);
    }

    applyEditWarehouseGroup(code, expiryDate) {
        const newCode = (document.getElementById('edit-group-code')?.value || '').trim();
        const newName = (document.getElementById('edit-group-name')?.value || '').trim();
        const newExpiry = (document.getElementById('edit-group-expiry')?.value || '').trim();
        const newNotes = (document.getElementById('edit-group-notes')?.value || '').trim();
        if (!newCode || !newExpiry) {
            alert('Inserire codice e data di scadenza.');
            return;
        }
        this.data.warehouse.forEach(i => {
            if (i.code === code && (i.expiryDate || '') === (expiryDate || '')) {
                i.code = newCode;
                i.name = newName || this.getMaterialName(newCode);
                i.expiryDate = newExpiry;
                i.notes = newNotes;
            }
        });
        this.saveData();
        this.renderWarehouse();
        this.closeModal();
    }

    deleteWarehouseGroup(code, expiryDate) {
        if (!confirm('Confermi l’eliminazione della riga?')) return;
        this.data.warehouse = this.data.warehouse.filter(i => !(i.code === code && (i.expiryDate || '') === (expiryDate || '')));
        this.saveData();
        this.renderWarehouse();
    }

    // Kit methods
    showAddKitModal() {
        const content = `
            <div class="form-group">
                <label for="kit-name">Nome Kit:</label>
                <input type="text" id="kit-name" class="form-control" required>
            </div>
            <div class="form-group">
                <label for="kit-location">Ubicazione:</label>
                <input type="text" id="kit-location" class="form-control" required>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.addNewKit()">Crea Kit</button>
        `;
        
        this.showModal('Nuovo Kit', content, footer);
    }

    addNewKit() {
        const name = document.getElementById('kit-name').value;
        const location = document.getElementById('kit-location').value;
        
        if (name && location) {
            const newKit = {
                id: this.generateId(),
                name: name,
                location: location,
                items: (this.kitTemplate || []).map(t => ({
                    code: t.code,
                    quantity: 0,
                    minQuantity: t.minQuantity,
                    unit: t.unit,
                    expiryDates: []
                }))
            };
            
            this.data.kits.push(newKit);
            this.saveData();
            this.renderKits();
            this.closeModal();
        }
    }

    // Apre un modal per modificare Nome (h3) e Ubicazione (p)
    editKit(kitId) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        const content = `
            <div class="form-group">
                <label for="edit-kit-name">Nome Kit:</label>
                <input type="text" id="edit-kit-name" class="form-control" value="${kit.name}" required>
            </div>
            <div class="form-group">
                <label for="edit-kit-location">Ubicazione:</label>
                <input type="text" id="edit-kit-location" class="form-control" value="${kit.location}" required>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.updateKitDetails('${kitId}')">Salva Modifiche</button>
            <button class="btn btn-danger" onclick="app.deleteKit('${kitId}')">Elimina Kit</button>
        `;
        
        this.showModal('Modifica Kit', content, footer);
    }

    // Applica le modifiche a Nome e Ubicazione del kit
    updateKitDetails(kitId) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        const newName = (document.getElementById('edit-kit-name')?.value || '').trim();
        const newLocation = (document.getElementById('edit-kit-location')?.value || '').trim();
        
        if (!newName || !newLocation) {
            alert('Inserire sia il nome del kit che l\'ubicazione.');
            return;
        }
        
        // Facoltativo: avvisa se esiste già un kit con lo stesso nome
        const duplicate = this.data.kits.some(k => k.id !== kitId && (k.name || '').toLowerCase() === newName.toLowerCase());
        if (duplicate) {
            const proceed = confirm('Esiste già un kit con questo nome. Vuoi procedere comunque?');
            if (!proceed) return;
        }
        
        kit.name = newName;
        kit.location = newLocation;
        
        this.saveData();
        this.renderKits();
        this.closeModal();
    }

    deleteKit(kitId) {
        if (!confirm('Confermi l\'eliminazione del kit?')) return;
        const idx = this.data.kits.findIndex(k => k.id === kitId);
        if (idx >= 0) {
            this.data.kits.splice(idx, 1);
            this.saveData();
            this.renderKits();
            this.closeModal();
        }
    }

    // Kit item management with max capacity validation
    showAddKitItemModal(kitId) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        // Check if kit is already at max capacity
        const maxCapacity = this.data.settings.maxKitCapacity || 50;
        const totalItems = kit.items.reduce((sum, item) => sum + item.quantity, 0);
        
        if (totalItems >= maxCapacity) {
            alert(`Il kit "${kit.name}" ha raggiunto il limite massimo di ${maxCapacity} articoli. Non è possibile aggiungere altri articoli.`);
            return;
        }
        
        const content = `
            <div class="form-group">
                <label for="kit-item-code">Codice Materiale:</label>
                <input type="text" id="kit-item-code" class="form-control" required>
            </div>
            <div class="form-group">
                <label for="kit-item-quantity">Quantità:</label>
                <input type="number" id="kit-item-quantity" class="form-control" min="1" max="${maxCapacity - totalItems}" value="1" required>
                
            </div>
            <div class="form-group">
                <label for="kit-item-notes">Note:</label>
                <textarea id="kit-item-notes" class="form-control" rows="2"></textarea>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="app.closeModal()">Annulla</button>
            <button class="btn btn-primary" onclick="app.addKitItem('${kitId}')">Aggiungi Articolo</button>
        `;
        
        this.showModal(`Aggiungi Articolo a ${kit.name}`, content, footer);
    }

    addKitItem(kitId) {
        const code = document.getElementById('kit-item-code').value.trim();
        const quantity = parseInt(document.getElementById('kit-item-quantity').value);
        const notes = document.getElementById('kit-item-notes').value.trim();
        
        if (!code || !quantity) {
            alert('Si prega di inserire il codice materiale e la quantità.');
            return;
        }
        
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        
        // Check if item already exists in kit
        const existingItem = kit.items.find(item => item.code === code);
        if (existingItem) {
            alert('Questo materiale è già presente nel kit. Usa i pulsanti +/- per modificare la quantità.');
            return;
        }
        
        // Validate max capacity
        const maxCapacity = this.data.settings.maxKitCapacity || 50;
        const totalItems = kit.items.reduce((sum, item) => sum + item.quantity, 0);
        
        if (totalItems + quantity > maxCapacity) {
            const availableSpace = maxCapacity - totalItems;
            if (availableSpace > 0) {
                alert(`Puoi aggiungere solo ${availableSpace} articoli per non superare il limite massimo di ${maxCapacity}.`);
                return;
            } else {
                alert(`Limite massimo cassetta raggiunto (${maxCapacity} articoli).`);
                return;
            }
        }
        
        const newItem = {
            code: code,
            quantity: quantity,
            minQuantity: 1,
            notes: notes
        };
        
        kit.items.push(newItem);
        this.saveData();
        this.renderKits();
        this.closeModal();
        
        alert(`Articolo "${code}" aggiunto al kit "${kit.name}" con successo!`);
    }

    // Prelievo FIFO dal magazzino verso il kit e rispetto del limite per voce
    addKitUnitFromWarehouse(kitId, itemCode) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        const item = kit.items.find(i => i.code === itemCode);
        if (!item) return;

        const maxCapacity = this.data.settings.maxKitCapacity || 50;
        const totalItems = kit.items.reduce((sum, it) => sum + (it.quantity || 0), 0);
        if (totalItems >= maxCapacity) {
            alert(`Limite massimo cassetta raggiunto (${maxCapacity} articoli).`);
            return;
        }

        // Rispetta eventuale quantità massima per la voce (se definita)
        const maxItemQty = Number.isFinite(item.maxQuantity) ? item.maxQuantity : Infinity;
        if ((item.quantity || 0) >= maxItemQty) {
            alert('Hai raggiunto la quantità massima per questa voce.');
            return;
        }

        // Trova la riga di magazzino disponibile (non scaduta) con scadenza più vicina (FIFO)
        const itemName = (this.getMaterialName(itemCode) || '').trim().toLowerCase();
        const candidates = this.data.warehouse
            .filter(w => w.quantity > 0 && !this.isExpired(w.expiryDate))
            .filter(w => {
                if (w.code === itemCode) return true;
                const wName = (w.name || this.getMaterialName(w.code) || '').trim().toLowerCase();
                return itemName && wName && wName === itemName;
            })
            .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

        if (candidates.length === 0) {
            alert('Nessun articolo disponibile in magazzino per questo materiale.');
            return;
        }

        const source = candidates[0];
        source.quantity -= 1;
        if (source.quantity <= 0) {
            const idx = this.data.warehouse.findIndex(w => w.id === source.id);
            if (idx >= 0) this.data.warehouse.splice(idx, 1);
        }

        if (!Array.isArray(item.expiryDates)) item.expiryDates = [];
        item.expiryDates.push(source.expiryDate);
        item.quantity = item.expiryDates.length;

        this.saveData();
        this.renderWarehouse();
        this.renderKits();
    }

    // Rientro di una unità dal kit al magazzino (ripristino)
    returnKitUnitToWarehouse(kitId, itemCode) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        const item = kit.items.find(i => i.code === itemCode);
        if (!item) return;

        if (!Array.isArray(item.expiryDates) || item.expiryDates.length === 0) {
            alert('Nessuna unità da rientrare a magazzino.');
            return;
        }

        // Prendi la scadenza più vecchia per coerenza
        const date = item.expiryDates.shift();
        item.quantity = item.expiryDates.length;

        const existing = this.data.warehouse.find(w => w.code === itemCode && w.expiryDate === date);
        if (existing) {
            existing.quantity += 1;
            if (!existing.name) existing.name = this.getMaterialName(itemCode);
        } else {
            this.data.warehouse.push({
                id: this.generateId(),
                code: itemCode,
                name: this.getMaterialName(itemCode),
                quantity: 1,
                expiryDate: date,
                notes: `Rientro dal kit ${kit.name}`
            });
        }

        this.saveData();
        this.renderWarehouse();
        this.renderKits();
    }

    // Conferma di consumo, poi applicazione
    confirmConsumeKitUnit(kitId, itemCode, expiryDate) {
        const label = this.getMaterialName(itemCode) || itemCode;
        const msg = `Confermi il consumo di 1 unità di \"${label}\" (scadenza ${this.formatDate(expiryDate)})?`;
        if (!confirm(msg)) return;
        this.applyConsumeKitUnit(kitId, itemCode, expiryDate);
    }

    // Azione di consumo effettiva (senza conferma)
    applyConsumeKitUnit(kitId, itemCode, expiryDate) {
        const kit = this.data.kits.find(k => k.id === kitId);
        if (!kit) return;
        const item = kit.items.find(i => i.code === itemCode);
        if (!item) return;

        if (!Array.isArray(item.expiryDates)) item.expiryDates = [];
        const idx = item.expiryDates.indexOf(expiryDate);
        if (idx === -1) return;

        item.expiryDates.splice(idx, 1);
        item.quantity = item.expiryDates.length;

        this.saveData();
        this.renderKits();
    }

    // Settings methods
    switchSettingsTab(tabName) {
        // Update active tab
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.tab === tabName) {
                tab.classList.add('active');
            }
        });
        
        // Create and show panel content
        this.createSettingsPanel(tabName);
    }

    createSettingsPanel(tabName) {
        const panel = document.getElementById('settings-panel');
        if (!panel) return;
        
        switch(tabName) {
            case 'general':
                panel.innerHTML = this.getGeneralSettingsHTML();
                break;
            case 'smtp':
                panel.innerHTML = this.getSMTPSettingsHTML();
                break;
            case 'materials':
                panel.innerHTML = this.getMaterialsSettingsHTML();
                break;
            case 'users':
                panel.innerHTML = this.getUsersSettingsHTML();
                break;
            case 'reports':
                panel.innerHTML = this.getReportsSettingsHTML();
                break;
        }
        
        this.setupSettingsPanelListeners(tabName, panel);
    }

    getGeneralSettingsHTML() {
        return `
            <div class="settings-content">
                <div class="settings-section">
                    <h3>Impostazioni Generali</h3>
                    <div class="form-row">
                        <label for="company-name">Nome Azienda:</label>
                        <input type="text" id="company-name" class="form-control" value="${settings.companyName || ''}">
                    </div>
                    <div class="form-row">
                        <label for="notification-days">Giorni preavviso scadenza:</label>
                        <input type="number" id="notification-days" class="form-control" value="${settings.notificationDays || 30}" min="1" max="365">
                    </div>
                    <div class="form-row">
                        <label for="default-location">Ubicazione predefinita:</label>
                        <input type="text" id="default-location" class="form-control" value="${settings.defaultLocation || ''}">
                    </div>
                    <div class="form-row">
                        <button id="save-general" class="btn btn-success">Salva Impostazioni</button>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Gestione Dati</h3>
                    <div class="form-row">
                        <button id="export-data" class="btn btn-info">Esporta Dati</button>
                        <input type="file" id="import-data" accept=".json" style="display: none;">
                        <button id="import-data-btn" class="btn btn-warning">Importa Dati</button>
                        <button id="clear-data" class="btn btn-danger">Cancella Tutti i Dati</button>
                    </div>
                </div>
            </div>
        `;
    }

    getSMTPSettingsHTML() {
        return `<div class="settings-content"><h3>Configurazione SMTP</h3><p>Configurazione email in sviluppo...</p></div>`;
    }

    getMaterialsSettingsHTML() {
        return `<div class="settings-content"><h3>Gestione Materiali</h3><p>Gestione materiali in sviluppo...</p></div>`;
    }

    getUsersSettingsHTML() {
        return `<div class="settings-content"><h3>Gestione Utenti</h3><p>Gestione utenti in sviluppo...</p></div>`;
    }

    getReportsSettingsHTML() {
        return `<div class="settings-content"><h3>Impostazioni Rapporti</h3><p>Impostazioni rapporti in sviluppo...</p></div>`;
    }

    setupSettingsPanelListeners(tabName, panel) {
        if (tabName === 'general') {
            const saveGeneralBtn = panel.querySelector('#save-general');
            if (saveGeneralBtn) {
                addTempListener(saveGeneralBtn, 'click', () => this.saveGeneralSettings());
            }
            
            const clearBtn = panel.querySelector('#clear-data');
            if (clearBtn) {
                addTempListener(clearBtn, 'click', () => this.clearAllData());
            }
        }
    }

    saveGeneralSettings() {
        const companyName = document.getElementById('company-name').value;
        const notificationDays = parseInt(document.getElementById('notification-days').value);
        const defaultLocation = document.getElementById('default-location').value;
        
        this.data.settings.companyName = companyName;
        this.data.settings.notificationDays = notificationDays;
        this.data.settings.defaultLocation = defaultLocation;
        
        this.saveData();
        alert('Impostazioni salvate con successo!');
    }

    clearAllData() {
        if (confirm('Sei sicuro di voler cancellare tutti i dati? Questa operazione non può essere annullata.')) {
            this.data = {
                warehouse: [],
                kits: [],
                materials: [],
                users: [
                    { id: 1, name: 'Admin', role: 'admin' },
                    { id: 2, name: 'Operatore 1', role: 'operator' },
                    { id: 3, name: 'Operatore 2', role: 'operator' }
                ],
                reports: [],
                settings: {
                    companyName: 'Azienda',
                    notificationDays: 30,
                    defaultLocation: 'Sede Principale',
                    defaultOperator: 'Admin',
                    reportSignature: 'Responsabile Primo Soccorso',
                    reportTemplate: 'standard',
                    autoPrint: false
                },
                smtpSettings: {
                    host: '',
                    port: 587,
                    secure: false,
                    username: '',
                    password: ''
                }
            };
            
            // Pulisci anche il localStorage
            localStorage.removeItem('firstAidManagerData');
            
            this.saveData();
            this.renderAllSections();
            alert('Tutti i dati sono stati cancellati.');
        }
    }

    // Email methods (placeholder)
    async sendExpiringItemsEmail() {
        alert('Funzione email in sviluppo');
    }

    async sendZeroQuantityEmail() {
        alert('Funzione email in sviluppo');
    }

    // Report methods (placeholder)
    async generateReport() {
        alert('Generazione rapporti in sviluppo');
    }

    viewReportDetails(reportId) {
        alert('Visualizzazione dettagli rapporto in sviluppo');
    }

    deleteReport(reportId) {
        if (confirm('Sei sicuro di voler eliminare questo rapporto?')) {
            this.data.reports = this.data.reports.filter(r => r.id !== reportId);
            this.saveData();
            this.renderReports();
        }
    }

    // Data persistence
    saveData() {
        localStorage.setItem('firstAidManagerData', JSON.stringify(this.data));
    }

    loadData() {
        const savedData = localStorage.getItem('firstAidManagerData');
        if (savedData) {
            try {
                const parsedData = JSON.parse(savedData);
                // Merge data carefully, ensuring materials remains an array
                this.data = { 
                    ...this.data, 
                    ...parsedData,
                    materials: Array.isArray(parsedData.materials) ? parsedData.materials : this.data.materials
                };
            } catch (error) {
                console.error('Error loading saved data:', error);
            }
        }
    }

    scheduleAutoSave() {
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => {
            this.saveData();
        }, 1000);
    }
}

// Initialize the application
let app;
document.addEventListener('DOMContentLoaded', () => {
    console.log('=== INIZIALIZZAZIONE APP ===');
    app = new FirstAidManager();
    window.app = app; // rende l'istanza accessibile ai listener inline e ai mount
    console.log('=== APP INIZIALIZZATA ===');
});


// Utility per eseguire inizializzazioni globali una sola volta
const once = (fn) => {
    let done = false;
    return (...args) => { 
        if (done) return; 
        done = true; 
        return fn(...args); 
    };
};

// Funzione per garantire che gli stili scopizzati siano caricati
const ensureSettingsStyles = once(() => {
    const styleId = "settings-scoped-styles";
    let el = document.getElementById(styleId);
    if (el) return el;
    
    el = document.createElement("style");
    el.id = styleId;
    el.textContent = `
        /* Stili aggiuntivi per prevenire reiniezioni */
        .view:not(#view-settings) .settings-panel,
        .view:not(#view-settings) .settings-tabs,
        .view:not(#view-settings) .settings-tab,
        .view:not(#view-settings) .settings-content,
        .view:not(#view-settings) .settings-section {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
        }
        
        /* Stili specifici per la view settings */
        #view-settings .settings-view {
            animation: fadeIn 0.3s ease-in-out;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(el);
    return el;
});

// Inizializzazione globale (eseguita una sola volta)
const initGlobal = once(() => {
    // Setup globale minimo se necessario
    console.log('✓ Global initialization completed');
});

// ===== Router semplificato: mostra/nasconde sezioni statiche =====
function showSection(id) {
    // Mostra solo la sezione richiesta senza rimontare componenti
    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.toggle('active', sec.id === id);
    });
    // Aggiorna stato attivo dei tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-section') === id);
    });
}

// Binding dei bottoni di navigazione al router
document.addEventListener('DOMContentLoaded', () => {
    // Inizializzazione globale
    initGlobal();
    
    // Bind dei tab di navigazione
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const section = tab.getAttribute('data-section');
            if (section) {
                showSection(section);
            }
        });
    });
    
    // Carica la sezione iniziale (overall)
    showSection('overall');

    // Ripristino grafica originale: rimosse evidenziazioni e popolamento dashboard
    // (nessuna modifica visiva aggiuntiva applicata qui)

});