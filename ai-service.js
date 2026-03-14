// test_app | AI Generation Service
const AIService = {
    API_KEY: 'sk-e80246ce812f4b03b54c7d05dcd4a4b3',
    API_URL: 'https://api.deepseek.com/chat/completions',

    async generateQuestions(topic, num = 5) {
        // Límite ampliado a 100k para PDFs muy densos (20-30 páginas)
        const truncatedTopic = topic.length > 100000 ? topic.substring(0, 100000) + "..." : topic;

        const systemPrompt = `
            Eres un experto en exámenes de OPOSICIÓN y profesor avanzado.
            Tu tarea es generar un test de ${num} preguntas de nivel PROFESIONAL basado en el texto proporcionado.
            
            REGLAS CRÍTICAS:
            1. Responde UNICAMENTE con un objeto JSON válido.
            2. Formato: {"preguntas": [{"pregunta": "...", "opciones": ["A) ...", "B) ...", "C) ...", "D) ..."], "correcta": 0, "explicacion": "..."}]}
            3. COBERTURA TOTAL: Distribuye las ${num} preguntas a lo largo de TODO el texto (desde la primera página hasta la última). No te concentres solo en el principio.
            4. La "explicacion" debe ser técnica, detallada y justificar la respuesta correcta basándose en el texto.
            5. No añadas texto fuera del JSON.
            6. Dificultad ALTA.
        `;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 segundos para procesos largos

        try {
            console.log(`Generando test de ${num} preguntas sobre texto de ${truncatedTopic.length} caracteres...`);
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.API_KEY}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Analiza este texto y genera el test: ${truncatedTopic}` }
                    ],
                    temperature: 0.5,
                    max_tokens: 6000 // Aumentado para tests largos
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.text();
                console.error("AI API Error:", errorBody);
                throw new Error(`Error en el servidor de IA (${response.status})`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            
            console.log("Respuesta bruta de la IA:", content);

            try {
                // EXTRACCIÓN ULTRA-ROBUSTA DE JSON
                // Buscamos el primer '{' y el último '}'
                const firstBrace = content.indexOf('{');
                const lastBrace = content.lastIndexOf('}');
                
                if (firstBrace === -1 || lastBrace === -1) {
                    throw new Error("La respuesta no contiene un objeto JSON válido.");
                }

                const jsonStr = content.substring(firstBrace, lastBrace + 1);
                const parsed = JSON.parse(jsonStr);
                
                // Normalización de la estructura
                let questions = null;
                if (parsed.preguntas && Array.isArray(parsed.preguntas)) {
                    questions = parsed.preguntas;
                } else if (Array.isArray(parsed)) {
                    questions = parsed;
                } else if (parsed.questions && Array.isArray(parsed.questions)) {
                    questions = parsed.questions;
                }

                if (!questions || questions.length === 0) {
                    throw new Error("No se encontraron preguntas en la respuesta de la IA.");
                }
                
                return questions;
            } catch (e) {
                console.error("Fallo al parsear JSON:", e, content);
                throw new Error("Formato de respuesta ilegible. Reintenta.");
            }
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error("Tiempo de espera agotado. Prueba con menos páginas.");
            throw err;
        }
    },

    async transformAnkiToQuiz(notes, deckName) {
        // Convertir cada nota (array de campos) en una cadena descriptiva para la IA
        const notesText = notes.slice(0, 40).map((fields, i) => 
            `Nota ${i+1}: ${fields.join(' | ')}`
        ).join('\n');

        const systemPrompt = `
            Eres un experto en parseo de datos y exámenes. Te voy a pasar una lista de notas de Anki extraídas raw de la base de datos (campos separados por |).
            
            CONTEXTO: El usuario dice que estas notas "ya son tests".
            TU TAREA: Identificar la pregunta, las opciones y la respuesta correcta en cada nota y devolver un JSON estructurado.
            
            REGLAS:
            1. Formato JSON: {"preguntas": [{"pregunta": "...", "opciones": ["A)...", "B)...", "C)...", "D)..."], "correcta": índice_0_3, "explicacion": "..."}]}
            2. Si la nota ya tiene opciones (A, B, C, D), ÚSALAS tal cual.
            3. Si a la nota le faltan opciones pero tiene la respuesta correcta, genera distractores coherentes.
            4. Si los campos están desordenados, usa tu inteligencia para identificar cuál es cuál.
            5. La "explicacion" debe extraerse del campo que parezca descriptivo o generarse brevemente.
        `;

        const response = await fetch(this.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Mazo "${deckName}":\n${notesText}` }
                ],
                temperature: 0.5
            })
        });

        if (!response.ok) throw new Error("La IA no pudo procesar el mazo.");
        
        const data = await response.json();
        const content = data.choices[0].message.content;
        
        // Usamos el mismo sistema de extracción robusta
        const first = content.indexOf('{');
        const last = content.lastIndexOf('}');
        const parsed = JSON.parse(content.substring(first, last + 1));
        
        return parsed.preguntas || parsed;
    }
};
