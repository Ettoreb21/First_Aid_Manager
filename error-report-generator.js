// Generatore PDF per report diagnostico ERRORE 500
// Usa Puppeteer + Handlebars con header/footer e margini

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const PDFDocument = require('pdfkit');

class Error500ReportGenerator {
  constructor() {
    this.templatePath = path.join(__dirname, 'templates', 'report_errore_500.html');
    this.settingsPath = path.join(__dirname, 'config', 'settings.json');
    this.outputDir = path.join(__dirname, 'reports', 'output');
  }

  async loadSettings() {
    try {
      const content = await fsp.readFile(this.settingsPath, 'utf8');
      return JSON.parse(content);
    } catch (_) {
      return {
        report: {
          revisione: 'Rev.05',
          logo_path: 'assets/logo.png'
        },
        company: {
          default_location: 'Sede Principale'
        }
      };
    }
  }

  formatLongItalianDate(date = new Date()) {
    return date.toLocaleDateString('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }

  getDateYYYYMMDD(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  async generate(input) {
    const settings = await this.loadSettings();

    const revision = input?.revisione?.versione || settings.report?.revisione || 'Rev.05';
    const operatorName = input?.user?.nome_operatore || 'Operatore';
    const logoPathCandidate = input?.company?.logo_path || settings.report?.logo_path || null;

    const longDate = this.formatLongItalianDate(new Date());

    const data = input?.report?.data || {};

    // Assicura cartella output
    await fsp.mkdir(this.outputDir, { recursive: true });

    // Carica e compila template
    const templateHtml = await fsp.readFile(this.templatePath, 'utf8');
    const compile = Handlebars.compile(templateHtml);

    const templateData = {
      REVISIONE: revision,
      DATA_LUNGA: longDate,
      OPERATORE: operatorName,
      LOGO_PLACEHOLDER: 'LOGO AZIENDA',
      DESCRIZIONE: data.descrizione || '',
      ANALISI: data.analisi || '',
      LOG_PRINCIPALI: Array.isArray(data.logs) ? data.logs : [],
      CAUSA_RADICE: data.causa || '',
      SOLUZIONE: data.soluzione || '',
      TEST_VERIFICA: data.test || '',
      STATO_FINALE: data.stato || ''
    };

    const html = compile(templateData);

    // Header con logo e titolo
    let logoExists = false;
    let finalLogoPath = null;
    if (logoPathCandidate) {
      const fullLogoPath = path.isAbsolute(logoPathCandidate)
        ? logoPathCandidate
        : path.join(__dirname, logoPathCandidate);
      if (fs.existsSync(fullLogoPath)) {
        logoExists = true;
        finalLogoPath = fullLogoPath;
      }
    }

    const headerTemplate = `
      <style>
        .hdr { font-family: Arial, Helvetica, sans-serif; width: 100%; padding: 0 20mm; }
        .hdr-row { display: flex; align-items: center; justify-content: space-between; }
        .hdr-logo { width: 30mm; height: 30mm; border: 1px solid #999; display: flex; align-items: center; justify-content: center; }
        .hdr-logo img { max-width: 30mm; max-height: 30mm; object-fit: contain; }
        .hdr-title { text-align: right; font-family: Arial, Helvetica, sans-serif; font-size: 14pt; font-weight: bold; text-transform: uppercase; }
        .hdr-divider { border-bottom: 1px solid #999; margin-top: 3mm; }
      </style>
      <div class="hdr">
        <div class="hdr-row">
          ${logoExists ? `<div class="hdr-logo"><img src="file://${finalLogoPath}" /></div>` : `<div class="hdr-logo">LOGO AZIENDA</div>`}
          <div class="hdr-title">CHECK VERIFICA ERRORE 500</div>
        </div>
        <div class="hdr-divider"></div>
      </div>
    `;

    const footerTemplate = `
      <style>
        .ftr { font-family: Arial, Helvetica, sans-serif; width: 100%; padding: 0 20mm; color: #555; font-size: 8pt; }
      </style>
      <div class="ftr">
        <div style="text-align:center;">Documento generato automaticamente | Pagina <span class="pageNumber"></span> di <span class="totalPages"></span></div>
      </div>
    `;

    const dateStr = this.getDateYYYYMMDD(new Date());
    const fileName = `report_errore500_${dateStr}.pdf`;
    const outputPath = path.join(this.outputDir, fileName);

    // Prova con Puppeteer, altrimenti fallback PDFKit
    let browser;
    try {
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (launchErr) {
      await this._generateFallbackPdf({ templateData, finalLogoPath, revision, longDate, operatorName }, outputPath);
      return { success: true, fileName, outputPath, warning: 'FALLBACK_PDFKIT' };
    }

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      await page.pdf({
        path: outputPath,
        format: 'A4',
        margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate
      });
    } catch (pdfErr) {
      // Fallback in caso di errore di rendering
      await this._generateFallbackPdf({ templateData, finalLogoPath, revision, longDate, operatorName }, outputPath);
      return { success: true, fileName, outputPath, warning: 'FALLBACK_PDFKIT' };
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    return {
      success: true,
      fileName,
      outputPath
    };
  }

  // Fallback semplice via PDFKit per garantire un PDF diagnostico anche senza Chromium
  _generateFallbackPdf(context, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        const { templateData, finalLogoPath } = context;
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(16).text('CHECK VERIFICA ERRORE 500', { align: 'right' });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(9).text(`Data: ${templateData.DATA_LUNGA}    Revisione: ${templateData.REVISIONE}    Operatore: ${templateData.OPERATORE}`);
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#999');
        doc.moveDown(1);

        // Logo (se disponibile)
        if (finalLogoPath && fs.existsSync(finalLogoPath)) {
          try {
            doc.image(finalLogoPath, 50, 60, { fit: [80, 80] });
          } catch (_) {}
        }

        // Sezioni
        const addSection = (title, content) => {
          doc.moveDown(1);
          doc.font('Helvetica-Bold').fontSize(12).text(title);
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(11).text(content || '-', { width: 495 });
        };

        addSection('Descrizione del problema', templateData.DESCRIZIONE);
        addSection('Analisi tecnica', templateData.ANALISI);

        // Log principali
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(12).text('Log principali');
        doc.moveDown(0.3);
        if (Array.isArray(templateData.LOG_PRINCIPALI) && templateData.LOG_PRINCIPALI.length > 0) {
          templateData.LOG_PRINCIPALI.forEach((line) => {
            doc.font('Helvetica').fontSize(10).text(`• ${line}`);
          });
        } else {
          doc.font('Helvetica').fontSize(11).text('Nessun log principale fornito.');
        }

        addSection('Causa radice', templateData.CAUSA_RADICE);
        addSection('Soluzione adottata', templateData.SOLUZIONE);
        addSection('Test di verifica', templateData.TEST_VERIFICA);
        addSection('Stato finale del server', templateData.STATO_FINALE);

        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
      } catch (e) {
        reject(e);
      }
    });
  }
}

module.exports = Error500ReportGenerator;