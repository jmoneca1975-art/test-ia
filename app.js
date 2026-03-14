const app = {
    currentQuestions: [],
    currentIndex: 0,
    score: 0,
    currentPdfFile: null,
    currentTestName: "",
    
    init() {
        try {
            console.log("test_app: Inicializando...");
            // Indicador de arranque para el usuario (se quita al final)
            const debugBanner = document.createElement('div');
            debugBanner.id = "debug-init";
            debugBanner.style = "position:fixed;top:0;left:0;width:100%;background:rgba(0,0,0,0.8);color:#0f0;font-size:10px;z-index:9999;padding:2px;pointer-events:none;";
            debugBanner.textContent = "Booting v31...";
            document.body.appendChild(debugBanner);

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
        document.getElementById('btn-new-test').addEventListener('click', () => {
            // Limpiar estado previo para nuevo test manual
            this.currentTestName = "";
            document.getElementById('test-topic').value = "";
            this.switchView('config-view');
        });

        // Botón subir PDF (Generación)
        document.getElementById('btn-upload-pdf').addEventListener('click', () => {
            this.triggerFilePicker('.pdf');
        });

        // Botón importar TXT (Desde PC)
        const btnImport = document.createElement('button');
        btnImport.className = 'action-card';
        btnImport.innerHTML = `<div class="icon">📥</div><div class="label">Importar TXT</div>`;
        btnImport.onclick = () => this.triggerFilePicker('.txt');
        document.querySelector('.quick-actions').appendChild(btnImport);

        // Botón Importar Anki (.apkg)
        document.getElementById('btn-import-anki').addEventListener('click', () => {
            this.triggerFilePicker('.apkg');
        });

        // Botón Repasar Errores (Dinamizado)
        document.getElementById('btn-review-errors').addEventListener('click', () => {
            this.loadFailedQuiz();
        });

        // Chips de selección
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Generar Test
        document.getElementById('btn-start-generation').addEventListener('click', () => {
            this.generateQuiz();
        });

        // Botón siguiente pregunta
        document.getElementById('btn-next').addEventListener('click', () => {
            this.nextQuestion();
        });
    },

    switchView(viewId) {
        // Ocultar todas las vistas y mostrar la seleccionada
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');
        
        // Actualizar iconos de la barra de pestañas (Tab Bar)
        document.querySelectorAll('.tab-item').forEach(item => {
            item.classList.remove('active');
            // Si el onclick tiene el viewId, lo marcamos activo
            if (item.getAttribute('onclick')?.includes(viewId)) {
                item.classList.add('active');
            }
        });

        window.scrollTo(0, 0);
    },

    async generateQuiz() {
        const topic = document.getElementById('test-topic').value;
        const numQ = parseInt(document.querySelector('.chip.active')?.dataset.val || 5);

        if (!topic.trim()) {
            alert("Por favor, introduce un tema o extrae texto de un PDF.");
            return;
        }

        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('hidden');

        try {
            console.log("Iniciando generación para:", topic);
            ProgressTracker.updateStatus("Conectando con DeepSeek...");
            const questions = await AIService.generateQuestions(topic, numQ);
            
            if (!questions || !Array.isArray(questions) || questions.length === 0) {
                throw new Error("La IA no devolvió preguntas válidas.");
            }

            this.currentIndex = 0;
            this.score = 0;
            
            // Persistencia Automática con nombre personalizado o sugerido
            const finalName = this.currentTestName || topic.split('\n')[0].substring(0, 30) || "Test IA";
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
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = (e) => {
            const file = e.target.files[0];
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

    async handlePdfGeneration(file) {
        this.currentPdfFile = file;
        
        // Solicitar nombre del test (por defecto el nombre del archivo sin extensión)
        const defaultName = file.name.replace(/\.[^/.]+$/, "");
        const userChosenName = prompt("Nombre para este test:", defaultName);
        if (userChosenName === null) return; // Cancelado
        this.currentTestName = userChosenName || defaultName;

        const start = prompt("¿Desde qué página quieres empezar?", "1");
        const end = prompt("¿Hasta qué página?", "5");
        
        if (!start || !end) return;

        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('hidden');
        ProgressTracker.updateStatus("Extrayendo texto del PDF...");

        try {
            const textToProcess = await this.extractPdfText(file, parseInt(start), parseInt(end));
            overlay.classList.add('hidden');
            
            // Forzar navegación a config y rellenar textarea
            this.switchView('config-view');
            const topicEl = document.getElementById('test-topic');
            if (topicEl) {
                topicEl.value = textToProcess;
                topicEl.scrollTop = 0;
            }
            alert(`Se ha extraído el texto de las páginas ${start}-${end}. Ahora pulsa "Generar" para crear el test.`);
        } catch (err) {
            overlay.classList.add('hidden');
            alert("Error al extraer PDF: " + err.message);
        }
    },

    async extractPdfText(file, start, end) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        
        const safeEnd = Math.min(end, pdf.numPages);
        const safeStart = Math.max(1, start);

        for (let i = safeStart; i <= safeEnd; i++) {
            ProgressTracker.updateStatus(`Leyendo página ${i} de ${safeEnd}...`);
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            fullText += `--- PÁGINA ${i} ---\n${pageText}\n\n`;
        }
        return fullText;
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
            
            // Renderizar en Home (Recientes)
            const recentContainer = document.getElementById('recent-list');
            if (recentContainer) {
                if (library.length === 0) {
                    recentContainer.innerHTML = '<div class="empty-state"><p>No hay tests recientes.</p></div>';
                } else {
                    recentContainer.innerHTML = library.slice(0, 3).map(test => this.createTestCard(test)).join('');
                }
            }

            // Renderizar en Biblioteca
            const libraryContainer = document.getElementById('library-list');
            if (libraryContainer) {
                if (library.length === 0) {
                    libraryContainer.innerHTML = '<div class="empty-state"><p>No hay libros importados.</p></div>';
                } else {
                    libraryContainer.innerHTML = library.map(test => this.createTestCard(test)).join('');
                }
            }

            // Renderizar en Historial (Actividad)
            const historyContainer = document.getElementById('history-list');
            if (historyContainer) {
                if (library.length === 0) {
                    historyContainer.innerHTML = '<div class="empty-state"><p>No hay actividad.</p></div>';
                } else {
                    historyContainer.innerHTML = library.map(test => this.createTestCard(test, true)).join('');
                }
            }
        } catch (err) {
            console.warn("Error rendering history:", err);
            localStorage.removeItem('test_library'); // Limpiar si está corrupto
        }
    },

    createTestCard(test, showDate = false) {
        return `
            <div class="test-card" onclick="app.loadSavedTest(${test.id})">
                <div class="test-info">
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
    }
};

const ProgressTracker = {
    updateStatus(text) {
        const el = document.getElementById('loading-status');
        if (el) el.textContent = text;
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
