import http from "http";
import fs from "fs";
import path from "path";
import { ChromaClient } from "chromadb";

const chroma = new ChromaClient({ host: "localhost", port: 8000, ssl: false });

// Asegurar que existan las carpetas locales
const carpetaConversaciones = path.join(process.cwd(), "conversaciones");
if (!fs.existsSync(carpetaConversaciones)) {
  fs.mkdirSync(carpetaConversaciones, { recursive: true });
}

const carpetaPersonalidades = path.join(process.cwd(), "personalidades");
if (!fs.existsSync(carpetaPersonalidades)) {
  fs.mkdirSync(carpetaPersonalidades, { recursive: true });
}

// Función para buscar información actualizada en la web usando DuckDuckGo
async function buscarEnWeb(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    const html = await res.text();
    
    const snippets = [];
    const regex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && snippets.length < 4) {
      const textoLimpio = match[1].replace(/<[^>]+>/g, '').trim();
      if (textoLimpio) snippets.push(textoLimpio);
    }

    return snippets.length > 0 ? snippets.join("\n- ") : null;
  } catch (e) {
    console.log("Error al consultar la web:", e.message);
    return null;
  }
}

async function obtenerEmbedding(texto) {
  try {
    const res = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: texto })
    });
    const data = await res.json();
    return data.embedding;
  } catch (e) {
    return null;
  }
}

