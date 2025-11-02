// ReportGenerator.java

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;

import java.awt.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Generatore di rapporti PDF per cassette di primo soccorso
 * 
 * Dipendenze Maven:
 * <dependency>
 *   <groupId>org.apache.pdfbox</groupId>
 *   <artifactId>pdfbox</artifactId>
 *   <version>2.0.29</version>
 * </dependency>
 * 
 * Compilazione ed esecuzione:
 * mvn compile exec:java -Dexec.mainClass="ReportGenerator"
 */
public class ReportGenerator {
    
    // Costanti di layout migliorate per allineamento preciso
    private static final float MARGIN = 40f;
    private static final float PAGE_WIDTH = PDRectangle.A4.getWidth();
    private static final float PAGE_HEIGHT = PDRectangle.A4.getHeight();
    private static final float CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
    private static final float HEADER_HEIGHT = 64f;
    private static final float FOOTER_HEIGHT = 90f;
    private static final float COLUMN_GUTTER = 24f;
    private static final float COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GUTTER) / 2;
    private static final float LOGO_MAX_WIDTH = 120f;
    private static final float LOGO_MAX_HEIGHT = 40f;
    private static final float SIGNATURE_MAX_WIDTH = 180f;
    private static final float SIGNATURE_MAX_HEIGHT = 60f;
    
    // Costanti per spaziatura uniforme
    private static final float SECTION_SPACING = 8f;
    private static final float ITEM_SPACING = 14f;
    private static final float TITLE_SPACING = 20f;
    private static final float BULLET_INDENT = 15f;
    private static final float MIN_SECTION_HEIGHT = 40f;
    
    // Font e dimensioni
    private static final PDType1Font FONT_BOLD = PDType1Font.HELVETICA_BOLD;
    private static final PDType1Font FONT_REGULAR = PDType1Font.HELVETICA;
    private static final float TITLE_FONT_SIZE = 14f;
    private static final float HEADER_FONT_SIZE = 10f;
    private static final float SECTION_FONT_SIZE = 12f;
    private static final float CONTENT_FONT_SIZE = 10f;
    
    public static class Articolo {
        public String codice;
        public String nome;
        public String lotto;
        public String seriale;
        public int quantitaAttuale;
        public int quantitaMassima;
        public int sogliaMinima;
        public String scadenza;
        public int giorniAScadenza;
        public String stato;
        public String note;
        public boolean inQuarantena;
        public boolean inRichiamo;
        
        public Articolo(String nome, int quantitaAttuale, int quantitaMassima) {
            this.codice = "";
            this.nome = nome;
            this.lotto = "";
            this.seriale = "";
            this.quantitaAttuale = quantitaAttuale;
            this.quantitaMassima = quantitaMassima;
            this.sogliaMinima = 0;
            this.scadenza = "";
            this.giorniAScadenza = -1;
            this.stato = "OK";
            this.note = "";
            this.inQuarantena = false;
            this.inRichiamo = false;
            calcolaStato();
        }
        
        public Articolo(String codice, String nome, String lotto, String seriale, int quantitaAttuale, 
                       int quantitaMassima, int sogliaMinima, String scadenza) {
            this.codice = codice != null ? codice : "";
            this.nome = nome;
            this.lotto = lotto != null ? lotto : "";
            this.seriale = seriale != null ? seriale : "";
            this.quantitaAttuale = quantitaAttuale;
            this.quantitaMassima = quantitaMassima;
            this.sogliaMinima = sogliaMinima;
            this.scadenza = scadenza != null ? scadenza : "";
            this.giorniAScadenza = -1;
            this.stato = "OK";
            this.note = "";
            this.inQuarantena = false;
            this.inRichiamo = false;
            calcolaGiorniAScadenza();
            calcolaStato();
        }
        
        public Articolo(String nome, int quantitaAttuale, int quantitaMassima, String scadenza) {
            this.codice = "";
            this.nome = nome;
            this.lotto = "";
            this.seriale = "";
            this.quantitaAttuale = quantitaAttuale;
            this.quantitaMassima = quantitaMassima;
            this.sogliaMinima = 0;
            this.scadenza = scadenza != null ? scadenza : "";
            this.giorniAScadenza = -1;
            this.stato = "OK";
            this.note = "";
            this.inQuarantena = false;
            this.inRichiamo = false;
            calcolaGiorniAScadenza();
            calcolaStato();
        }
        
        public Articolo(String nome, int quantitaAttuale, int quantitaMassima, String scadenza, String note) {
            this.codice = "";
            this.nome = nome;
            this.lotto = "";
            this.seriale = "";
            this.quantitaAttuale = quantitaAttuale;
            this.quantitaMassima = quantitaMassima;
            this.sogliaMinima = 0;
            this.scadenza = scadenza != null ? scadenza : "";
            this.giorniAScadenza = -1;
            this.stato = "OK";
            this.note = note != null ? note : "";
            this.inQuarantena = false;
            this.inRichiamo = false;
            calcolaGiorniAScadenza();
            calcolaStato();
        }
        
        private void calcolaGiorniAScadenza() {
            if (scadenza != null && !scadenza.isEmpty() && !scadenza.equals("N/D")) {
                try {
                    LocalDate dataScadenza = LocalDate.parse(scadenza, DateTimeFormatter.ofPattern("dd/MM/yyyy"));
                    this.giorniAScadenza = (int) java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), dataScadenza);
                } catch (Exception e) {
                    this.giorniAScadenza = -1;
                }
            } else {
                this.giorniAScadenza = -1;
            }
        }
        
        private void calcolaStato() {
            if (inQuarantena) {
                this.stato = "QUARANTENA";
                return;
            }
            if (inRichiamo) {
                this.stato = "RICHIAMO";
                return;
            }
            
            if (giorniAScadenza >= 0) {
                if (giorniAScadenza == 0 || giorniAScadenza < 0) {
                    this.stato = "SCADUTO";
                } else if (giorniAScadenza <= 30) { // threshold di default 30 giorni
                    this.stato = "IN_SCADENZA";
                } else {
                    this.stato = "OK";
                }
            } else if (scadenza.equals("N/D")) {
                this.stato = "N/D";
            } else {
                this.stato = "OK";
            }
        }
        
        public void setQuarantena(boolean inQuarantena) {
            this.inQuarantena = inQuarantena;
            calcolaStato();
        }
        
        public void setRichiamo(boolean inRichiamo) {
            this.inRichiamo = inRichiamo;
            calcolaStato();
        }

        public boolean isQuantitaCompleta() {
            return quantitaAttuale >= quantitaMassima;
        }

        public boolean isQuantitaEccessiva() {
            return quantitaAttuale > quantitaMassima;
        }
        
        public boolean isSottoSoglia() {
            return quantitaAttuale < sogliaMinima;
        }

        public String toDisplayString() {
            StringBuilder sb = new StringBuilder();
            sb.append(nome);
            if (quantitaAttuale < quantitaMassima) {
                sb.append(" [INCOMPLETO: ").append(quantitaAttuale).append("/").append(quantitaMassima).append("]");
            } else if (quantitaAttuale > quantitaMassima) {
                sb.append(" [ECCESSO: ").append(quantitaAttuale).append("/").append(quantitaMassima).append("]");
            }
            return sb.toString();
        }
        
        public String toTableRow() {
            return String.format("%-10s | %-25s | %-12s | %-12s | %-12s | %3d | %3d | %3d | %-12s",
                codice.isEmpty() ? "N/D" : codice,
                nome.length() > 25 ? nome.substring(0, 22) + "..." : nome,
                lotto.isEmpty() ? seriale.isEmpty() ? "N/D" : seriale : lotto,
                scadenza.isEmpty() ? "N/D" : scadenza,
                giorniAScadenza >= 0 ? String.valueOf(giorniAScadenza) : "N/D",
                quantitaAttuale,
                sogliaMinima,
                quantitaMassima,
                stato
            );
        }
    }

    public static class Sezione {
        public String titolo;
        public String ubicazione;
        public String responsabile;
        public List<String> righe;  // Mantenuto per compatibilità
        public List<Articolo> articoli;  // Nuova struttura
        
        // Costruttore per compatibilità
        public Sezione(String titolo, List<String> righe) {
            this.titolo = titolo;
            this.ubicazione = "";
            this.responsabile = "";
            this.righe = righe;
            this.articoli = new ArrayList<>();
        }
        
        // Nuovo costruttore completo
        public Sezione(String titolo, String ubicazione, String responsabile, ArrayList<Articolo> articoli) {
            this.titolo = titolo;
            this.ubicazione = ubicazione != null ? ubicazione : "";
            this.responsabile = responsabile != null ? responsabile : "";
            this.articoli = articoli;
            this.righe = new ArrayList<>();
            // Converti articoli in righe per compatibilità
            for (Articolo articolo : articoli) {
                this.righe.add(articolo.toDisplayString());
            }
        }
        
        // Costruttore esistente modificato
        public Sezione(String titolo, ArrayList<Articolo> articoli) {
            this.titolo = titolo;
            this.ubicazione = "";
            this.responsabile = "";
            this.articoli = articoli;
            this.righe = new ArrayList<>();
            // Converti articoli in righe per compatibilità
            for (Articolo articolo : articoli) {
                this.righe.add(articolo.toDisplayString());
            }
        }

        public void addArticolo(Articolo articolo) {
            this.articoli.add(articolo);
            // Mantieni sincronizzazione con righe
            this.righe.add(articolo.toDisplayString());
        }
        
        public double calcolaPercentualeCompletezza() {
            if (articoli.isEmpty()) {
                return 0.0;
            }
            
            int articoliCompleti = 0;
            for (Articolo articolo : articoli) {
                if (articolo.isQuantitaCompleta()) {
                    articoliCompleti++;
                }
            }
            
            return (double) articoliCompleti / articoli.size() * 100.0;
        }
        
        public String getTestataKit() {
            StringBuilder sb = new StringBuilder();
            sb.append("Kit: ").append(titolo);
            if (!ubicazione.isEmpty()) {
                sb.append(" | Ubicazione: ").append(ubicazione);
            }
            if (!responsabile.isEmpty()) {
                sb.append(" | Responsabile: ").append(responsabile);
            }
            sb.append(" | Completezza: ").append(String.format("%.1f%%", calcolaPercentualeCompletezza()));
            return sb.toString();
        }
        
        public List<Articolo> getArticoliOrdinatiPerFEFO() {
            List<Articolo> articoliOrdinati = new ArrayList<>(articoli);
            
            // Filtra articoli in quarantena/richiamo
            articoliOrdinati.removeIf(a -> a.inQuarantena || a.inRichiamo);
            
            // Ordina per FEFO (First Expired First Out)
            articoliOrdinati.sort((a1, a2) -> {
                // Prima gli articoli con scadenza definita
                if (a1.giorniAScadenza >= 0 && a2.giorniAScadenza < 0) return -1;
                if (a1.giorniAScadenza < 0 && a2.giorniAScadenza >= 0) return 1;
                
                // Se entrambi hanno scadenza, ordina per giorni a scadenza
                if (a1.giorniAScadenza >= 0 && a2.giorniAScadenza >= 0) {
                    return Integer.compare(a1.giorniAScadenza, a2.giorniAScadenza);
                }
                
                // Se nessuno ha scadenza, ordina per nome
                return a1.nome.compareTo(a2.nome);
            });
            
            return articoliOrdinati;
        }
    }
    
    public static void generate(
            Path outputPdf,
            Path logoPng,
            String sede,
            String operatoreNome,
            Path firmaPng,
            LocalDate data,
            List<Sezione> cassette,
            String revisione
    ) throws IOException {
        
        if (data == null) {
            data = LocalDate.now();
        }
        
        if (revisione == null || revisione.isEmpty()) {
            revisione = "Rev.05"; // Default revision
        }
        
        try (PDDocument document = new PDDocument()) {
            // Carica immagini se disponibili
            PDImageXObject logoImage = null;
            if (logoPng != null && Files.exists(logoPng)) {
                logoImage = PDImageXObject.createFromFile(logoPng.toString(), document);
            }
            
            PDImageXObject firmaImage = null;
            if (firmaPng != null && Files.exists(firmaPng)) {
                firmaImage = PDImageXObject.createFromFile(firmaPng.toString(), document);
            }
            
            // Formatta la data in italiano
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("EEEE d MMMM uuuu", Locale.ITALIAN);
            String dataFormattata = data.format(formatter);
            // Capitalizza la prima lettera
            dataFormattata = dataFormattata.substring(0, 1).toUpperCase() + dataFormattata.substring(1);
            
            // Genera il contenuto
            List<PDPage> pages = new ArrayList<>();
            List<PDPageContentStream> contentStreams = new ArrayList<>();
            
            // Prima pagina
            PDPage currentPage = new PDPage(PDRectangle.A4);
            document.addPage(currentPage);
            pages.add(currentPage);
            PDPageContentStream contentStream = new PDPageContentStream(document, currentPage);
            contentStreams.add(contentStream);
            
            // Disegna intestazione
            drawHeader(contentStream, logoImage, sede, dataFormattata, operatoreNome, revisione);
            
            // Posizione corrente per il contenuto con allineamento migliorato
            float currentY = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT - SECTION_SPACING;
            int currentColumn = 0; // 0 = sinistra, 1 = destra
            float leftColumnY = currentY;
            float rightColumnY = currentY;
            
            // Disegna sezioni con controllo anti-sovrapposizione migliorato
            for (Sezione sezione : cassette) {
                float sectionHeight = calculateSectionHeight(sezione);
                
                // Determina quale colonna usare (quella con più spazio disponibile)
                if (currentColumn == 0 || leftColumnY >= rightColumnY) {
                    currentColumn = 0;
                    currentY = leftColumnY;
                } else {
                    currentColumn = 1;
                    currentY = rightColumnY;
                }
                
                // Controllo spazio disponibile per evitare sovrapposizioni
                float availableHeight = currentY - MARGIN - FOOTER_HEIGHT;
                
                // Se non c'è abbastanza spazio, prova l'altra colonna o nuova pagina
                if (availableHeight < sectionHeight + MIN_SECTION_HEIGHT) {
                    if (currentColumn == 0 && rightColumnY - MARGIN - FOOTER_HEIGHT >= sectionHeight + MIN_SECTION_HEIGHT) {
                        // Prova la seconda colonna
                        currentColumn = 1;
                        currentY = rightColumnY;
                    } else {
                        // Nuova pagina necessaria
                        contentStream.close();
                        
                        currentPage = new PDPage(PDRectangle.A4);
                        document.addPage(currentPage);
                        pages.add(currentPage);
                        contentStream = new PDPageContentStream(document, currentPage);
                        contentStreams.add(contentStream);
                        
                        drawHeader(contentStream, logoImage, sede, dataFormattata, operatoreNome, revisione);
                        currentY = PAGE_HEIGHT - MARGIN - HEADER_HEIGHT - SECTION_SPACING;
                        leftColumnY = currentY;
                        rightColumnY = currentY;
                        currentColumn = 0;
                    }
                }
                
                // Calcola posizione X con margini di sicurezza
                float columnX = MARGIN + (currentColumn * (COLUMN_WIDTH + COLUMN_GUTTER));
                
                // Disegna sezione con controllo anti-sovrapposizione
                drawSectionWithBorder(contentStream, sezione, columnX, currentY);
                
                // Aggiorna la posizione Y con spazio di sicurezza extra
                float newY = currentY - sectionHeight - SECTION_SPACING - 5; // 5 punti extra per sicurezza
                if (currentColumn == 0) {
                    leftColumnY = newY;
                } else {
                    rightColumnY = newY;
                }
            }
            
            // Chiudi tutti i content stream
            for (PDPageContentStream cs : contentStreams) {
                if (!cs.equals(contentStream)) {
                    cs.close();
                }
            }
            
            // Disegna footer solo sull'ultima pagina
            drawFooter(contentStream, firmaImage, operatoreNome);
            contentStream.close();
            
            // Aggiungi numerazione pagine
            addPageNumbers(document, pages);
            
            // Salva il documento
            document.save(outputPdf.toFile());
        }
    }
    
    private static void drawHeader(PDPageContentStream contentStream, PDImageXObject logoImage, 
                                 String sede, String dataFormattata, String operatoreNome, String revisione) throws IOException {
        
        float headerY = PAGE_HEIGHT - MARGIN;
        
        // Logo o segnaposto
        if (logoImage != null) {
            float[] logoDimensions = calculateScaledDimensions(
                logoImage.getWidth(), logoImage.getHeight(), LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT);
            contentStream.drawImage(logoImage, MARGIN, headerY - logoDimensions[1], 
                                  logoDimensions[0], logoDimensions[1]);
        } else {
            // Rettangolo segnaposto per logo
            contentStream.setStrokingColor(Color.LIGHT_GRAY);
            contentStream.addRect(MARGIN, headerY - LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT);
            contentStream.stroke();
        }
        
        // Revisione in alto a destra
        if (revisione != null && !revisione.isEmpty()) {
            contentStream.beginText();
            contentStream.setFont(FONT_REGULAR, HEADER_FONT_SIZE);
            float revisionWidth = FONT_REGULAR.getStringWidth(revisione) / 1000 * HEADER_FONT_SIZE;
            contentStream.newLineAtOffset(PAGE_WIDTH - MARGIN - revisionWidth, headerY - 10);
            contentStream.showText(revisione);
            contentStream.endText();
        }
        
        // Titolo principale centrato - conforme D.M. 388/2003
        contentStream.beginText();
        contentStream.setFont(FONT_BOLD, TITLE_FONT_SIZE);
        
        // Prima riga del titolo
        String titoloPrimaRiga = "CHECK VERIFICA CONTENUTO MINIMO";
        float titoloPrimaRigaWidth = FONT_BOLD.getStringWidth(titoloPrimaRiga) / 1000 * TITLE_FONT_SIZE;
        contentStream.newLineAtOffset((PAGE_WIDTH - titoloPrimaRigaWidth) / 2, headerY - 18);
        contentStream.showText(titoloPrimaRiga);
        
        // Seconda riga del titolo
        String titoloSecondaRiga = "CASSETTA DI PRIMO SOCCORSO";
        float titoloSecondaRigaWidth = FONT_BOLD.getStringWidth(titoloSecondaRiga) / 1000 * TITLE_FONT_SIZE;
        contentStream.newLineAtOffset((PAGE_WIDTH - titoloSecondaRigaWidth) / 2 - (PAGE_WIDTH - titoloPrimaRigaWidth) / 2, -18);
        contentStream.showText(titoloSecondaRiga);
        contentStream.endText();
        
        // Sottotitolo esplicativo - riferimento normativo
        contentStream.beginText();
        contentStream.setFont(FONT_REGULAR, HEADER_FONT_SIZE - 1);
        String sottotitolo = "Il presente modulo è utilizzato per verificare il contenuto minimo delle cassette di primo soccorso,";
        String sottotitolo2 = "come indicato dal D.M. 388/2003, installate presso l'azienda ISOKIT Srl.";
        
        float sottotitoloWidth = FONT_REGULAR.getStringWidth(sottotitolo) / 1000 * (HEADER_FONT_SIZE - 1);
        float sottotitolo2Width = FONT_REGULAR.getStringWidth(sottotitolo2) / 1000 * (HEADER_FONT_SIZE - 1);
        
        contentStream.newLineAtOffset((PAGE_WIDTH - sottotitoloWidth) / 2, headerY - 32);
        contentStream.showText(sottotitolo);
        contentStream.newLineAtOffset((PAGE_WIDTH - sottotitolo2Width) / 2 - (PAGE_WIDTH - sottotitoloWidth) / 2, -12);
        contentStream.showText(sottotitolo2);
        contentStream.endText();
        
        // Informazioni a destra
        contentStream.beginText();
        contentStream.setFont(FONT_REGULAR, HEADER_FONT_SIZE);
        float rightX = PAGE_WIDTH - MARGIN - 150;
        contentStream.newLineAtOffset(rightX, headerY - 52);
        contentStream.showText("Sede: " + sede);
        contentStream.newLineAtOffset(0, -12);
        contentStream.showText("Data: " + dataFormattata);
        contentStream.newLineAtOffset(0, -12);
        contentStream.showText("Operatore: " + operatoreNome);
        contentStream.endText();
        
        // Linea di separazione
        contentStream.setStrokingColor(Color.BLACK);
        contentStream.moveTo(MARGIN, headerY - HEADER_HEIGHT);
        contentStream.lineTo(PAGE_WIDTH - MARGIN, headerY - HEADER_HEIGHT);
        contentStream.stroke();
    }
    
    private static void drawFooter(PDPageContentStream contentStream, PDImageXObject firmaImage, 
                                 String operatoreNome) throws IOException {
        
        float footerY = MARGIN + FOOTER_HEIGHT;
        float rightX = PAGE_WIDTH - MARGIN - 200;
        
        // Etichetta "Firma operatore"
        contentStream.beginText();
        contentStream.setFont(FONT_REGULAR, CONTENT_FONT_SIZE);
        contentStream.newLineAtOffset(rightX, footerY);
        contentStream.showText("Firma operatore:");
        contentStream.endText();
        
        // Firma o linea
        if (firmaImage != null) {
            float[] firmaDimensions = calculateScaledDimensions(
                firmaImage.getWidth(), firmaImage.getHeight(), SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_HEIGHT);
            contentStream.drawImage(firmaImage, rightX, footerY - 50, 
                                  firmaDimensions[0], firmaDimensions[1]);
        } else {
            // Linea per la firma
            contentStream.moveTo(rightX, footerY - 30);
            contentStream.lineTo(rightX + 150, footerY - 30);
            contentStream.stroke();
        }
        
        // Nome operatore sotto la firma
        contentStream.beginText();
        contentStream.setFont(FONT_REGULAR, CONTENT_FONT_SIZE);
        contentStream.newLineAtOffset(rightX, footerY - 65);
        contentStream.showText(operatoreNome);
        contentStream.endText();
    }
    
    private static void drawSectionWithBorder(PDPageContentStream contentStream, Sezione sezione, 
                                            float x, float y) throws IOException {
        
        float sectionHeight = calculateSectionHeight(sezione);
        
        // Disegna bordo sottile attorno alla sezione per migliore organizzazione
        contentStream.setStrokingColor(new Color(200, 200, 200));
        contentStream.setLineWidth(0.8f);
        contentStream.addRect(x - 8, y - sectionHeight + 8, COLUMN_WIDTH + 16, sectionHeight - 16);
        contentStream.stroke();
        
        // Disegna sfondo leggero per la sezione
        contentStream.setNonStrokingColor(new Color(248, 248, 248));
        contentStream.addRect(x - 7, y - sectionHeight + 9, COLUMN_WIDTH + 14, sectionHeight - 18);
        contentStream.fill();
        
        // Ripristina il colore del testo
        contentStream.setNonStrokingColor(Color.BLACK);
        
        // Disegna il contenuto della sezione in formato tabellare
        drawSectionAsTable(contentStream, sezione, x, y);
    }
    
    private static void drawSectionAsTable(PDPageContentStream contentStream, Sezione sezione, 
                                         float x, float y) throws IOException {
        float currentY = y;
        
        // Disegna il riquadro testata kit
        contentStream.setStrokingColor(Color.BLACK);
        contentStream.setLineWidth(1f);
        contentStream.addRect(x, currentY - 16, CONTENT_WIDTH, 16);
        contentStream.stroke();
        
        // Testo testata kit
        contentStream.beginText();
        contentStream.setFont(FONT_BOLD, SECTION_FONT_SIZE);
        contentStream.newLineAtOffset(x + 5, currentY - 12);
        contentStream.showText(sezione.getTestataKit());
        contentStream.endText();
        
        currentY -= 22;
        
        // Header tabella materiali
        String[] headers = {"Codice", "Nome", "Lotto/Ser.", "Scadenza", "Gg.Scad.", "Qta", "Min", "Max", "Stato"};
        float[] columnWidths = {60, 150, 80, 80, 60, 40, 40, 40, 80};
        
        // Disegna header
        contentStream.setStrokingColor(Color.BLACK);
        contentStream.setLineWidth(0.5f);
        float headerY = currentY;
        float headerX = x;
        
        // Background header
        contentStream.setNonStrokingColor(Color.LIGHT_GRAY);
        contentStream.addRect(headerX, headerY - 13, CONTENT_WIDTH, 13);
        contentStream.fill();
        
        // Testo header
        contentStream.setNonStrokingColor(Color.BLACK);
        contentStream.beginText();
        contentStream.setFont(FONT_BOLD, CONTENT_FONT_SIZE);
        
        float currentX = headerX + 2;
        for (int i = 0; i < headers.length; i++) {
            contentStream.newLineAtOffset(currentX - (i == 0 ? 0 : currentX), headerY - 12);
            contentStream.showText(headers[i]);
            currentX += columnWidths[i];
        }
        contentStream.endText();
        
        // Linee verticali header
        currentX = headerX;
        for (int i = 0; i <= headers.length; i++) {
            contentStream.moveTo(currentX, headerY);
            contentStream.lineTo(currentX, headerY - 13);
            contentStream.stroke();
            if (i < headers.length) {
                currentX += columnWidths[i];
            }
        }
        
        // Linea orizzontale header
        contentStream.moveTo(headerX, headerY);
        contentStream.lineTo(headerX + CONTENT_WIDTH, headerY);
        contentStream.stroke();
        contentStream.moveTo(headerX, headerY - 13);
        contentStream.lineTo(headerX + CONTENT_WIDTH, headerY - 13);
        contentStream.stroke();
        
        currentY = headerY - 13;
        
        // Righe dati (ordinamento FEFO)
        List<Articolo> articoliOrdinati = sezione.getArticoliOrdinatiPerFEFO();
        
        for (Articolo articolo : articoliOrdinati) {
            currentY -= 13;
            
            // Determina colore di sfondo basato sullo stato
            Color backgroundColor = Color.WHITE;
            switch (articolo.stato) {
                case "SCADUTO":
                case "QUARANTENA":
                case "RICHIAMO":
                    backgroundColor = new Color(255, 200, 200); // Rosso chiaro
                    break;
                case "IN_SCADENZA":
                    backgroundColor = new Color(255, 255, 200); // Giallo chiaro
                    break;
                default:
                    backgroundColor = Color.WHITE;
                    break;
            }
            
            // Background riga
            contentStream.setNonStrokingColor(backgroundColor);
            contentStream.addRect(headerX, currentY, CONTENT_WIDTH, 13);
            contentStream.fill();
            
            // Testo riga
            contentStream.setNonStrokingColor(Color.BLACK);
            contentStream.beginText();
            contentStream.setFont(FONT_REGULAR, CONTENT_FONT_SIZE);
            
            currentX = headerX + 2;
            String[] values = {
                articolo.codice.isEmpty() ? "N/D" : articolo.codice,
                articolo.nome.length() > 20 ? articolo.nome.substring(0, 17) + "..." : articolo.nome,
                articolo.lotto.isEmpty() ? (articolo.seriale.isEmpty() ? "N/D" : articolo.seriale) : articolo.lotto,
                articolo.scadenza.isEmpty() ? "N/D" : articolo.scadenza,
                articolo.giorniAScadenza >= 0 ? String.valueOf(articolo.giorniAScadenza) : "N/D",
                String.valueOf(articolo.quantitaAttuale),
                String.valueOf(articolo.sogliaMinima),
                String.valueOf(articolo.quantitaMassima),
                articolo.stato
            };
            
            for (int i = 0; i < values.length; i++) {
                contentStream.newLineAtOffset(currentX - (i == 0 ? 0 : currentX), currentY + 3);
                contentStream.showText(values[i]);
                currentX += columnWidths[i];
            }
            contentStream.endText();
            
            // Linee verticali riga
            currentX = headerX;
            for (int i = 0; i <= headers.length; i++) {
                contentStream.moveTo(currentX, currentY);
                contentStream.lineTo(currentX, currentY + 13);
                contentStream.stroke();
                if (i < headers.length) {
                    currentX += columnWidths[i];
                }
            }
            
            // Linea orizzontale riga
            contentStream.moveTo(headerX, currentY);
            contentStream.lineTo(headerX + CONTENT_WIDTH, currentY);
            contentStream.stroke();
        }
        
        // Linea finale tabella
        contentStream.moveTo(headerX, currentY);
        contentStream.lineTo(headerX + CONTENT_WIDTH, currentY);
        contentStream.stroke();
        
        // Aggiungi articoli in quarantena/richiamo separatamente se presenti
        List<Articolo> articoliBloccati = sezione.articoli.stream()
            .filter(a -> a.inQuarantena || a.inRichiamo)
            .collect(java.util.stream.Collectors.toList());
            
        if (!articoliBloccati.isEmpty()) {
            currentY -= 25;
            contentStream.beginText();
            contentStream.setFont(FONT_BOLD, CONTENT_FONT_SIZE);
            contentStream.setNonStrokingColor(Color.RED);
            contentStream.newLineAtOffset(x, currentY);
            contentStream.showText("ARTICOLI BLOCCATI (Quarantena/Richiamo):");
            contentStream.endText();
            
            for (Articolo articolo : articoliBloccati) {
                currentY -= 15;
                contentStream.beginText();
                contentStream.setFont(FONT_REGULAR, CONTENT_FONT_SIZE);
                contentStream.setNonStrokingColor(Color.RED);
                contentStream.newLineAtOffset(x + 10, currentY);
                contentStream.showText("• " + articolo.nome + " - " + articolo.stato);
                contentStream.endText();
            }
        }
    }
    

    
    // Removed unused ItemInfo class as it's not used anywhere in the codebase
        boolean hasIncompleteQuantity;
        boolean isExpired;
        boolean hasExcessiveQuantity;  // Nuova proprietà
        int quantityStart;
        int quantityEnd;

        public void ItemInfo() {
            hasIncompleteQuantity = false;
            isExpired = false;
            hasExcessiveQuantity = false;  // Inizializzazione
            quantityStart = -1;
            quantityEnd = -1;
        }
