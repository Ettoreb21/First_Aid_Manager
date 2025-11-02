// services/inventoryService.js
// Estrae dati reali da Excel e costruisce tabelle per email

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const MAGAZZINO_XLSX = path.join(__dirname, '..', 'Appunti', 'Dati', 'Contenuto_magazzino.xlsx');
const CASSETTE_XLSX = path.join(__dirname, '..', 'Appunti', 'Dati', 'Contenuto_cassette.xlsx');

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseExpiry(value) {
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

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString('it-IT');
  } catch {
    return String(dateString);
  }
}

function loadExcelData() {
  const materialsMap = new Map();
  const addMaterial = (code, name, tag) => {
    if (!code) code = slugify(name);
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

  const warehouse = [];

  // Contenuto_magazzino.xlsx
  if (fs.existsSync(MAGAZZINO_XLSX)) {
    const wb = XLSX.readFile(MAGAZZINO_XLSX);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    rows.forEach(row => {
      const name = (row.DISPOSITIVO || '').toString().trim();
      let code = (row.Codice || '').toString().trim();
      if (!code) code = slugify(name);
      addMaterial(code, name, 'magazzino');
      const quantity = parseInt(row.QNT, 10);
      const expiryDate = parseExpiry(row.SCADENZA);
      const notes = (row.NOTE || '').toString();
      warehouse.push({ code, quantity: isNaN(quantity) ? 0 : quantity, expiryDate, notes });
    });
  }

  // Contenuto_cassette.xlsx (solo materiali)
  if (fs.existsSync(CASSETTE_XLSX)) {
    const wb = XLSX.readFile(CASSETTE_XLSX);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    rows.forEach(row => {
      const name = (row.Materiale || '').toString().trim();
      let code = (row.Codice || '').toString().trim();
      if (!code) code = slugify(name);
      addMaterial(code, name, 'kit');
    });
  }

  const materials = Array.from(materialsMap.values());
  return { materials, warehouse };
}

function getExpiringItemsForMonth(month, year) {
  const { warehouse, materials } = loadExcelData();
  const items = [];
  warehouse.forEach(item => {
    const expiryDate = new Date(item.expiryDate);
    if (expiryDate.getMonth() === month && expiryDate.getFullYear() === year) {
      const materialName = (materials.find(m => m.code === item.code)?.name) || item.code;
      items.push({ code: item.code, name: materialName, quantity: item.quantity, expiryDate: formatDate(item.expiryDate) });
    }
  });
  return items;
}

function getZeroQuantityItemsFromWarehouse() {
  const { warehouse, materials } = loadExcelData();
  const items = [];
  // Materiali senza voce magazzino o con QNT=0
  materials.forEach(material => {
    const wh = warehouse.find(w => w.code === material.code);
    if (!wh || wh.quantity === 0) {
      items.push({ code: material.code, name: material.name, quantity: 0, expiryDate: '' });
    }
  });
  return items;
}

function buildItemsTable(items) {
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

module.exports = {
  loadExcelData,
  getExpiringItemsForMonth,
  getZeroQuantityItemsFromWarehouse,
  buildItemsTable
};