async function preguntarAQwen(prompt, historial, contextoMemoria, contextoWeb, sistemaPrompt) {
  const fechaActual = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let promptEstructurado = `${sistemaPrompt || 'Eres Volt, un asistente IA amigable, inteligente y conversacional.'}\n\n`;

  promptEstructurado += `CONTEXTO TEMPORAL DEL SISTEMA:
Hoy es ${fechaActual}.\n\n`;

  promptEstructurado += `REGLAS DE INTERACCIÓN:
1. NO saludes ("Hola", "¡Hola Kris!", etc.) a menos que el usuario te esté saludando directamente en este mensaje.
2. NO es necesario preguntar todo el tiempo si puedes ayudar o si el usuario quiere hacer algo, solo hazlo la primera vez y de forma natural.
3. Si conoces el nombre del usuario (Kris), úsalo solo muy de vez en cuando y de forma natural.
4. Si recibes [INFORMACIÓN ACTUALIZADA DE LA WEB], basa tu respuesta principal en esos datos reales y recientes.
5. Consulta el [HISTORIAL RECIENTE DE LA CONVERSACIÓN] para mantener el hilo de temas hablados previamente en esta sesión.
6. Responde de forma clara, con viñetas y formato estructurado.\n\n`;

  if (contextoMemoria) {
    promptEstructurado += `[RECUERDOS DE MEMORIA PERSONAL]:\n${contextoMemoria}\n\n`;
  }

  if (contextoWeb) {
    promptEstructurado += `[INFORMACIÓN ACTUALIZADA DE LA WEB (${fechaActual})]:\n- ${contextoWeb}\n\n`;
  }

  if (historial && historial.length > 0) {
    promptEstructurado += `[HISTORIAL RECIENTE DE LA CONVERSACIÓN]:\n`;
    historial.forEach(m => {
      const rol = m.rol === 'user' ? 'USUARIO' : 'VOLT';
      promptEstructurado += `${rol}: ${m.texto}\n`;
    });
    promptEstructurado += `\n`;
  }

  promptEstructurado += `[USUARIO]: ${prompt}\n[VOLT]:`;

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5:14b",
      prompt: promptEstructurado,
      stream: false,
      options: {
        num_predict: 1024,
        temperature: 0.7
      }
    })
  });
  const data = await res.json();
  return data.response;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Endpoint para guardar chat
  if (req.method === "POST" && req.url === "/api/guardar-chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { nombreArchivo, chat } = JSON.parse(body);
        let nombreLimpio = nombreArchivo.trim().replace(/[^a-z0-9_\-\s]/gi, '_');
        if (!nombreLimpio.endsWith('.json')) nombreLimpio += '.json';

        const rutaFinal = path.join(carpetaConversaciones, nombreLimpio);
        fs.writeFileSync(rutaFinal, JSON.stringify(chat, null, 2), "utf-8");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ruta: rutaFinal }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Endpoint para guardar una personalidad
  if (req.method === "POST" && req.url === "/api/guardar-personalidad") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { nombre, prompt } = JSON.parse(body);
        let nombreLimpio = nombre.trim().replace(/[^a-z0-9_\-\s]/gi, '_');
        if (!nombreLimpio.endsWith('.json')) nombreLimpio += '.json';

        const rutaFinal = path.join(carpetaPersonalidades, nombreLimpio);
        fs.writeFileSync(rutaFinal, JSON.stringify({ nombre, prompt }, null, 2), "utf-8");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Endpoint para listar y obtener las personalidades guardadas
  if (req.method === "GET" && req.url === "/api/personalidades") {
    try {
      const archivos = fs.readdirSync(carpetaPersonalidades).filter(f => f.endsWith('.json'));
      const personalidades = archivos.map(archivo => {
        const contenido = fs.readFileSync(path.join(carpetaPersonalidades, archivo), 'utf-8');
        return { archivo, ...JSON.parse(contenido) };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, personalidades }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Endpoint para enviar el chat a la IA
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { mensaje, historial, systemPrompt } = JSON.parse(body);

        let contextoMemoria = null;
        let contextoWeb = null;

        const saludos = ["hola", "buenas", "que tal", "qué tal", "buenos dias", "buenas noches"];
        const esSaludo = saludos.some(s => mensaje.toLowerCase().trim().startsWith(s)) && mensaje.length < 15;

        const palabrasClaveWeb = ["noticia", "noticias", "actualidad", "hoy", "reciente", "evento", "ultim hora", "última hora", "lanzamiento", "ganador", "resultado", "quien gano", "quién ganó"];
        const requiereWeb = palabrasClaveWeb.some(p => mensaje.toLowerCase().includes(p));

        if (!esSaludo) {
          if (requiereWeb) {
            console.log("🔍 Buscando en la web:", mensaje);
            contextoWeb = await buscarEnWeb(mensaje);
          }

          const vectorPregunta = await obtenerEmbedding(mensaje);
          if (vectorPregunta) {
            try {
              const coleccion = await chroma.getOrCreateCollection({ name: "recuerdos_volt", embeddingFunction: null });
              const resultado = await coleccion.query({
                queryEmbeddings: [vectorPregunta],
                nResults: 1
              });

              if (resultado.documents[0]?.[0] && resultado.distances && resultado.distances[0]?.[0] < 1.3) {
                contextoMemoria = resultado.documents[0][0];
              }
            } catch (e) {
              console.log("Aviso: No se pudo consultar la memoria.");
            }
          }
        }

        const respuestaIA = await preguntarAQwen(mensaje, historial, contextoMemoria, contextoWeb, systemPrompt);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          respuesta: respuestaIA, 
          recuerdoUsado: contextoMemoria,
          webUsada: contextoWeb ? true : false 
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ respuesta: "Error al procesar la solicitud: " + err.message }));
      }
    });
    return;
  }

  // Interfaz HTML
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Asistente Local con Memoria y Web</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <style>
        :root {
          --color-accent: #dc2626;
          --color-bg-dark: #09090b;
          --color-panel: #121215;
          --color-card: #1c1c21;
          --color-border: #2e2e38;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background-color: var(--color-bg-dark); color: #f4f4f5; height: 100vh; display: flex; overflow: hidden; }
        
        .sidebar { width: 320px; background: var(--color-panel); border-right: 1px solid var(--color-border); padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; }
        .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.1rem; color: #f4f4f5; }
        .logo i { color: var(--color-accent); font-size: 1.4rem; transition: color 0.3s; }
        
        .card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; }
        .card-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #a1a1aa; letter-spacing: 0.05em; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; }
        
        label { font-size: 0.8rem; color: #d4d4d8; display: block; margin-bottom: 0.4rem; }
        input[type="text"], select, textarea { width: 100%; background: var(--color-panel); border: 1px solid var(--color-border); border-radius: 6px; padding: 0.6rem; color: #f4f4f5; font-size: 0.85rem; outline: none; margin-bottom: 0.75rem; }
        textarea { height: 75px; resize: none; font-size: 0.8rem; line-height: 1.4; }
        
        .color-picker-box { display: flex; align-items: center; justify-content: space-between; background: var(--color-panel); border: 1px solid var(--color-border); padding: 0.5rem 0.75rem; border-radius: 6px; }
        .color-picker-box span { font-size: 0.8rem; color: #d4d4d8; font-weight: 500; }
        input[type="color"] { -webkit-appearance: none; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; background: transparent; }
        input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        input[type="color"]::-webkit-color-swatch { border: 1px solid var(--color-border); border-radius: 50%; }

        .btn-action { background: var(--color-accent); border: none; color: white; width: 100%; padding: 0.6rem; border-radius: 6px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.85rem; margin-bottom: 0.5rem; transition: 0.2s; }
        .btn-action:hover { filter: brightness(1.15); }
        .btn-secondary { background: var(--color-card); color: #f4f4f5; border: 1px solid var(--color-border); }
        .btn-secondary:hover { background: #27272a; }
        .btn-danger { background: rgba(220, 38, 38, 0.15); border: 1px solid rgba(220, 38, 38, 0.4); color: #f87171; }
        .btn-danger:hover { background: rgba(220, 38, 38, 0.25); }

        .chat-list { display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; margin-top: 5px; }
        .chat-item { background: var(--color-panel); padding: 8px 10px; border-radius: 6px; font-size: 0.8rem; color: #a1a1aa; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: 1px solid transparent; }
        .chat-item:hover { border-color: var(--color-accent); color: white; }
        .chat-item.active { background: #27272a; border-color: var(--color-accent); color: white; font-weight: 600; }
        .chat-item-del { color: #ef4444; cursor: pointer; padding: 2px 5px; }

        .main-content { flex: 1; display: flex; flex-direction: column; background: var(--color-bg-dark); }
        .header { height: 50px; border-bottom: 1px solid var(--color-border); padding: 0 1.5rem; display: flex; align-items: center; justify-content: space-between; background: var(--color-panel); }
        .tag { background: #27272a; color: var(--color-accent); padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--color-border); }
        .badge-secure { color: #f87171; font-size: 0.75rem; display: flex; align-items: center; gap: 6px; }

        .chat-area { flex: 1; overflow-y: auto; padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem; align-items: center; }
        
        .welcome-box { border: 1px solid var(--color-border); background: var(--color-panel); border-radius: 12px; padding: 2.5rem; text-align: center; max-width: 650px; margin-top: auto; margin-bottom: auto; }
        .welcome-box i { font-size: 2.2rem; color: var(--color-accent); margin-bottom: 1rem; transition: color 0.3s; }
        .welcome-box h2 { font-size: 1.3rem; margin-bottom: 0.5rem; color: #f4f4f5; }
        .welcome-box p { color: #a1a1aa; font-size: 0.875rem; line-height: 1.5; }

        .message-row { width: 100%; max-width: 800px; display: flex; gap: 1rem; }
        .message-row.user { justify-content: flex-end; }
        .bubble { max-width: 85%; padding: 0.9rem 1.2rem; border-radius: 10px; font-size: 0.92rem; line-height: 1.6; }
        .bubble p { margin-bottom: 0.5rem; }
        .bubble p:last-child { margin-bottom: 0; }
        .bubble ul, .bubble ol { margin-left: 1.2rem; margin-bottom: 0.5rem; }
        .user .bubble { background: var(--color-accent); color: white; border-bottom-right-radius: 2px; transition: background 0.3s; }
        .bot .bubble { background: var(--color-panel); border: 1px solid var(--color-border); color: #f4f4f5; border-bottom-left-radius: 2px; }
        
        .info-tag { display: block; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--color-border); font-size: 0.75rem; font-style: italic; }
        .memory-info { color: #4ade80; }
        .web-info { color: #f87171; }

        .input-container { padding: 1.25rem 2rem; background: var(--color-bg-dark); border-top: 1px solid var(--color-border); display: flex; justify-content: center; }
        .input-box { width: 100%; max-width: 800px; background: var(--color-panel); border: 1px solid var(--color-border); border-radius: 10px; padding: 6px 12px; display: flex; align-items: center; gap: 10px; }
        .input-box input { border: none; margin: 0; padding: 0.6rem; font-size: 0.9rem; flex: 1; background: transparent; color: white; outline: none; }
        .btn-send { background: var(--color-accent); color: white; border: none; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.3s; }
        .btn-send:hover { filter: brightness(1.15); }
      </style>
    </head>
    <body>

      <div class="sidebar">
        <div class="logo">
          <i class="fa-solid fa-brain"></i> Asistente Local
        </div>

        <button class="btn-action" onclick="nuevaConversacion()">
          <i class="fa-solid fa-plus"></i> Nueva Conversación
        </button>

        <div class="card">
          <div class="card-title">APARIENCIA</div>
          <div class="color-picker-box">
            <span>Color principal:</span>
            <input type="color" id="accentColorPicker" value="#dc2626" oninput="cambiarColorTema(this.value)">
          </div>
        </div>

        <div class="card">
          <div class="card-title">HISTORIAL DE CHATS</div>
          <div class="chat-list" id="listaChats"></div>
        </div>

        <div class="card">
          <div class="card-title">GESTIÓN DE CHAT</div>
          <button class="btn-action btn-secondary" onclick="exportarChatJSON()">
            <i class="fa-solid fa-floppy-disk"></i> Guardar Chat en /conversaciones
          </button>
          <button class="btn-action btn-secondary" onclick="document.getElementById('importFile').click()">
            <i class="fa-solid fa-upload"></i> Cargar Chat (JSON)
          </button>
          <input type="file" id="importFile" accept=".json" style="display:none;" onchange="importarChatJSON(event)" />
          
          <button class="btn-action btn-danger" onclick="borrarChatActual()" style="margin-top:0.5rem; margin-bottom:0;">
            <i class="fa-solid fa-trash"></i> Borrar Chat Actual
          </button>
        </div>

        <!-- Tarjeta de Personalidad con Selector y Guardado -->
        <div class="card">
          <div class="card-title">PERSONALIDAD</div>
          
          <label>Cargar Personalidades:</label>
          <select id="selectPersonalidades" onchange="cargarPersonalidadSeleccionada()">
            <option value="">-- Seleccionar Guardada --</option>
          </select>

          <label>Prompt del Sistema:</label>
          <textarea id="sysPrompt">Eres Volt, un asistente personal conversacional. Hablas directo al grano, sin rodeos, formateando las listas con claridad y respondiendo siempre con la información más actual disponible.</textarea>
          
          <button class="btn-action btn-secondary" onclick="guardarPersonalidad()">
            <i class="fa-solid fa-bookmark"></i> Guardar en /personalidades
          </button>
        </div>
      </div>

      <div class="main-content">
        <div class="header">
          <span class="tag">qwen2.5:14b</span>
          <span class="badge-secure"><i class="fa-solid fa-globe"></i> Búsqueda Web Activa</span>
        </div>

        <div class="chat-area" id="chatArea"></div>

        <div class="input-container">
          <div class="input-box">
            <input type="text" id="userInput" placeholder="Escribe tu mensaje o pregunta por noticias..." onkeydown="if(event.key==='Enter') enviarMensaje()" />
            <button class="btn-send" onclick="enviarMensaje()"><i class="fa-solid fa-paper-plane"></i></button>
          </div>
        </div>
      </div>

      <script>
        let conversaciones = JSON.parse(localStorage.getItem('volt_chats') || '{}');
        let chatActualId = localStorage.getItem('volt_current_chat') || null;
        let listaPersonalidadesGuardadas = [];

        let colorGuardado = localStorage.getItem('volt_accent_color') || '#dc2626';

        function cambiarColorTema(nuevoColor) {
          document.documentElement.style.setProperty('--color-accent', nuevoColor);
          localStorage.setItem('volt_accent_color', nuevoColor);
        }

        async function inicializar() {
          document.documentElement.style.setProperty('--color-accent', colorGuardado);
          document.getElementById('accentColorPicker').value = colorGuardado;

          await cargarListaPersonalidades();

          if (!chatActualId || !conversaciones[chatActualId]) {
            nuevaConversacion();
          } else {
            renderizarHistorial();
            cargarChatArea();
          }
        }

        function guardarEnLocalStorage() {
          localStorage.setItem('volt_chats', JSON.stringify(conversaciones));
          localStorage.setItem('volt_current_chat', chatActualId);
        }

        function nuevaConversacion() {
          chatActualId = 'chat_' + Date.now();
          conversaciones[chatActualId] = {
            titulo: 'Nueva conversación',
            mensajes: []
          };
          guardarEnLocalStorage();
          renderizarHistorial();
          cargarChatArea();
        }

        function renderizarHistorial() {
          const contenedor = document.getElementById('listaChats');
          contenedor.innerHTML = '';

          const ids = Object.keys(conversaciones).reverse();
          ids.forEach(id => {
            const chat = conversaciones[id];
            const div = document.createElement('div');
            div.className = 'chat-item' + (id === chatActualId ? ' active' : '');
            div.onclick = () => cambiarChat(id);

            const spanTitle = document.createElement('span');
            spanTitle.style.overflow = 'hidden';
            spanTitle.style.textOverflow = 'ellipsis';
            spanTitle.style.whiteSpace = 'nowrap';
            spanTitle.innerText = chat.titulo;

            const iconDel = document.createElement('i');
            iconDel.className = 'fa-solid fa-times chat-item-del';
            iconDel.onclick = (e) => {
              e.stopPropagation();
              eliminarChat(id);
            };

            div.appendChild(spanTitle);
            div.appendChild(iconDel);
            contenedor.appendChild(div);
          });
        }

        function cambiarChat(id) {
          chatActualId = id;
          guardarEnLocalStorage();
          renderizarHistorial();
          cargarChatArea();
        }

        function eliminarChat(id) {
          delete conversaciones[id];
          if (chatActualId === id) {
            const ids = Object.keys(conversaciones);
            chatActualId = ids.length > 0 ? ids[ids.length - 1] : null;
          }
          if (!chatActualId) {
            nuevaConversacion();
          } else {
            guardarEnLocalStorage();
            renderizarHistorial();
            cargarChatArea();
          }
        }

        function cargarChatArea() {
          const chatArea = document.getElementById('chatArea');
          const mensajes = conversaciones[chatActualId]?.mensajes || [];

          if (mensajes.length === 0) {
            chatArea.innerHTML = \`
              <div class="welcome-box" id="welcomeBox">
                <i class="fa-solid fa-globe"></i>
                <h2>Asistente Local con Web y Memoria</h2>
                <p>Haz preguntas sobre eventos actuales, noticias de hoy o temas personales guardados.</p>
              </div>
            \`;
            return;
          }

          chatArea.innerHTML = '';
          mensajes.forEach(m => {
            let contenido = m.rol === 'bot' ? marked.parse(m.texto) : m.texto;
            let infoHTML = '';
            if (m.recuerdo) infoHTML += \`<span class="info-tag memory-info"><i class="fa-solid fa-brain"></i> Memoria consultada: "\${m.recuerdo}"</span>\`;
            if (m.web) infoHTML += \`<span class="info-tag web-info"><i class="fa-solid fa-globe"></i> Información obtenida de la Web en tiempo real</span>\`;

            chatArea.innerHTML += \`
              <div class="message-row \${m.rol}">
                <div class="bubble">
                  \${contenido}
                  \${infoHTML}
                </div>
              </div>
            \`;
          });

          chatArea.scrollTop = chatArea.scrollHeight;
        }

        function borrarChatActual() {
          if (confirm('¿Deseas vaciar todos los mensajes de este chat?')) {
            conversaciones[chatActualId].mensajes = [];
            conversaciones[chatActualId].titulo = 'Conversación vacía';
            guardarEnLocalStorage();
            renderizarHistorial();
            cargarChatArea();
          }
        }

        async function enviarMensaje() {
          const input = document.getElementById('userInput');
          const txt = input.value.trim();
          if (!txt) return;

          const welcomeBox = document.getElementById('welcomeBox');
          if (welcomeBox) welcomeBox.remove();

          const chatArea = document.getElementById('chatArea');
          const sysPrompt = document.getElementById('sysPrompt').value;

          if (conversaciones[chatActualId].mensajes.length === 0) {
            conversaciones[chatActualId].titulo = txt.length > 25 ? txt.substring(0, 25) + '...' : txt;
            renderizarHistorial();
          }

          const historialPrevio = conversaciones[chatActualId].mensajes.slice(-6);

          conversaciones[chatActualId].mensajes.push({ rol: 'user', texto: txt });
          guardarEnLocalStorage();

          chatArea.innerHTML += \`
            <div class="message-row user">
              <div class="bubble">\${txt}</div>
            </div>
          \`;

          input.value = '';
          chatArea.scrollTop = chatArea.scrollHeight;

          const tempId = 'temp-' + Date.now();
          chatArea.innerHTML += \`
            <div class="message-row bot" id="\${tempId}">
              <div class="bubble"><i class="fa-solid fa-spinner fa-spin"></i> Estoy pensando...</div>
            </div>
          \`;
          chatArea.scrollTop = chatArea.scrollHeight;

          try {
            const res = await fetch('/api/chat', {
              method: 'POST',
              body: JSON.stringify({ 
                mensaje: txt, 
                historial: historialPrevio, 
                systemPrompt: sysPrompt 
              })
            });
            const data = await res.json();

            document.getElementById(tempId).remove();

            conversaciones[chatActualId].mensajes.push({
              rol: 'bot',
              texto: data.respuesta,
              recuerdo: data.recuerdoUsado,
              web: data.webUsada
            });
            guardarEnLocalStorage();

            let infoHTML = '';
            if (data.recuerdoUsado) infoHTML += \`<span class="info-tag memory-info"><i class="fa-solid fa-brain"></i> Memoria consultada: "\${data.recuerdoUsado}"</span>\`;
            if (data.webUsada) infoHTML += \`<span class="info-tag web-info"><i class="fa-solid fa-globe"></i> Información obtenida de la Web en tiempo real</span>\`;

            const htmlRespuesta = marked.parse(data.respuesta);

            chatArea.innerHTML += \`
              <div class="message-row bot">
                <div class="bubble">
                  \${htmlRespuesta}
                  \${infoHTML}
                </div>
              </div>
            \`;
          } catch(e) {
            document.getElementById(tempId).remove();
            chatArea.innerHTML += \`
              <div class="message-row bot">
                <div class="bubble" style="color:#f87171;">Error al procesar la respuesta.</div>
              </div>
            \`;
          }

          chatArea.scrollTop = chatArea.scrollHeight;
        }

        async function exportarChatJSON() {
          const chat = conversaciones[chatActualId];
          const nombreSugerido = chat.titulo.replace(/[^a-z0-9_\-\s]/gi, '_');

          const nuevoNombre = prompt('Introduce el nombre con el que deseas guardar esta conversación:', nombreSugerido);
          if (!nuevoNombre) return;

          try {
            const res = await fetch('/api/guardar-chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nombreArchivo: nuevoNombre,
                chat: chat
              })
            });

            const data = await res.json();
            if (data.ok) {
              alert('Conversación guardada con éxito en la carpeta /conversaciones');
            } else {
              alert('Error al guardar: ' + data.error);
            }
          } catch (e) {
            alert('Error al intentar guardar el archivo JSON en el servidor.');
          }
        }

        function importarChatJSON(e) {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = function(evt) {
            try {
              const chatImportado = JSON.parse(evt.target.result);
              if (chatImportado && Array.isArray(chatImportado.mensajes)) {
                const nuevoId = 'chat_' + Date.now();
                conversaciones[nuevoId] = chatImportado;
                chatActualId = nuevoId;
                guardarEnLocalStorage();
                renderizarHistorial();
                cargarChatArea();
                alert('Conversación importada con éxito.');
              } else {
                alert('El archivo JSON no tiene un formato de conversación válido.');
              }
            } catch(err) {
              alert('Error al leer el archivo JSON.');
            }
          };
          reader.readAsText(file);
        }

        // --- Funciones de Gestión de Personalidades ---

        // --- Funciones de Gestión de Personalidades Corregidas ---

async function guardarPersonalidad() {
  const promptTxt = document.getElementById('sysPrompt').value.trim();
  if (!promptTxt) return alert('El prompt de personalidad está vacío.');

  const nombre = prompt('Escribe el nombre para esta personalidad (ej. Programador, Traductor, Casual):');
  if (!nombre) return;

  try {
    const res = await fetch('/api/guardar-personalidad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, prompt: promptTxt })
    });

    const data = await res.json();
    if (data.ok) {
      alert('Personalidad guardada con éxito en la carpeta /personalidades');
      // Volver a cargar la lista de personalidades desde el servidor
      await cargarListaPersonalidades();
    } else {
      alert('Error al guardar: ' + data.error);
    }
  } catch (e) {
    alert('Error al guardar la personalidad.');
  }
}
  async function cargarListaPersonalidades() {
  try {
    const res = await fetch('/api/personalidades');
    const data = await res.json();
    
    if (data.ok) {
      listaPersonalidadesGuardadas = data.personalidades;
      const select = document.getElementById('selectPersonalidades');
      
      // Vaciar las opciones actuales
      select.innerHTML = '';

      // Crear la opción por defecto
      const optDefault = document.createElement('option');
      optDefault.value = "";
      optDefault.innerText = "-- Seleccionar Guardada --";
      select.appendChild(optDefault);
      
      // Agregar cada personalidad guardada como nueva opción
      listaPersonalidadesGuardadas.forEach((p, idx) => {
        const opt = document.createElement('option');
        opt.value = idx.toString();
        opt.innerText = p.nombre;
        select.appendChild(opt);
      });

      // Resetear la selección al valor por defecto
      select.value = "";
    }
  } catch (e) {
    console.log('Error al obtener lista de personalidades:', e);
  }
}

function cargarPersonalidadSeleccionada() {
  const select = document.getElementById('selectPersonalidades');
  const idx = select.value;

  if (idx !== "" && listaPersonalidadesGuardadas[idx]) {
    document.getElementById('sysPrompt').value = listaPersonalidadesGuardadas[idx].prompt;
  }
}

        inicializar();
      </script>
    </body>
    </html>
  `);
});

server.listen(3000, () => {
  console.log("⚡ Servidor con Búsqueda Web Activa en: http://localhost:3000");
});