// Removed extra closing brace as it was causing a syntax error
    
    // Removed unused methods parseItemInfo and drawFormattedText
    // These methods were part of an older text formatting system that has been replaced
    // by the current table-based rendering approach in drawSectionAsTable method
    
    private static float calculateSectionHeight(Sezione sezione) throws IOException {
        float height = TITLE_SPACING + 8; // Titolo + linea sotto
        
        for (String riga : sezione.righe) {
            List<String> wrappedLines = wrapText(riga, COLUMN_WIDTH - BULLET_INDENT - 20, FONT_REGULAR, CONTENT_FONT_SIZE);
            height += wrappedLines.size() * ITEM_SPACING;
        }
        
        return height + SECTION_SPACING + 16; // Spazio finale + padding per bordo
    }
    
    private static List<String> wrapText(String text, float maxWidth, PDType1Font font, float fontSize) throws IOException {
        List<String> lines = new ArrayList<>();
        String[] words = text.split(" ");
        StringBuilder currentLine = new StringBuilder();
        
        for (String word : words) {
            String testLine = currentLine.length() == 0 ? word : currentLine + " " + word;
            
            // Calcola larghezza considerando margini di sicurezza per evitare sovrapposizioni
            float textWidth = font.getStringWidth(testLine) / 1000 * fontSize;
            
            if (textWidth <= maxWidth - 15) { // 15 punti di margine di sicurezza
                currentLine = new StringBuilder(testLine);
            } else {
                if (currentLine.length() > 0) {
                    lines.add(currentLine.toString());
                    currentLine = new StringBuilder(word);
                } else {
                    // Parola troppo lunga, spezzala
                    lines.add(word);
                }
            }
        }
        
        if (currentLine.length() > 0) {
            lines.add(currentLine.toString());
        }
        
        return lines;
    }
    
    private static float[] calculateScaledDimensions(float originalWidth, float originalHeight, 
                                                   float maxWidth, float maxHeight) {
        float scaleX = maxWidth / originalWidth;
        float scaleY = maxHeight / originalHeight;
        float scale = Math.min(scaleX, scaleY);
        
        return new float[]{originalWidth * scale, originalHeight * scale};
    }
    
    private static void addPageNumbers(PDDocument document, List<PDPage> pages) throws IOException {
        int totalPages = pages.size();
        java.time.LocalDateTime adesso = java.time.LocalDateTime.now();
        String dataOraGenerazione = adesso.format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"));
        
        for (int i = 0; i < pages.size(); i++) {
            PDPage page = pages.get(i);
            try (PDPageContentStream contentStream = new PDPageContentStream(document, page, 
                    PDPageContentStream.AppendMode.APPEND, true)) {
                
                // Numero pagina centrato
                String pageText = "Pagina " + (i + 1) + " di " + totalPages;
                float textWidth = FONT_REGULAR.getStringWidth(pageText) / 1000 * CONTENT_FONT_SIZE;
                
                contentStream.beginText();
                contentStream.setFont(FONT_REGULAR, CONTENT_FONT_SIZE);
                contentStream.newLineAtOffset((PAGE_WIDTH - textWidth) / 2, MARGIN / 2);
                contentStream.showText(pageText);
                contentStream.endText();
                
                // Data/ora generazione a sinistra
                contentStream.beginText();
                contentStream.setFont(FONT_REGULAR, CONTENT_FONT_SIZE);
                contentStream.newLineAtOffset(MARGIN, MARGIN / 2);
                contentStream.showText("Generato: " + dataOraGenerazione);
                contentStream.endText();
            }
        }
    }
    
    public static void main(String[] args) {
        try {
            if (args.length < 4) {
                System.err.println("❌ Parametri insufficienti. Uso: java ReportGenerator <operatore> <kits> <sede> <revisione> [<firma>] [<logo>]");
                System.exit(1);
            }
            
            String operatoreNome = args[0];
            String kitsData = args[1];
            String sede = args[2];
            String revisione = args[3];
            String firmaPath = args.length > 4 ? args[4] : "";
            String logoPath = args.length > 5 ? args[5] : "";
            
            // Parse dei dati dei kit dal formato stringa
            List<Sezione> cassette = parseKitsData(kitsData);
            
            // Genera il rapporto
            generate(
                Paths.get("rapporto_cassette.pdf"),
                logoPath.isEmpty() ? null : Paths.get(logoPath),
                sede,
                operatoreNome,
                firmaPath.isEmpty() ? null : Paths.get(firmaPath),
                LocalDate.now(),
                cassette,
                revisione
            );
            
            System.out.println("✅ Rapporto generato con successo: rapporto_cassette.pdf");
            
        } catch (Exception e) {
            System.err.println("❌ Errore durante la generazione del rapporto: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
    
    private static List<Sezione> parseKitsData(String kitsData) {
        List<Sezione> cassette = new ArrayList<>();
        
        if (kitsData == null || kitsData.trim().isEmpty()) {
            return cassette;
        }
        
        // Split per kit (separati da |)
        String[] kits = kitsData.split("\\|");
        
        for (String kitData : kits) {
            if (kitData.trim().isEmpty()) continue;
            
            // Split per articoli (separati da ;)
            String[] articoli = kitData.split(";");
            ArrayList<Articolo> articoliKit = new ArrayList<>();
            String kitTitolo = "Kit Primo Soccorso";
            String kitUbicazione = "";
            
            for (String articoloData : articoli) {
                if (articoloData.trim().isEmpty()) continue;
                
                // Format: codiceKit,ubicazione,codiceArticolo,descrizione,quantita,scadenza,stato
                String[] parts = articoloData.split(",");
                if (parts.length >= 7) {
                    String codiceKit = parts[0];
                    String ubicazione = parts[1];
                    String codiceArticolo = parts[2];
                    String descrizione = parts[3];
                    int quantita = 0;
                    try {
                        quantita = Integer.parseInt(parts[4]);
                    } catch (NumberFormatException e) {
                        // Ignora errori di parsing
                    }
                    String scadenza = parts[5];
                    String stato = parts[6];
                    
                    // Usa il primo articolo per impostare titolo e ubicazione del kit
                    if (articoliKit.isEmpty()) {
                        kitTitolo = "Kit " + codiceKit;
                        kitUbicazione = ubicazione;
                    }
                    
                    // Crea articolo (assumendo quantità massima = quantità attuale + 2)
                    Articolo articolo = new Articolo(codiceArticolo, descrizione, "", "", 
                                                   quantita, quantita + 2, 1, scadenza);
                    articolo.stato = stato;
                    articoliKit.add(articolo);
                }
            }
            
            if (!articoliKit.isEmpty()) {
                cassette.add(new Sezione(kitTitolo, kitUbicazione, "", articoliKit));
            }
        }
        
        return cassette;
    }
}
//EOF