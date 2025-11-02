const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function ptFromPx(px) {
  return Math.round(px * 0.75);
}

function mmToPt(mm) {
  return mm * 72 / 25.4; // 1 inch = 25.4 mm, 1 pt = 1/72 inch
}

function formatDateIT(dateStr) {
  const parts = (dateStr || '').split('/');
  if (parts.length === 3) return `${parts[0]}/${parts[1]}/${parts[2]}`;
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function cleanText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s+/g, ' ')           // Rimuovi spazi multipli
    .replace(/\s+([.,;:!?])/g, '$1') // Rimuovi spazi prima della punteggiatura
    .trim();                        // Rimuovi spazi all'inizio e alla fine
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function generateOrderPDF({ city, date, operatorName, operatorId, companyName, companyAddress, items, logoPath, signaturePath, operatorRole, signedAt, signature, signatureAlgo, signatureId, verificationUrl }) {
  if (!city || !operatorName || !Array.isArray(items)) {
    throw new Error('Parametri mancanti: city, operatorName, items');
  }
  if (items.length === 0) {
    throw new Error('Nessun articolo selezionato');
  }

  const outputDir = path.join('output', 'ordini');
  ensureDir(outputDir);
  const ts = new Date();
  const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
  const filename = `richiesta_ordine_${stamp}.pdf`;
  const outputPath = path.join(outputDir, filename);

  // Margini 20mm (~2cm) su tutti i lati per A4
  const doc = new PDFDocument({ size: 'A4', margins: { top: mmToPt(20), left: mmToPt(20), bottom: mmToPt(20), right: mmToPt(20) } });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // Impostazioni interlinea globale (range richiesto: 1.15–1.5)
  const LINE_HEIGHT_RATIO = 1.35; // bilanciata per leggibilità e contenimento in A4
  const gapFor = (fontSize) => Math.round(fontSize * (LINE_HEIGHT_RATIO - 1));
  // Interlinea firma: aumento di almeno +30% rispetto al valore corrente
  const SIG_GAP_MULTIPLIER = 1.3; // +30%
  const sigGapFor = (fontSize) => Math.round(gapFor(fontSize) * SIG_GAP_MULTIPLIER);
  const sigLineHeight = (fontSize) => fontSize + sigGapFor(fontSize);

  // Header: logo left (max 150x50 px), title center, city+date right
  const maxLogoW = ptFromPx(150);
  const maxLogoH = ptFromPx(50);
  const pageWidth = doc.page.width;
  const marginLeft = doc.page.margins.left;
  const marginTop = doc.page.margins.top;
  const marginRight = doc.page.margins.right;

  let headerY = marginTop;
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, marginLeft, headerY, { width: maxLogoW, height: maxLogoH, fit: [maxLogoW, maxLogoH] });
    } catch (_) {}
  }

  const title = 'Richiesta d\'ordine';
  // Titolo: leggibile e centrato
  doc.font('Helvetica-Bold').fontSize(18);
  const titleW = doc.widthOfString(title);
  const titleX = (pageWidth - titleW) / 2;
  doc.text(title, titleX, headerY, { lineGap: gapFor(18) });

  // Normalize city name: replace 'Warehouse' with 'Conselve' while preserving style/position
  const displayCity = (city && city.trim().toLowerCase() === 'warehouse') ? 'Conselve' : city;
  const rightText = `${displayCity}, ${formatDateIT(date)}`;
  // Testo header lato destro
  doc.font('Helvetica').fontSize(11);
  const rightW = doc.widthOfString(rightText);
  const rightX = pageWidth - marginRight - rightW;
  doc.text(rightText, rightX, headerY, { lineGap: gapFor(10) });
  // Calcolo robusto del fondo dell'intestazione: misura reale di titolo e testo destro
  doc.font('Helvetica-Bold').fontSize(18);
  const titleMeasuredH = doc.heightOfString(title, { width: Math.max(titleW, 1), lineGap: gapFor(18) });
  doc.font('Helvetica').fontSize(11);
  const rightMeasuredH = doc.heightOfString(rightText, { width: Math.max(rightW, 1), lineGap: gapFor(11) });
  const logoUsedH = maxLogoH; // upper bound per sicurezza
  const headerBottomY = headerY + Math.max(logoUsedH, titleMeasuredH, rightMeasuredH);

  // Dati azienda (se disponibili) sotto l'intestazione
  let afterHeaderY = headerBottomY + mmToPt(6);
  if (companyName) {
    const cn = cleanText(companyName);
    doc.font('Helvetica-Bold').fontSize(12).text(`Azienda: ${cn}`, marginLeft, afterHeaderY, { lineGap: gapFor(12) });
    afterHeaderY += doc.heightOfString(`Azienda: ${cn}`, { width: pageWidth - marginLeft - marginRight, lineGap: gapFor(12) }) + mmToPt(2);
  }
  if (companyAddress) {
    const ca = cleanText(companyAddress);
    doc.font('Helvetica').fontSize(11).text(ca, marginLeft, afterHeaderY, { lineGap: gapFor(11) });
    afterHeaderY += doc.heightOfString(ca, { width: pageWidth - marginLeft - marginRight, lineGap: gapFor(11) }) + mmToPt(2);
  }

  // Offset aggiuntivo sotto l'intestazione: ~2.6 cm per maggiore separazione
  const TABLE_TOP_OFFSET_MM = 26;
  const tableStartY = Math.max(afterHeaderY + mmToPt(8), headerBottomY + mmToPt(TABLE_TOP_OFFSET_MM));
  doc.y = tableStartY;

  // Tabella articoli
  const headers = ['Codice', 'Nome', 'Ubicazione', 'Qnt.', 'Scad.', 'Tipo'];
  // Larghezze di base (pt). Verranno scalate per rientrare nell'area A4 disponibile
  let colWidths = [70, 200, 110, 60, 70, 70]; // Ottimizzate per testi lunghi
  const tableFontSize = 11; // tra 10 e 12 pt per leggibilità
  const cellPadding = mmToPt(3); // rientro uniforme interno celle (~3mm)
  let startX = marginLeft;
  // Assicurati che la somma delle colonne rientri nell'area utile (A4 - margini)
  const availableWidth = pageWidth - marginLeft - marginRight;
  const totalCols = colWidths.reduce((a, b) => a + b, 0);
  if (totalCols > availableWidth) {
    const scale = availableWidth / totalCols;
    // Evita arrotondamenti aggressivi: mantieni decimali per centratura precisa
    colWidths = colWidths.map(w => w * scale);
  }
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  // Centra orizzontalmente la tabella nell'area utile
  startX = marginLeft + Math.max(0, (availableWidth - tableWidth) / 2);
  let y = doc.y;

  // Parametri di spaziatura: micro-aumenti SOLO per la tabella
  const rowExtra = 6;      // spaziatura extra bilanciata
  const minRowHeight = 20; // altezza minima riga
  const headerSpacing = mmToPt(18); // spazio bilanciato sotto l'intestazione

  // La firma sarà su una pagina dedicata: nessuna riserva sul fondo della pagina della tabella
  const reservedBottom = 0;

  const sumUntil = (arr, idx) => arr.slice(0, idx).reduce((a, b) => a + b, 0);
  const drawHeader = () => {
    // Sfondo header per maggiore leggibilità
    doc.save();
    doc.rect(startX, y, tableWidth, mmToPt(10)).fill('#f1f3f5');
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(tableFontSize);
    headers.forEach((h, i) => {
      const align = i === 3 ? 'right' : (i === 4 || i === 5 ? 'center' : 'left');
      const cleanHeader = cleanText(h);
      doc.text(cleanHeader, startX + sumUntil(colWidths, i) + cellPadding, y + mmToPt(2), { 
        width: colWidths[i] - 2 * cellPadding, 
        lineGap: gapFor(tableFontSize), 
        align,
        wordSpacing: 0,
        characterSpacing: 0
      });
    });
    y += headerSpacing; // header height + spacing
    doc.font('Helvetica').fontSize(tableFontSize);
  };

  drawHeader();

  items.forEach((it, idx) => {
    const row = [
      cleanText(it.code || ''),
      cleanText(it.name || ''),
      cleanText(it.location || ''),
      String(it.reorderQty || 0),
      cleanText(it.expiryDate || ''),
      cleanText(it.type || '')
    ];

    // Calcola altezza riga in base al contenuto più alto (con lineGap per maggiore leggibilità)
    const cellHeights = row.map((cell, i) => doc.heightOfString(String(cell), { width: colWidths[i] - 2 * cellPadding, lineGap: gapFor(tableFontSize) }));
    const rowHeight = Math.max(minRowHeight, ...cellHeights) + rowExtra; // altezza minima + extra spacing

    // Se lo spazio rimanente non basta (considera area firma), vai a pagina nuova e ridisegna header
    const usableBottomY = doc.page.height - doc.page.margins.bottom - reservedBottom;
    if (y + rowHeight > usableBottomY) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }

    // Sfondo righe alternate per migliore leggibilità
    if (idx % 2 === 1) {
      doc.save();
      doc.rect(startX, y, tableWidth, rowHeight).fill('#fafafa');
      doc.restore();
    }
    // Disegna le celle della riga
    row.forEach((cell, i) => {
      const align = i === 3 ? 'right' : (i === 4 || i === 5 ? 'center' : 'left');
      const cleanCell = cleanText(String(cell));
      doc.text(cleanCell, startX + sumUntil(colWidths, i) + cellPadding, y, { 
        width: colWidths[i] - 2 * cellPadding, 
        lineGap: gapFor(tableFontSize), 
        align,
        wordSpacing: 0,  // Controllo spaziatura tra parole
        characterSpacing: 0  // Controllo spaziatura tra caratteri
      });
    });

    y += rowHeight;
  });

  // Sezione firma immediatamente sotto la tabella
  const usableBottomY = doc.page.height - doc.page.margins.bottom; // nessuna riserva sul fondo
  const sigMaxW = ptFromPx(180);
  const sigMaxH = ptFromPx(90);
  const sigPadding = mmToPt(4);
  const labelText = 'Firma digitale operatore';
  const labelFontSize = 11;
  doc.font('Helvetica-Bold').fontSize(labelFontSize);
  const labelHeight = doc.heightOfString(labelText, { width: sigMaxW, lineGap: sigGapFor(labelFontSize) });
  let sigYStart = y + mmToPt(6);
  const neededHeight = labelHeight + mmToPt(2) + sigMaxH + sigPadding * 2;

  // Se non c'è spazio sufficiente sotto la tabella, vai a una nuova pagina
  if (sigYStart + neededHeight > usableBottomY) {
    doc.addPage();
    sigYStart = doc.page.margins.top;
  }

  const sigX = startX;
  // Label sopra la firma
  doc.font('Helvetica-Bold').fontSize(labelFontSize).text(labelText, sigX, sigYStart, { width: sigMaxW, align: 'left', lineGap: sigGapFor(labelFontSize) });
  const imgY = sigYStart + labelHeight + mmToPt(2);
  // Cornice firma
  doc.rect(sigX, imgY, sigMaxW, sigMaxH).stroke();
  // Immagine firma PNG con proporzioni mantenute (fit)
  if (signaturePath && fs.existsSync(signaturePath)) {
    try {
      doc.image(signaturePath, sigX + sigPadding, imgY + sigPadding, { fit: [sigMaxW - sigPadding * 2, sigMaxH - sigPadding * 2] });
    } catch (_) {}
  } else {
    doc.font('Helvetica-Oblique').fontSize(10).text('Firma non disponibile', sigX, imgY + (sigMaxH / 2) - 6, { width: sigMaxW, align: 'center', lineGap: sigGapFor(10) });
  }

  // Conclude il documento senza aggiungere altre pagine
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { outputPath, outputUrl: `/${outputPath.replace(/\\/g, '/')}` };
}

module.exports = { generateOrderPDF };