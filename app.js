const ProgressTracker = {
    updateStatus(msg) {
        const el = document.getElementById('loading-status');
        if (el) el.textContent = msg;
        console.log("[Progress]", msg);
    }
};

const app = {
    currentQuestions: [],
    currentIndex: 0,
    score: 0,
    currentPdfFile: null,
    currentTestName: "",
    currentPdfPages: null,
    currentStartPage: 1,
    currentEndPage: null, // Inicialmente en blanco
    maxPdfPages: 0,
    pdfLibrary: [], // Biblioteca de PDFs en sesión
    creditBalance: 0,
    
    // Paginación y Selección
    currentHistoryPage: 0,
    itemsPerPage: 5,
    selectedTests: new Set(),
    
    init() {
        try {
            console.log("test_app: Inicializando...");
            // Indicador de arranque para el usuario (se quita al final)
            const debugBanner = document.createElement('div');
            debugBanner.id = "debug-init";
            debugBanner.style = "position:fixed;top:0;left:0;width:100%;background:rgba(0,0,0,0.8);color:#0f0;font-size:10px;z-index:9999;padding:2px;pointer-events:none;";
            debugBanner.textContent = "Booting v51...";
            document.body.appendChild(debugBanner);

            // Inicializar Créditos
            this.initCredits();
            // Eliminada detección de Stripe (Vuelve Bizum)

            this.setupPdfJS();
            this.setupEventListeners();
            this.registerSW();
            
            // Iniciar en home
            this.switchView('home-view');
            this.renderHistory();
            this.updateFailedCount();
            
            setTimeout(() => debugBanner.remove(), 2000);
            console.log("test_app: Listado!");
        } catch (err) {
            console.error("FATAL INIT ERROR:", err);
            alert("Error crítico al iniciar: " + err.message + "\nPrueba a borrar datos de navegación.");
        }
    },

    setupPdfJS() {
        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        }
    },

    registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(() => console.log("SW registrado correctamente"))
                .catch(err => console.warn("Error al registrar SW:", err));
        }
    },

    setupEventListeners() {
        // Botón nuevo test
        const btnNew = document.getElementById('btn-new-test');
        if (btnNew) {
            btnNew.addEventListener('click', () => {
                this.currentTestName = "";
                const topicEl = document.getElementById('test-topic');
                if (topicEl) topicEl.value = "";
                this.switchView('config-view');
            });
        }

        // Limpiar estado de PDF si el usuario escribe manualmente
        const topicEl = document.getElementById('test-topic');
        if (topicEl) {
            topicEl.addEventListener('input', (e) => {
                if (!e.isTrusted) return;
                this.currentPdfPages = null;
                this.currentPdfFile = null;
                const rangeContainer = document.getElementById('page-range-container');
                if (rangeContainer) rangeContainer.classList.add('hidden');
            });
        }

        // Botón Anki
        const btnAnki = document.getElementById('btn-import-anki');
        if (btnAnki) {
            btnAnki.addEventListener('click', () => {
                if (this.selectedTests.size > 0) this.exportToAnki();
                else this.triggerFilePicker('.apkg');
            });
        }

        // Botón Repasar Errores
        const btnErrors = document.getElementById('btn-review-errors');
        if (btnErrors) {
            btnErrors.addEventListener('click', () => this.loadFailedQuiz());
        }

        // Chips de selección
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Generar Test
        const btnGen = document.getElementById('btn-start-generation');
        if (btnGen) {
            btnGen.addEventListener('click', () => this.generateQuiz());
        }

        // Botón siguiente pregunta
        const btnNext = document.getElementById('btn-next');
        if (btnNext) {
            btnNext.addEventListener('click', () => this.nextQuestion());
        }
    },

    switchView(viewId) {
        // Ocultar todas las vistas y mostrar la seleccionada
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');
        
        // Resetear etiqueta de preguntas si entramos en modo PDF
        if (viewId === 'config-view') {
            const labelQ = document.getElementById('label-num-q');
            if (labelQ) {
                labelQ.textContent = (this.currentPdfPages && this.currentPdfPages.length > 0) 
                    ? "¿Cuántas preguntas por página?" 
                    : "Número de preguntas";
            }
        }

        // Actualizar iconos de la barra de pestañas (Tab Bar)
        document.querySelectorAll('.tab-item').forEach(item => {
            item.classList.remove('active');
            // Si el onclick tiene el viewId, lo marcamos activo
            if (item.getAttribute('onclick')?.includes(viewId)) {
                item.classList.add('active');
            }
        });

        window.scrollTo(0, 0);
        console.log("Cambiado a vista:", viewId);
    },

    async generateQuiz() {
        const topicEl = document.getElementById('test-topic');
        const topic = topicEl ? topicEl.value : "";
        const numQ = parseInt(document.querySelector('.chip.active')?.dataset.val || 5);

        if (!topic.trim() && !this.currentPdfFile) {
            alert("Por favor, introduce un tema o selecciona un PDF de la lista.");
            return;
        }

        let totalExpectedQ = numQ;
        // Si hay un PDF, calculamos los créditos según el rango (si el rango no se ha definido, asumimos 1 por ahora o lo validamos)
        if (this.currentPdfFile) {
            const endPage = (this.currentEndPage === null) ? this.currentStartPage : this.currentEndPage;
            const numPages = (endPage - this.currentStartPage) + 1;
            totalExpectedQ = numQ * numPages;
        }

        if (this.creditBalance < totalExpectedQ) {
            alert(`⚠️ Saldo insuficiente. Necesitas ${totalExpectedQ} créditos para este Test (${numQ} por página) y solo tienes ${this.creditBalance}.\nRecarga tu saldo en Ajustes.`);
            this.switchView('settings-view');
            return;
        }


        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('hidden');

        try {
            let questions = [];
            
            // MODO BATCH (Si viene de un PDF)
            if (this.currentPdfFile) {
                console.log("Iniciando MODO BATCH con selector visual...");
                
                // Extraer el texto justo ahora según el rango del selector
                const endPage = (this.currentEndPage === null) ? this.currentStartPage : this.currentEndPage;
                ProgressTracker.updateStatus(`Extrayendo texto del rango (${this.currentStartPage}-${endPage})...`);
                const extractionResult = await this.extractPdfText(this.currentPdfFile, this.currentStartPage, endPage);
                this.currentPdfPages = extractionResult.pages;
                
                const totalPages = this.currentPdfPages.length;
                const qPerPage = numQ; 
                
                for (let i = 0; i < totalPages; i++) {
                    const page = this.currentPdfPages[i];
                    ProgressTracker.updateStatus(`Generando página ${i + 1} de ${totalPages} (${qPerPage} preg/pag)...`);
                    
                    try {
                        const pageQuestions = await AIService.generateQuestions(page.text, qPerPage);
                        if (Array.isArray(pageQuestions) && pageQuestions.length > 0) {
                            // IMPORTANTE: Tomar lo que devuelva la IA (Acumulación Total)
                            pageQuestions.forEach(q => {
                                q.explicacion = `(Pág. ${page.num}) ${q.explicacion || ""}`;
                            });
                            questions = [...questions, ...pageQuestions];
                        }
                    } catch (e) {
                        console.error(`Error en página ${page.num}:`, e);
                    }
                }
                
                questions = questions.sort(() => Math.random() - 0.5);
                this.currentPdfPages = null; 

            } else {
                // MODO NORMAL (Texto libre o resumen)
                console.log("Iniciando MODO NORMAL para texto libre...");
                ProgressTracker.updateStatus("Conectando con DeepSeek...");
                questions = await AIService.generateQuestions(topic, numQ);
            }
            
            if (!questions || !Array.isArray(questions) || questions.length === 0) {
                throw new Error("La IA no pudo generar las preguntas. Reintenta con menos texto.");
            }

            this.currentIndex = 0;
            this.score = 0;
            
            console.log("Asignando preguntas generadas:", questions);
            if (!Array.isArray(questions)) {
                console.error("FORMAT ERROR: questions no es un array!", questions);
                throw new Error("Formato de IA incorrecto (no es lista).");
            }
            this.currentQuestions = questions; 
            
            // Descontar créditos
            this.creditBalance -= questions.length;
            localStorage.setItem('credit_balance', this.creditBalance);
            this.updateCreditUI();

            // Persistencia Automática con nombre personalizado o sugerido
            let rangeSuffix = "";
            const endPage = (this.currentEndPage === null) ? this.currentStartPage : this.currentEndPage;
            if (this.currentPdfFile) {
                rangeSuffix = ` (págs ${this.currentStartPage}-${endPage})`;
            }
            const finalName = (this.currentTestName || topic.split('\n')[0].substring(0, 30) || "Test IA") + rangeSuffix;
            this.saveToLibrary(`IA: ${finalName}`, questions);

            overlay.classList.add('hidden');
            this.startQuiz();

        } catch (err) {
            console.error("Error en generación:", err);
            overlay.classList.add('hidden');
            alert("Error en la IA: " + err.message + "\n\nIntenta con menos texto o un tema más claro.");
        }
    },

    triggerFilePicker(accept) {
        console.log("Abriendo selector para:", accept);
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input); // <--- AÑADIR AL DOM
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            console.log("Archivo seleccionado:", file ? file.name : "ninguno");
            document.body.removeChild(input); // <--- QUITAR DEL DOM
            if (!file) return;
            if (accept === '.txt') this.handleImportTxt(file);
            if (accept === '.pdf') this.handlePdfGeneration(file);
            if (accept === '.apkg') this.handleAnkiImport(file);
        };
        input.click();
    },

    async handleImportTxt(file) {
        const text = await file.text();
        const quizData = this.parseBiologiaTxt(text, file.name);
        if (quizData && quizData.length > 0) {
            this.currentQuestions = quizData;
            this.saveToLibrary(file.name, quizData);
            this.startQuiz();
        } else {
            alert("No se pudo detectar el formato de Biología en este archivo.");
        }
    },

    parseBiologiaTxt(text, filename) {
        const questions = [];
        const blocks = text.split(/PREGUNTA \d+:/i);
        
        // El primer bloque suele ser el encabezado
        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            const lines = block.split('\n').map(l => l.trim()).filter(l => l);
            
            const questionText = lines[0];
            const options = [];
            let correctIdx = -1;
            let explanation = "";

            lines.forEach(line => {
                if (line.match(/^[A-D]\)/i)) {
                    options.push(line);
                }
                if (line.includes("RESPUESTA CORRECTA:")) {
                    const match = line.match(/([A-D])/i);
                    if (match) {
                        const letter = match[1].toUpperCase();
                        correctIdx = letter.charCodeAt(0) - 65; // A=0, B=1...
                    }
                }
                if (line.includes("Explicación:")) {
                    explanation = block.split(/Explicación:/i)[1]?.trim() || "";
                }
            });

            if (questionText && options.length > 0 && correctIdx !== -1) {
                questions.push({
                    pregunta: questionText,
                    opciones: options,
                    correcta: correctIdx,
                    explicacion: explanation,
                    meta: { file: filename }
                });
            }
        }
        return questions;
    },

    // --- GESTIÓN DE PDF LIBRARY ---
    renderPdfLibrary() {
        const container = document.getElementById('pdf-library-list');
        if (!container) return;

        if (this.pdfLibrary.length === 0) {
            container.innerHTML = '<div class="empty-state-small">No hay PDFs subidos. Pulsa + para añadir uno.</div>';
            return;
        }

        container.innerHTML = this.pdfLibrary.map(pdf => `
            <div class="pdf-item ${this.currentPdfFile === pdf.file ? 'selected' : ''}" onclick="app.selectPdfFromLibrary(${pdf.id})">
                <div class="icon">📄</div>
                <div class="name">${pdf.name}</div>
                <div class="pages">${pdf.pages} págs</div>
            </div>
        `).join('');
    },

    selectPdfFromLibrary(id) {
        const item = this.pdfLibrary.find(p => p.id === id);
        if (item) {
            this.currentPdfFile = item.file;
            this.maxPdfPages = item.pages;
            this.currentStartPage = 1;
            this.currentEndPage = null; // Volver a poner en blanco al cambiar
            
            this.updateSelectorUI();
            this.renderPdfLibrary();
        }
    },

    updateSelectorUI() {
        const totalEl = document.getElementById('total-pdf-pages');
        const startEl = document.getElementById('val-start');
        const endEl = document.getElementById('val-end');
        if (totalEl) totalEl.textContent = this.maxPdfPages;
        if (startEl) startEl.textContent = this.currentStartPage;
        if (endEl) endEl.textContent = this.currentEndPage === null ? "--" : this.currentEndPage;
        
        const container = document.getElementById('page-range-container');
        if (container) container.classList.remove('hidden');
    },

    async handlePdfGeneration(file) {
        const overlay = document.getElementById('loading-overlay');
        try {
            if (!window.pdfjsLib) {
                throw new Error("La librería PDF.js no se ha cargado correctamente.");
            }
            
            overlay.classList.remove('hidden');
            ProgressTracker.updateStatus("Analizando PDF...");
            
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            const pdfItem = {
                id: Date.now(),
                name: file.name,
                pages: pdf.numPages,
                file: file
            };
            
            // Añadir a la biblioteca si no está (por nombre y tamaño)
            const exists = this.pdfLibrary.find(p => p.name === file.name && p.pages === pdf.numPages);
            if (!exists) {
                this.pdfLibrary.unshift(pdfItem);
            }
            
            this.selectPdfFromLibrary(pdfItem.id);
            this.switchView('config-view');
            overlay.classList.add('hidden');
            
       } catch (err) {
            console.error("PDF ERROR:", err);
            overlay.classList.add('hidden');
            alert("❌ Error al cargar PDF: " + err.message);
        }
    },

    async extractPdfText(file, start, end) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        const pages = [];
        
        const safeEnd = Math.min(end, pdf.numPages);
        const safeStart = Math.max(1, start);
        console.log(`PDF Extraction: Start=${safeStart}, End=${safeEnd}, Total Pages=${pdf.numPages}`);

        for (let i = safeStart; i <= safeEnd; i++) {
            ProgressTracker.updateStatus(`Leyendo página ${i} de ${safeEnd}...`);
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            console.log(`Página ${i} extraída: ${pageText.length} caracteres.`);
            
            const formattedPageText = `--- PÁGINA ${i} ---\n${pageText}\n\n`;
            fullText += formattedPageText;
            pages.push({ num: i, text: pageText });
        }
        console.log(`Extracción finalizada. Total acumulado: ${fullText.length} caracteres.`);
        return { fullText, pages };
    },

    saveToLibrary(name, data) {
        try {
            const library = JSON.parse(localStorage.getItem('test_library') || '[]');
            
            // Evitar duplicados exactos en el historial reciente
            const isDuplicate = library.some(t => t.name === name && t.count === data.length);
            if (isDuplicate) return;

            library.unshift({
                id: Date.now(),
                name: name,
                count: data.length,
                date: new Date().toLocaleDateString(),
                data: data
            });
            // Guardar hasta 50 tests para mayor persistencia
            localStorage.setItem('test_library', JSON.stringify(library.slice(0, 50)));
            this.renderHistory();
        } catch (err) {
            console.error("Error saving to library:", err);
        }
    },

    renderHistory() {
        try {
            const library = JSON.parse(localStorage.getItem('test_library') || '[]');
            
            // Renderizar en Home (PAGINADO)
            const recentContainer = document.getElementById('recent-list');
            const paginationContainer = document.getElementById('history-pagination');
            
            if (recentContainer) {
                if (library.length === 0) {
                    recentContainer.innerHTML = '<div class="empty-state"><p>No hay tests recientes.</p></div>';
                    if (paginationContainer) paginationContainer.classList.add('hidden');
                } else {
                    const totalPages = Math.ceil(library.length / this.itemsPerPage);
                    const start = this.currentHistoryPage * this.itemsPerPage;
                    const end = start + this.itemsPerPage;
                    const pageItems = library.slice(start, end);

                    recentContainer.innerHTML = pageItems.map(test => this.createTestCard(test)).join('');
                    
                    if (paginationContainer) {
                        paginationContainer.classList.toggle('hidden', totalPages <= 1);
                        document.getElementById('page-indicator').textContent = `Página ${this.currentHistoryPage + 1} de ${totalPages}`;
                        document.getElementById('btn-prev-page').disabled = this.currentHistoryPage === 0;
                        document.getElementById('btn-next-page').disabled = (this.currentHistoryPage + 1) >= totalPages;
                    }
                }
            }

            // Renderizar en Biblioteca (Todos)
            const libraryContainer = document.getElementById('library-list');
            if (libraryContainer) {
                if (library.length === 0) {
                    libraryContainer.innerHTML = '<div class="empty-state"><p>No hay libros importados.</p></div>';
                } else {
                    libraryContainer.innerHTML = library.map(test => this.createTestCard(test)).join('');
                }
            }
        } catch (err) {
            console.warn("Error rendering history:", err);
            localStorage.removeItem('test_library');
        }
    },

    changeHistoryPage(delta) {
        this.currentHistoryPage += delta;
        this.renderHistory();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    toggleTestSelection(id, checked) {
        if (checked) this.selectedTests.add(id);
        else this.selectedTests.delete(id);
        console.log("Tests seleccionados:", Array.from(this.selectedTests));
    },

    createTestCard(test, showDate = false) {
        const isSelected = this.selectedTests.has(test.id);
        return `
            <div class="test-card">
                <div class="test-selection" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                           onchange="app.toggleTestSelection(${test.id}, this.checked)">
                </div>
                <div class="test-info" onclick="app.loadSavedTest(${test.id})">
                    <h4>${test.name}</h4>
                    <span>${test.count} preguntas ${showDate ? '• ' + test.date : ''}</span>
                </div>
                <div class="test-icon">📝</div>
            </div>
        `;
    },

    loadSavedTest(id) {
        const library = JSON.parse(localStorage.getItem('test_library') || '[]');
        const test = library.find(t => t.id === id);
        if (test) {
            this.currentQuestions = test.data;
            this.startQuiz();
        }
    },

    async exportToAnki() {
        if (this.selectedTests.size === 0) return;
        
        ProgressTracker.updateStatus("Exportación Anki (v23)...");
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('hidden');

        try {
            const library = JSON.parse(localStorage.getItem('test_library') || '[]');
            const selectedData = library.filter(t => this.selectedTests.has(t.id));
            
            if (selectedData.length === 0) throw new Error("No hay tests seleccionados.");

            if (typeof initSqlJs !== 'function') {
                throw new Error("El motor SQL no está disponible.");
            }

            const SQL = await initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.1/${file}`
            });

            const db = new SQL.Database();
            
            db.run("BEGIN TRANSACTION");

            // Esquema Anki 2.1 estándar
            db.run(`CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)`);
            db.run(`CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld text not null, csum integer not null, flags integer not null, data text not null)`);
            db.run(`CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null)`);
            db.run(`CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null)`);
            db.run(`CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null)`);

            const now = Math.floor(Date.now() / 1000);
            const mid = Date.now();
            const did = Date.now() + 1;

            // Modelo compatible (Basic)
            const models = {};
            models[mid.toString()] = {
                id: mid, name: "TestIA_Model", type: 0, mod: now, usn: -1,
                flds: [{ name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 }, { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }],
                tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}" }],
                css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
                did: did
            };

            const deckName = selectedData.length === 1 ? selectedData[0].name : "Test IA Pack";
            const decks = {
                "1": { id: 1, mod: now, name: "Default", desc: "", collapsed: false, browserCollapsed: false, usn: -1, conf: 1 },
                [did.toString()]: { id: did, mod: now, name: deckName, desc: "Generado con Test IA", collapsed: false, browserCollapsed: false, usn: -1, conf: 1 }
            };

            // DCONF COMPLETO (Estructura de fábrica Anki 2.1)
            const dconf = {
                "1": {
                    id: 1, mod: now, name: "Default", usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
                    new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20, bury: false },
                    rev: { perDay: 200, ivlFct: 1, maxIvl: 36500, bury: false, hardFactor: 1.2, minSpace: 1 },
                    lapse: { delays: [10], mult: 0, minInt: 1, leechAction: 0, leechCutoff: 8 },
                    dyn: false
                }
            };
            
            // CONF COMPLETO
            const conf = JSON.stringify({
                nextPos: 1, est: true, activeDecks: [1], sortType: "noteFld", sortBackwards: false, 
                addToCur: true, curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, 
                estTimes: true, dueCounts: true, curModel: mid.toString()
            });

            db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", 
                [now, now, now, conf, JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf)]
            );

            const stmtNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, '', ?, ?, 0, 0, '')");
            const stmtCard = db.prepare("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");

            let noteCount = 0;
            const ts = Date.now();

            for (const test of selectedData) {
                for (const q of test.data) {
                    const nid = ts + noteCount;
                    const guid = Math.random().toString(36).substring(2, 10);
                    
                    const front = `<b>${test.name}</b><br><br>${q.pregunta}`;
                    let back = `Respuesta: <b>${q.respuesta}</b><br><br>`;
                    if (q.opciones) back += "<ul><li>" + q.opciones.join("</li><li>") + "</li></ul>";
                    if (q.explicacion) back += `<br><div style='color:#6366f1; font-size: 0.9em;'>💡 ${q.explicacion}</div>`;

                    stmtNote.run([nid, guid, mid, now, `${front}\u001f${back}`, front]);
                    stmtCard.run([nid + 1, nid, did, now, noteCount]);
                    noteCount += 2;
                }
            }

            stmtNote.free();
            stmtCard.free();
            db.run("COMMIT");

            const binaryDb = db.export();
            db.close();

            const blob = new Blob([binaryDb], { type: "application/octet-stream" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `Importar_en_Anki.anki2`;
            link.click();

            this.selectedTests.clear();
            this.renderHistory();
            overlay.classList.add('hidden');
            
            alert("¡Fichero generado! Para instalarlo:\n\n1. Abre AnkiDroid.\n2. Pulsa 3 puntos -> Importar.\n3. Selecciona 'Cuestionario_Anki.anki2' en tu carpeta Descargas.");

        } catch (err) {
            console.error("DEBUG ANKI:", err);
            overlay.classList.add('hidden');
            alert("Error: " + err.message);
        }
    },

    startQuiz() {
        this.switchView('quiz-view');
        this.renderQuestion();
    },

    renderQuestion() {
        const q = this.currentQuestions[this.currentIndex];
        
        // Actualizar contador y progreso
        document.getElementById('quiz-counter').textContent = `Pregunta ${this.currentIndex + 1} de ${this.currentQuestions.length}`;
        const progress = ((this.currentIndex) / this.currentQuestions.length) * 100;
        document.getElementById('progress-fill').style.width = `${progress}%`;

        // Renderizar pregunta
        document.getElementById('question-text').textContent = q.pregunta;
        
        const container = document.getElementById('options-container');
        container.innerHTML = '';
        document.getElementById('btn-next').classList.add('hidden');
        
        // Ocultar explicación anterior
        const explContainer = document.getElementById('explanation-container');
        if (explContainer) explContainer.classList.add('hidden');

        // Renderizar opciones
        q.opciones.forEach((opt, idx) => {
            const div = document.createElement('div');
            div.className = 'option-item';
            div.textContent = opt;
            div.onclick = () => this.checkAnswer(idx, div);
            container.appendChild(div);
        });
    },

    checkAnswer(selectedIdx, element) {
        const q = this.currentQuestions[this.currentIndex];
        const options = document.querySelectorAll('.option-item');
        
        // Bloquear más clics
        options.forEach(opt => opt.onclick = null);

        if (selectedIdx === q.correcta) {
            element.classList.add('correct');
            this.score++;
            // Si estábamos en modo repaso, eliminar del banco de errores
            this.removeFromFailed(q.pregunta);
        } else {
            element.classList.add('wrong');
            options[q.correcta].classList.add('correct');
            // Guardar en el banco de errores
            this.addToFailed(q);
        }

        // Mostrar explicación (Formato Biología)
        if (q.explicacion) {
            const explContainer = document.getElementById('explanation-container');
            const explText = document.getElementById('explanation-text');
            if (explContainer && explText) {
                explText.textContent = q.explicacion;
                explContainer.classList.remove('hidden');
            }
        }

        // Mostrar botón para avanzar
        document.getElementById('btn-next').classList.remove('hidden');
    },

    nextQuestion() {
        this.currentIndex++;
        if (this.currentIndex < this.currentQuestions.length) {
            this.renderQuestion();
        } else {
            this.showResults();
        }
    },

    showResults() {
        document.getElementById('progress-fill').style.width = `100%`;
        const percentage = Math.round((this.score / this.currentQuestions.length) * 100);
        
        setTimeout(() => {
            alert(`¡Test finalizado!\n\nHas acertado ${this.score} de ${this.currentQuestions.length} (${percentage}%).`);
            this.renderHistory();
            this.updateFailedCount();
            this.switchView('home-view');
        }, 500);
    },

    // --- IMPORTACIÓN ANKI (.APKG) ---
    async handleAnkiImport(file) {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('hidden');
        ProgressTracker.updateStatus("Abriendo mazo de Anki...");

        try {
            const zip = await JSZip.loadAsync(file);
            const dbFile = zip.file("collection.anki2") || zip.file("collection.anki21");
            
            if (!dbFile) throw new Error("No se encontró la base de datos en el archivo .apkg");

            ProgressTracker.updateStatus("Extrayendo base de datos...");
            const dbBuffer = await dbFile.async("uint8array");

            // Cargar SQL.js
            const SQL = await initSqlJs({
                locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm`
            });
            const db = new SQL.Database(dbBuffer);
            
            // Extraer notas (fllds contiene los campos separados por 0x1f)
            const res = db.exec("SELECT flds FROM notes LIMIT 100");
            if (!res || res.length === 0) throw new Error("El mazo de Anki está vacío.");

            const notes = res[0].values.map(row => {
                const fields = row[0].split('\x1f');
                return fields;
            });

            // Preguntar si quiere usar IA o Importación Directa
            const mode = confirm("¿Quieres usar la IA para organizar el test? (Aceptar = SI, Cancelar = Importación Directa sin IA)");
            
            let quizData;
            if (mode) {
                ProgressTracker.updateStatus(`Procesando ${notes.length} fichas con la IA...`);
                quizData = await AIService.transformAnkiToQuiz(notes, file.name);
            } else {
                ProgressTracker.updateStatus(`Transformando ${notes.length} fichas localmente...`);
                quizData = this.parseAnkiToQuizDirect(notes);
            }
            
            if (!quizData || quizData.length === 0) throw new Error("No se pudieron extraer preguntas válidas.");

            this.currentQuestions = quizData;
            this.saveToLibrary(`Anki: ${file.name.replace('.apkg', '')}`, quizData);
            
            overlay.classList.add('hidden');
            this.startQuiz();

        } catch (err) {
            console.error("Error Anki:", err);
            overlay.classList.add('hidden');
            alert("Error al importar Anki: " + err.message);
        }
    },

    parseAnkiToQuizDirect(notes) {
        return notes.map(fields => {
            const clean = (t) => {
                if (!t) return "";
                // Convertir estructura de botones/divs en saltos de línea para extraer opciones
                return t.replace(/<(div|p|br|li|td|button|a)[^>]*>/gi, '\n')
                        .replace(/<\/(div|p|li|td|button|a)>/gi, '\n')
                        .replace(/<[^>]*>/g, '')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/&[a-z0-9#]+;/gi, ' ')
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .join('\n');
            };

            // Mapeo Fijo según especificación del usuario (7 campos):
            // 0: Pregunta
            // 1: Opciones (Texto)
            // 2: OpcionesBotones (HTML)
            // 3: Respuesta (Letra/Valor)
            // 4: Explicacion
            // 5: Id
            // 6: Fuente

            const question = clean(fields[0]);
            const rawOptions = fields[2] || fields[1] || ""; // Preferimos el bloque de botones si existe
            const correctVal = clean(fields[3]);

            // BUSQUEDA QUIRÚRGICA DE EXPLICACIÓN Y FUENTE (Campos 4-8)
            let explanation = "";
            let finalFuente = "";
            const isNumeric = (s) => /^\d+$/.test(s);

            // Pasada 1: Encontrar la Fuente (el campo que tiene .txt o es el indicado como fuente)
            for (let i = 4; i <= 8; i++) {
                const f = clean(fields[i]);
                if (f.toLowerCase().includes('.txt')) {
                    finalFuente = f;
                    break;
                }
            }

            // Pasada 2: Encontrar la Explicación (el primer campo con texto que no sea Fuente ni ID numérico)
            for (let i = 4; i <= 8; i++) {
                const f = clean(fields[i]);
                if (!f || isNumeric(f) || f === finalFuente) continue;
                explanation = f;
                break;
            }
            
            // Fallbacks de seguridad
            if (!explanation) explanation = "Sin explicación adicional.";
            if (!finalFuente) {
                // Si no hay .txt, buscamos un campo corto de texto en los índices finales
                for (let i = 6; i <= 8; i++) {
                    const f = clean(fields[i]);
                    if (f && !isNumeric(f) && f !== explanation) {
                        finalFuente = f;
                        break;
                    }
                }
            }

            // Extraer las 4 opciones del bloque
            const optParts = clean(rawOptions).split('\n').filter(s => s.length > 1);
            
            // Tomamos exactamente 4 si es posible, si hay menos o más, intentamos ajustar
            let finalOptions = optParts.slice(0, 4);

            // Si no salieron 4 del bloque, quizás los campos 1-4 son las opciones
            if (finalOptions.length < 4 && rawOptions === fields[2]) {
                const altParts = clean(fields[1]).split('\n').filter(s => s.length > 1);
                if (altParts.length >= 4) finalOptions = altParts.slice(0, 4);
            }

            // Formatear con letras limpias (A, B, C, D)
            const formattedOptions = finalOptions.map((opt, idx) => {
                const cleanOpt = opt.replace(/^[A-D][\)\.\s-]\s*/i, '').trim();
                const letter = String.fromCharCode(65 + idx);
                return `${letter}) ${cleanOpt}`;
            });

            // Detectar respuesta correcta por la letra (A, B, C, D)
            let correctIdx = 0;
            const ansChar = correctVal.toUpperCase().trim();
            if ("ABCD".includes(ansChar.charAt(0))) {
                correctIdx = "ABCD".indexOf(ansChar.charAt(0));
            } else {
                // Si la respuesta no es la letra, buscamos el texto en las opciones
                const found = formattedOptions.findIndex(o => o.toUpperCase().includes(ansChar.substring(0, 15)));
                if (found !== -1) correctIdx = found;
            }

            if (question && formattedOptions.length >= 2) {
                return {
                    pregunta: question,
                    opciones: formattedOptions,
                    correcta: Math.max(0, Math.min(correctIdx, formattedOptions.length - 1)),
                    explicacion: explanation + (finalFuente ? `\n\n[Fuente: ${finalFuente}]` : "")
                };
            }
            return null;
        }).filter(q => q !== null);
    },

    // --- BANCO DE ERRORES ---
    addToFailed(question) {
        const failed = JSON.parse(localStorage.getItem('failed_questions') || '[]');
        // Evitar duplicados por texto de pregunta
        if (!failed.find(q => q.pregunta === question.pregunta)) {
            failed.push(question);
            localStorage.setItem('failed_questions', JSON.stringify(failed));
        }
    },

    removeFromFailed(qText) {
        let failed = JSON.parse(localStorage.getItem('failed_questions') || '[]');
        failed = failed.filter(q => q.pregunta !== qText);
        localStorage.setItem('failed_questions', JSON.stringify(failed));
    },

    loadFailedQuiz() {
        const failed = JSON.parse(localStorage.getItem('failed_questions') || '[]');
        if (failed.length === 0) {
            alert("¡Enhorabuena! No tienes preguntas falladas en el banco de errores.");
            return;
        }
        this.currentQuestions = failed;
        this.currentIndex = 0;
        this.score = 0;
        this.startQuiz();
    },

    updateFailedCount() {
        const failed = JSON.parse(localStorage.getItem('failed_questions') || '[]');
        const countBadge = document.getElementById('failed-count');
        const btnReview = document.getElementById('btn-review-errors');
        
        if (countBadge) countBadge.textContent = failed.length;
        if (btnReview) {
            if (failed.length === 0) {
                btnReview.style.opacity = '0.5';
                btnReview.style.pointerEvents = 'none';
            } else {
                btnReview.style.opacity = '1';
                btnReview.style.pointerEvents = 'auto';
            }
        }
    },

    // --- CRÉDITOS & MONETIZACIÓN ---
    updateCreditUI() {
        const balanceEls = ['credit-balance', 'settings-credit-balance'];
        balanceEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = this.creditBalance;
        });
    },

    rechargeCredits(packKey) {
        alert("Sigue las instrucciones de Bizum arriba para recargar créditos. 😊");
    },

    redeemCode() {
        const input = document.getElementById('activation-code');
        const code = input.value.trim().toUpperCase();
        
        if (!code) {
            alert("Por favor, introduce un código.");
            return;
        }

        // --- SISTEMA DE CÓDIGOS ALFANUMÉRICOS (v42) ---
        const validCodes = {
            // Pack 1000 Preguntas
            "TK-7R2-X89": 1000, "TK-4M1-V52": 1000, "TK-9B6-L10": 1000, "TK-3N4-P77": 1000, "TK-8W2-Z41": 1000,
            "TK-5K9-S33": 1000, "TK-2H7-D68": 1000, "TK-6G5-Q94": 1000, "TK-1F8-R22": 1000, "TK-0S3-T55": 1000,
            "QA-RY7-X3D": 1000, "QA-LP4-K8G": 1000, "QA-BV2-M9S": 1000, "QA-WZ8-N1F": 1000, "QA-JH6-C5R": 1000,
            "QA-TK9-P2W": 1000, "QA-HD4-L7X": 1000, "QA-GS1-Y6Z": 1000, "QA-FR3-V0H": 1000, "QA-MN5-B2Q": 1000,
            "BT-9Z2-K4F": 1000, "BT-1X7-N8D": 1000, "BT-5V4-L2G": 1000, "BT-8C6-M9X": 1000, "BT-3R1-P5W": 1000,
            "BT-7K0-S3Z": 1000, "BT-2H5-Y1C": 1000, "BT-6G9-Q4R": 1000, "BT-0F4-D8B": 1000, "BT-4S2-T6L": 1000,
            // Maestros (Legacy)
            "WELCOME-QA": 500
        };

        if (validCodes[code]) {
            this.applyCredits(validCodes[code], code);
            input.value = "";
        } else {
            alert("❌ Código no válido. Contacta con soporte si has realizado el pago por Bizum.");
        }
    },

    initCredits() {
        const savedCredits = localStorage.getItem('credit_balance');
        if (savedCredits === null) {
            this.creditBalance = 500;
            localStorage.setItem('credit_balance', 500);
        } else {
            this.creditBalance = parseInt(savedCredits);
        }
        this.updateCreditUI();
    },

    applyCredits(amount, codeId) {
        // Evitar duplicados
        const used = JSON.parse(localStorage.getItem('used_codes') || '[]');
        if (used.includes(codeId)) {
            alert("❌ Estos créditos ya han sido canjeados.");
            return;
        }

        used.push(codeId);
        localStorage.setItem('used_codes', JSON.stringify(used));

        this.creditBalance += amount;
        localStorage.setItem('credit_balance', this.creditBalance);
        this.updateCreditUI();
        
        alert(`🎉 ¡ÉXITO! Se han añadido ${amount} preguntas a tu saldo.`);
    },

    checkStripePayment() {
        // Obsoleto en v41 (Retorno a Bizum)
    },

    adjustPage(type, delta) {
        if (type === 'start') {
            const limit = (this.currentEndPage !== null) ? this.currentEndPage : (this.maxPdfPages || 9999);
            this.currentStartPage = Math.max(1, Math.min(limit, this.currentStartPage + delta));
            document.getElementById('val-start').textContent = this.currentStartPage;
            
            // Si "Hasta" está en blanco, no forzamos nada aún
        } else {
            // Lógica para "Hasta"
            if (this.currentEndPage === null) {
                // Si estaba en blanco, inicializamos con el valor de "Desde"
                this.currentEndPage = this.currentStartPage;
            } else {
                this.currentEndPage = Math.max(this.currentStartPage, Math.min(this.maxPdfPages || 9999, this.currentEndPage + delta));
            }
            document.getElementById('val-end').textContent = this.currentEndPage;
        }
        
        // Efecto visual de rebote
        const elId = type === 'start' ? 'val-start' : 'val-end';
        const el = document.getElementById(elId);
        if (el) {
            el.style.transform = 'scale(1.2)';
            setTimeout(() => el.style.transform = 'scale(1)', 100);
        }
    }
};


document.addEventListener('DOMContentLoaded', () => app.init());
