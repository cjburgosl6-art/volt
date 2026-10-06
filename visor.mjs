import http from "http";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { ChromaClient } from "chromadb";

// --- BASE DE DATOS SQLITE Y CHROMADB ---
const db = new Database("volt_database.sqlite");
const chroma = new ChromaClient({ host: "localhost", port: 8000, ssl: false });

// Crear tabla de personalidades en SQLite
db.exec(`
  CREATE TABLE IF NOT EXISTS personalidades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    prompt TEXT NOT NULL
  );
`);

const carpetaConversaciones = path.join(process.cwd(), "conversaciones");
if (!fs.existsSync(carpetaConversaciones)) fs.mkdirSync(carpetaConversaciones, { recursive: true });

const carpetaEmociones = path.join(process.cwd(), "emociones");
if (!fs.existsSync(carpetaEmociones)) fs.mkdirSync(carpetaEmociones, { recursive: true });

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
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  let promptEstructurado = `${sistemaPrompt || 'Eres Volt, un asistente IA amigable, inteligente y conversacional.'}\n\n`;
  promptEstructurado += `CONTEXTO TEMPORAL DEL SISTEMA:\nHoy es ${fechaActual}.\n\n`;
  promptEstructurado += `REGLAS DE MEMORIA Y EMOCIÓN:
1. Evalúa el tono y contexto de tu respuesta y selecciona UNA emoción base: ["normal", "pensando", "feliz", "entusiasmado", "sorprendido", "confundido", "triste", "serio"].
2. Detecta si hay datos personales permanentes para extraer en "nuevoRecuerdo", de lo contrario usa null.

FORMATO DE RESPUESTA REQUERIDO (JSON válido):
{
  "respuesta": "Tu respuesta conversacional en markdown",
  "nuevoRecuerdo": "Frase resumida del dato a recordar" o null,
  "emocion": "normal" | "pensando" | "feliz" | "entusiasmado" | "sorprendido" | "confundido" | "triste" | "serio"
}\n\n`;

  if (contextoMemoria) promptEstructurado += `[RECUERDOS EXISTENTES]:\n${contextoMemoria}\n\n`;
  if (contextoWeb) promptEstructurado += `[WEB (${fechaActual})]:\n- ${contextoWeb}\n\n`;
  if (historial && historial.length > 0) {
    promptEstructurado += `[HISTORIAL RECIENTE]:\n`;
    historial.slice(-4).forEach(m => promptEstructurado += `${m.rol === 'user' ? 'USUARIO' : 'VOLT'}: ${m.texto}\n`);
    promptEstructurado += `\n`;
  }
  promptEstructurado += `[USUARIO]: ${prompt}\n[RESPUESTA EN JSON]:`;

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5:14b",
      prompt: promptEstructurado,
      stream: false,
      format: "json",
      options: { num_ctx: 1024, num_predict: 1024, temperature: 0.5 }
    })
  });
  const data = await res.json();
  try {
    return JSON.parse(data.response);
  } catch(e) {
    return { respuesta: data.response, nuevoRecuerdo: null, emocion: "normal" };
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "GET" && req.url === "/styles.css") {
    try {
      const rutaCss = path.join(process.cwd(), "styles.css");
      const css = fs.readFileSync(rutaCss, "utf-8");
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(css);
    } catch (e) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("styles.css no encontrado");
    }
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/emociones/")) {
    try {
      const nombreImg = path.basename(req.url);
      const rutaImg = path.join(carpetaEmociones, nombreImg);
      if (fs.existsSync(rutaImg)) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(fs.readFileSync(rutaImg));
        return;
      }
    } catch (e) {}
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Imagen no encontrada");
    return;
  }

  if (req.method === "POST" && req.url === "/api/apagar") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mensaje: "Apagando..." }));
    setTimeout(() => process.exit(0), 500);
    return;
  }

  if (req.method === "POST" && req.url === "/api/guardar-chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { nombreArchivo, chat } = JSON.parse(body);
        let nombreLimpio = nombreArchivo.trim().replace(/[^a-z0-9_\-\s]/gi, '_');
        if (!nombreLimpio.endsWith('.json')) nombreLimpio += '.json';
        fs.writeFileSync(path.join(carpetaConversaciones, nombreLimpio), JSON.stringify(chat, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API SQLITE: Guardar/Actualizar Personalidad
  if (req.method === "POST" && req.url === "/api/guardar-personalidad") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { nombre, prompt } = JSON.parse(body);
        const stmt = db.prepare("INSERT INTO personalidades (nombre, prompt) VALUES (?, ?) ON CONFLICT(nombre) DO UPDATE SET prompt=excluded.prompt");
        stmt.run(nombre, prompt);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API SQLITE: Listar personalidades
  if (req.method === "GET" && req.url === "/api/personalidades") {
    try {
      const personalidades = db.prepare("SELECT * FROM personalidades ORDER BY nombre ASC").all();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, personalidades }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { mensaje, historial, systemPrompt } = JSON.parse(body);
        let contextoMemoria = null;
        let contextoWeb = null;

        const esSaludo = ["hola", "buenas", "que tal"].some(s => mensaje.toLowerCase().trim().startsWith(s)) && mensaje.length < 15;
        const requiereWeb = ["noticia", "noticias", "actualidad", "hoy", "reciente", "evento", "Tiempo"].some(p => mensaje.toLowerCase().includes(p));

        if (!esSaludo) {
          const [resWeb, vectorPregunta] = await Promise.all([
            requiereWeb ? buscarEnWeb(mensaje) : Promise.resolve(null),
            obtenerEmbedding(mensaje)
          ]);

          contextoWeb = resWeb;

          if (vectorPregunta) {
            try {
              const coleccion = await chroma.getOrCreateCollection({ name: "recuerdos_volt", embeddingFunction: null });
              const resultado = await coleccion.query({ queryEmbeddings: [vectorPregunta], nResults: 1 });
              if (resultado.documents[0]?.[0] && resultado.distances?.[0]?.[0] < 1.3) {
                contextoMemoria = resultado.documents[0][0];
              }
            } catch (e) {}
          }
        }

        const resultadoIA = await preguntarAQwen(mensaje, historial, contextoMemoria, contextoWeb, systemPrompt);
        let recuerdoGuardado = null;

        if (resultadoIA.nuevoRecuerdo) {
          try {
            const vectorNuevoRecuerdo = await obtenerEmbedding(resultadoIA.nuevoRecuerdo);
            if (vectorNuevoRecuerdo) {
              const coleccion = await chroma.getOrCreateCollection({ name: "recuerdos_volt", embeddingFunction: null });
              await coleccion.add({
                ids: ["memoria_" + Date.now()],
                embeddings: [vectorNuevoRecuerdo],
                documents: [resultadoIA.nuevoRecuerdo]
              });
              recuerdoGuardado = resultadoIA.nuevoRecuerdo;
            }
          } catch(errMem) {}
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          respuesta: resultadoIA.respuesta, 
          recuerdoUsado: contextoMemoria,
          nuevoRecuerdoGuardado: recuerdoGuardado,
          webUsada: contextoWeb ? true : false,
          emocion: resultadoIA.emocion || "normal"
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ respuesta: "Error: " + err.message, emocion: "triste" }));
      }
    });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Asistente Local con Memoria y Web</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <link rel="stylesheet" href="/styles.css">
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
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
            <input type="color" id="accentColorPicker" value="#7c3aed" oninput="cambiarColorTema(this.value)">
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

        <div class="card">
          <div class="card-title">PERSONALIDAD</div>
          <label>Cargar Personalidades:</label>
          <select id="selectPersonalidades" onchange="cargarPersonalidadSeleccionada()">
            <option value="">-- Seleccionar Guardada --</option>
          </select>

          <label>Prompt del Sistema:</label>
          <textarea id="sysPrompt">Eres Volt, un asistente personal conversacional. Hablas directo al grano, sin rodeos, formateando las listas con claridad. NO utilices emojis de colores (como 😃, 😡). En su lugar, exprésate utilizando únicamente emoticonos de texto tradicionales como ":)", ":D", ">:(", ";)", ":O" o ">_<".</textarea>
          
          <button class="btn-action btn-secondary" onclick="guardarPersonalidad()">
            <i class="fa-solid fa-bookmark"></i> Guardar en Base de Datos (SQLite)
          </button>
        </div>

        <div class="card">
          <div class="card-title">SISTEMA</div>
          <button class="btn-action btn-shutdown" onclick="apagarSistema()">
            <i class="fa-solid fa-power-off"></i> Apagar IA y Servidor
          </button>
        </div>
      </div>

      <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebarMobile()"></div>

      <div class="main-content">
        <div class="header">
          <button class="btn-menu-mobile" onclick="toggleSidebarMobile()" title="Abrir menú">
            <i class="fa-solid fa-bars"></i>
          </button>
          <span class="tag">qwen2.5:14b</span>
          <span class="badge-secure"><i class="fa-solid fa-globe"></i> Búsqueda Web y Memoria Activa</span>
        </div>

        <div class="chat-area" id="chatArea"></div>

        <div class="input-container">
          <div class="input-box">
            <input type="text" id="userInput" placeholder="Escribe tu mensaje o pregunta por noticias..." onkeydown="if(event.key==='Enter') enviarMensaje()" />
            <button class="btn-send" onclick="enviarMensaje()"><i class="fa-solid fa-paper-plane"></i></button>
          </div>
        </div>
      </div>

      <button class="toggle-drawer-btn" onclick="togglePersonaje()" title="Ocultar/Mostrar personaje">
        <i class="fa-solid fa-user"></i>
      </button>

      <div class="character-drawer" id="characterDrawer">
        <img id="voltAvatar" class="character-avatar" src="/emociones/normal1.png" onerror="this.src='https://via.placeholder.com/140/1f2937/ffffff?text=Avatar'" alt="Avatar">
        <div class="size-control">
          <i class="fa-solid fa-magnifying-glass-minus" style="font-size:0.75rem; color:#9ca3af;"></i>
          <input type="range" id="sizeSlider" min="80" max="300" value="140" oninput="cambiarTamanoPersonaje(this.value)" title="Ajustar tamaño">
          <i class="fa-solid fa-magnifying-glass-plus" style="font-size:0.75rem; color:#9ca3af;"></i>
        </div>
      </div>

      <script>
        let conversaciones = JSON.parse(localStorage.getItem('volt_chats') || '{}');
        let chatActualId = localStorage.getItem('volt_current_chat') || null;
        let listaPersonalidadesGuardadas = [];

        let colorGuardado = localStorage.getItem('volt_accent_color') || '#1a1a1a';
        let tamanoGuardado = localStorage.getItem('volt_avatar_size') || '140';

        const cantidadVariantes = {
          pensando: 2, feliz: 3, entusiasmo: 2, triste: 2, normal: 1, sorprendido: 1, confundido: 1, serio: 1
        };

        function toggleSidebarMobile() {
          const sidebar = document.querySelector('.sidebar');
          const overlay = document.getElementById('sidebarOverlay');
          sidebar.classList.toggle('open');
          overlay.classList.toggle('active');
        }

        function cambiarColorTema(nuevoColor) {
          document.documentElement.style.setProperty('--color-accent', nuevoColor);
          localStorage.setItem('volt_accent_color', nuevoColor);
        }

        function cambiarTamanoPersonaje(px) {
          const img = document.getElementById('voltAvatar');
          if (img) {
            img.style.width = px + 'px';
            img.style.height = px + 'px';
          }
          localStorage.setItem('volt_avatar_size', px);
        }

        function togglePersonaje() {
          document.getElementById('characterDrawer').classList.toggle('closed');
        }

        function cambiarEmocion(emocionBase) {
          const img = document.getElementById('voltAvatar');
          const maxVariantes = cantidadVariantes[emocionBase] || 1;
          const numAleatorio = Math.floor(Math.random() * maxVariantes) + 1;
          img.src = '/emociones/' + \`\${emocionBase}\${numAleatorio}.png\`;
          img.classList.add('bounce');
          setTimeout(() => img.classList.remove('bounce'), 200);
        }

        async function inicializar() {
          cambiarColorTema(colorGuardado);
          document.getElementById('accentColorPicker').value = colorGuardado;

          const slider = document.getElementById('sizeSlider');
          if (slider) {
            slider.value = tamanoGuardado;
            cambiarTamanoPersonaje(tamanoGuardado);
          }

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
          conversaciones[chatActualId] = { titulo: 'Nueva conversación', mensajes: [] };
          guardarEnLocalStorage();
          renderizarHistorial();
          cargarChatArea();
        }

        function renderizarHistorial() {
          const contenedor = document.getElementById('listaChats');
          contenedor.innerHTML = '';
          Object.keys(conversaciones).reverse().forEach(id => {
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
            iconDel.onclick = (e) => { e.stopPropagation(); eliminarChat(id); };

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
          if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sidebar.classList.contains('open')) {
              sidebar.classList.remove('open');
              overlay.classList.remove('active');
            }
          }
        }

        function eliminarChat(id) {
          delete conversaciones[id];
          if (chatActualId === id) {
            const ids = Object.keys(conversaciones);
            chatActualId = ids.length > 0 ? ids[ids.length - 1] : null;
          }
          if (!chatActualId) nuevaConversacion();
          else {
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
                <i class="fa-solid fa-brain"></i>
                <h2>Asistente Local con Web y Memoria Inteligente</h2>
                <p>Conversa de forma fluida. Guardaré automáticamente tus preferencias relevantes para recordarlas en cualquier chat.</p>
              </div>
            \`;
            return;
          }

          chatArea.innerHTML = '';
          mensajes.forEach((m, index) => {
            let contenido = m.rol === 'bot' ? marked.parse(m.texto) : m.texto;
            let infoHTML = '';
            if (m.recuerdo) infoHTML += \`<span class="info-tag memory-info"><i class="fa-solid fa-brain"></i> Memoria consultada: "\${m.recuerdo}"</span>\`;
            if (m.nuevoRecuerdo) infoHTML += \`<span class="info-tag memory-save"><i class="fa-solid fa-floppy-disk"></i> Nuevo recuerdo guardado: "\${m.nuevoRecuerdo}"</span>\`;
            if (m.web) infoHTML += \`<span class="info-tag web-info"><i class="fa-solid fa-globe"></i> Información obtenida de la Web en tiempo real</span>\`;

            let botonesAccion = '';
            if (m.rol === 'user') {
              botonesAccion = \`
                <div class="msg-actions">
                  <i class="fa-solid fa-pen" title="Editar mensaje" onclick="editarMensaje(\${index})"></i>
                  <i class="fa-solid fa-trash" title="Borrar mensaje" onclick="borrarMensaje(\${index})"></i>
                </div>
              \`;
            }

            chatArea.innerHTML += \`
              <div class="message-row \${m.rol}">
                <div class="bubble">
                  \${contenido}
                  \${infoHTML}
                  \${botonesAccion}
                </div>
              </div>
            \`;
          });
          chatArea.scrollTop = chatArea.scrollHeight;
        }

        function borrarMensaje(index) {
          if (confirm('¿Quieres eliminar este mensaje?')) {
            const mensajes = conversaciones[chatActualId].mensajes;
            if (mensajes[index + 1] && mensajes[index + 1].rol === 'bot') mensajes.splice(index, 2);
            else mensajes.splice(index, 1);
            guardarEnLocalStorage();
            cargarChatArea();
          }
        }

        async function editarMensaje(index) {
          const mensajes = conversaciones[chatActualId].mensajes;
          const textoOriginal = mensajes[index].texto;
          const nuevoTexto = prompt('Edita tu mensaje:', textoOriginal);
          if (!nuevoTexto || nuevoTexto.trim() === '' || nuevoTexto === textoOriginal) return;

          mensajes[index].texto = nuevoTexto.trim();
          if (mensajes[index + 1] && mensajes[index + 1].rol === 'bot') mensajes.splice(index + 1, 1);

          guardarEnLocalStorage();
          cargarChatArea();

          const sysPrompt = document.getElementById('sysPrompt').value;
          const tempId = 'temp-' + Date.now();
          const chatArea = document.getElementById('chatArea');
          chatArea.innerHTML += \`<div class="message-row bot" id="\${tempId}"><div class="bubble"><i class="fa-solid fa-spinner fa-spin"></i> Regenerando respuesta...</div></div>\`;
          chatArea.scrollTop = chatArea.scrollHeight;

          cambiarEmocion('pensando');
          try {
            const res = await fetch('/api/chat', {
              method: 'POST',
              body: JSON.stringify({ mensaje: nuevoTexto.trim(), historial: mensajes.slice(0, index), systemPrompt: sysPrompt })
            });
            const data = await res.json();
            document.getElementById(tempId)?.remove();
            mensajes.splice(index + 1, 0, {
              rol: 'bot', texto: data.respuesta, recuerdo: data.recuerdoUsado, nuevoRecuerdo: data.nuevoRecuerdoGuardado, web: data.webUsada
            });
            guardarEnLocalStorage();
            cargarChatArea();
            cambiarEmocion(data.emocion || 'normal');
          } catch(e) {
            document.getElementById(tempId)?.remove();
            cambiarEmocion('triste');
          }
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

          const historialPrevio = conversaciones[chatActualId].mensajes.slice(-4);
          conversaciones[chatActualId].mensajes.push({ rol: 'user', texto: txt });
          guardarEnLocalStorage();

          const indexUser = conversaciones[chatActualId].mensajes.length - 1;
          chatArea.innerHTML += \`
            <div class="message-row user">
              <div class="bubble">\${txt}
                <div class="msg-actions">
                  <i class="fa-solid fa-pen" title="Editar mensaje" onclick="editarMensaje(\${indexUser})"></i>
                  <i class="fa-solid fa-trash" title="Borrar mensaje" onclick="borrarMensaje(\${indexUser})"></i>
                </div>
              </div>
            </div>
          \`;
          input.value = '';
          chatArea.scrollTop = chatArea.scrollHeight;

          const tempId = 'temp-' + Date.now();
          chatArea.innerHTML += \`<div class="message-row bot" id="\${tempId}"><div class="bubble"><i class="fa-solid fa-spinner fa-spin"></i> Estoy pensando...</div></div>\`;
          chatArea.scrollTop = chatArea.scrollHeight;

          cambiarEmocion('pensando');
          try {
            const res = await fetch('/api/chat', {
              method: 'POST',
              body: JSON.stringify({ mensaje: txt, historial: historialPrevio, systemPrompt: sysPrompt })
            });
            const data = await res.json();
            document.getElementById(tempId)?.remove();

            conversaciones[chatActualId].mensajes.push({
              rol: 'bot', texto: data.respuesta, recuerdo: data.recuerdoUsado, nuevoRecuerdo: data.nuevoRecuerdoGuardado, web: data.webUsada
            });
            guardarEnLocalStorage();

            let infoHTML = '';
            if (data.recuerdoUsado) infoHTML += \`<span class="info-tag memory-info"><i class="fa-solid fa-brain"></i> Memoria consultada: "\${data.recuerdoUsado}"</span>\`;
            if (data.nuevoRecuerdoGuardado) infoHTML += \`<span class="info-tag memory-save"><i class="fa-solid fa-floppy-disk"></i> Nuevo recuerdo guardado: "\${data.nuevoRecuerdoGuardado}"</span>\`;
            if (data.webUsada) infoHTML += \`<span class="info-tag web-info"><i class="fa-solid fa-globe"></i> Información obtenida de la Web en tiempo real</span>\`;

            chatArea.innerHTML += \`<div class="message-row bot"><div class="bubble">\${marked.parse(data.respuesta)}\${infoHTML}</div></div>\`;
            cambiarEmocion(data.emocion || 'normal');
          } catch(e) {
            document.getElementById(tempId)?.remove();
            cambiarEmocion('triste');
          }
          chatArea.scrollTop = chatArea.scrollHeight;
        }

        async function exportarChatJSON() {
          const chat = conversaciones[chatActualId];
          const nuevoNombre = prompt('Introduce el nombre con el que deseas guardar esta conversación:', chat.titulo.replace(/[^a-z0-9_\-\s]/gi, '_'));
          if (!nuevoNombre) return;

          try {
            const res = await fetch('/api/guardar-chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombreArchivo: nuevoNombre, chat: chat })
            });
            const data = await res.json();
            if (data.ok) alert('Conversación guardada con éxito.');
          } catch (e) { alert('Error al guardar.'); }
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
              }
            } catch(err) {}
          };
          reader.readAsText(file);
        }

        async function guardarPersonalidad() {
          const promptTxt = document.getElementById('sysPrompt').value.trim();
          if (!promptTxt) return alert('Prompt vacío.');
          const nombre = prompt('Nombre de personalidad:');
          if (!nombre) return;

          try {
            const res = await fetch('/api/guardar-personalidad', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombre, prompt: promptTxt })
            });
            const data = await res.json();
            if (data.ok) await cargarListaPersonalidades();
          } catch (e) {}
        }

        async function cargarListaPersonalidades() {
          try {
            const res = await fetch('/api/personalidades');
            const data = await res.json();
            if (data.ok) {
              listaPersonalidadesGuardadas = data.personalidades;
              const select = document.getElementById('selectPersonalidades');
              select.innerHTML = '<option value="">-- Seleccionar Guardada --</option>';
              listaPersonalidadesGuardadas.forEach((p, idx) => {
                const opt = document.createElement('option');
                opt.value = idx.toString();
                opt.innerText = p.nombre;
                select.appendChild(opt);
              });
            }
          } catch (e) {}
        }

        function cargarPersonalidadSeleccionada() {
          const idx = document.getElementById('selectPersonalidades').value;
          if (idx !== "" && listaPersonalidadesGuardadas[idx]) {
            document.getElementById('sysPrompt').value = listaPersonalidadesGuardadas[idx].prompt;
          }
        }

        async function apagarSistema() {
          if (confirm('¿Seguro que deseas apagar el servidor?')) {
            try { await fetch('/api/apagar', { method: 'POST' }); } catch (e) {}
            window.close();
            document.body.innerHTML = '<div style="color: white; text-align: center; margin-top: 20%;">Servidor apagado correctamente.</div>';
          }
        }

        window.toggleSidebarMobile = toggleSidebarMobile;
        window.nuevaConversacion = nuevaConversacion;
        window.cambiarColorTema = cambiarColorTema;
        window.cambiarTamanoPersonaje = cambiarTamanoPersonaje;
        window.exportarChatJSON = exportarChatJSON;
        window.importarChatJSON = importarChatJSON;
        window.borrarChatActual = borrarChatActual;
        window.guardarPersonalidad = guardarPersonalidad;
        window.cargarPersonalidadSeleccionada = cargarPersonalidadSeleccionada;
        window.apagarSistema = apagarSistema;
        window.enviarMensaje = enviarMensaje;
        window.togglePersonaje = togglePersonaje;
        window.editarMensaje = editarMensaje;
        window.borrarMensaje = borrarMensaje;

        inicializar();
      </script>
    </body>
    </html>
  `);
});

server.listen(3000, "0.0.0.0", () => {
  console.log("Servidor listo, espera un poco y podrás empezar");
});