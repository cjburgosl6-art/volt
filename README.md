================================================================================
⚡ Volt — Asistente IA Local con Memoria y Búsqueda Web
================================================================================

Volt es un asistente virtual de inteligencia artificial impulsado por un modelo 
local (Qwen 2.5 14B) que se ejecuta completamente en tu equipo. Combina 
almacenamiento de memoria semántica persistente mediante una base de datos 
vectorial y capacidad de consulta a la web en tiempo real, ofreciendo una 
interfaz web moderna, responsiva y adaptable tanto para PC como para 
dispositivos móviles.


--------------------------------------------------------------------------------
🚀 CARACTERÍSTICAS PRINCIPALES
--------------------------------------------------------------------------------

- Modelo Local Privado:
  Funciona mediante Ollama utilizando el modelo qwen2.5:14b. No depende de 
  suscripciones ni envía tus datos a servidores externos.

- Memoria Persistente (RAG Vectorial):
  Guarda automáticamente datos clave sobre tus gustos, proyectos o datos 
  personales en ChromaDB mediante embeddings (nomic-embed-text). Recupera el 
  contexto adecuado cuando le haces una pregunta relacionada.

- Búsqueda Web en Tiempo Real:
  Realiza consultas automáticas a internet para responder con información 
  actualizada (noticias, tiempo, eventos actuales).

- Gestión de Personalidades y Prompts:
  Guarda y cambia entre distintas personalidades mediante una base de datos 
  SQLite integrada.

- Interfaz de Usuario Estilo App (Responsive):
  * Menú lateral desplegable (drawer) optimizado para pantallas táctiles.
  * Selector de color de tema en tiempo real.
  * Avatar animado que reacciona con expresiones emocionales según la respuesta.
  * Ajuste dinámico para prevenir zooms molestos en navegadores móviles.

- Gestión de Historial:
  Permite crear múltiples conversaciones, editarlas, eliminar mensajes 
  puntuales o exportar e importar chats en formato JSON.


--------------------------------------------------------------------------------
🛠️ CÓMO FUNCIONA (ARQUITECTURA DEL SISTEMA)
--------------------------------------------------------------------------------

El proyecto utiliza una arquitectura ligera sin frameworks pesados en el 
frontend:

  [ Interfaz Web (HTML / CSS / JS) ]
                |
                v
  [ Servidor Principal (visor_3.mjs) ]
         /      |      \
        /       |       \
       v        v        v
  [Ollama] [ChromaDB] [SQLite]


1. Recepción del Mensaje:
   El usuario envía un mensaje desde la interfaz web.

2. Evaluación de Intención:
   - Memoria: Se genera un embedding del mensaje con nomic-embed-text y se 
     consulta ChromaDB para recuperar recuerdos relacionados.
   - Web: Si el mensaje solicita información actual o noticias, se realiza un 
     scraping rápido a DuckDuckGo.

3. Inferencia en Ollama:
   Se compone un prompt estructurado con el contexto del sistema, memoria 
   recuperada, resultados de la web y el historial reciente de la conversación. 
   qwen2.5:14b genera una respuesta en formato JSON que incluye el texto en 
   Markdown, la emoción expresada y si se debe guardar un nuevo recuerdo.

4. Almacenamiento y Respuesta:
   Si la IA detecta una preferencia o dato relevante del usuario, genera un 
   recuerdo nuevo y lo registra en ChromaDB de forma transparente.


--------------------------------------------------------------------------------
📈 ¿CÓMO HEMOS LLEGADO AQUÍ? (EVOLUCIÓN DEL PROYECTO)
--------------------------------------------------------------------------------

El desarrollo de Volt se ha realizado de forma incremental a través de varias 
etapas:

1. Fase 1: Motor Básico y Consola
   - Configuración de Ollama y selección del modelo qwen2.5:14b.
   - Pruebas iniciales de interacción por línea de comandos para evaluar la 
     fluidez y calidad de respuesta.

2. Fase 2: Implementación de Memoria Vectorial (RAG)
   - Creación del script memoria.mjs como prueba de concepto para conectar 
     ChromaDB y Ollama embeddings.
   - Verificación de la capacidad de almacenar y recuperar recuerdos por 
     similitud semántica.

3. Fase 3: Servidor Node.js e Interfaz Web
   - Integración de un servidor HTTP básico en Node.js para servir la interfaz 
     web y gestionar la API del chat.
   - Incorporación de almacenamiento de personalidades con SQLite.
   - Integración de búsqueda web en tiempo real mediante DuckDuckGo.

4. Fase 4: Avatar Dinámico y Control Emocional
   - Implementación de análisis de sentimientos por parte del modelo para 
     devolver estados emocionales (pensando, feliz, entusiasmado, confuso, 
     triste, etc.).
   - Vinculación de estados emocionales con cambio de avatares animados e 
     interfaz gráfica.

5. Fase 5: Adaptación Móvil y Experiencia de App
   - Rediseño del CSS para soporte completo en pantallas táctiles de smartphone.
   - Creación de menú lateral desplegable (Off-Canvas Drawer) mediante botón 
     hamburguesa y capa de oscurecimiento.
   - Corrección de problemas de usabilidad en dispositivos móviles (prevención 
     de zoom automático al enfocar el cuadro de texto).


--------------------------------------------------------------------------------
📋 REQUISITOS E INSTALACIÓN
--------------------------------------------------------------------------------

Requisitos Previos:
- Node.js (v18 o superior)
- Ollama ejecutándose localmente con los modelos descargados:
    ollama pull qwen2.5:14b
    ollama pull nomic-embed-text
- ChromaDB corriendo localmente en el puerto 8000:
    chroma run --host localhost --port 8000

Pasos de Instalación:
1. Clona el repositorio o copia los archivos del proyecto a una carpeta.
2. Instala las dependencias del proyecto ejecutando:
    npm install better-sqlite3 chromadb
3. Inicia el servidor principal ejecutando:
    node visor_3.mjs
4. Abre tu navegador e ingresa a:
    - En el PC: http://localhost:3000
    - En tu móvil (misma red Wi-Fi): http://<IP-DE-TU-PC>:3000


--------------------------------------------------------------------------------
📱 ACCESO RÁPIDO DESDE EL MÓVIL
--------------------------------------------------------------------------------

Para evitar escribir la dirección IP cada vez que quieras interactuar con Volt 
desde tu smartphone:

1. Abre la dirección http://<IP-DE-TU-PC>:3000 en Chrome en tu teléfono Android.
2. Despliega el menú de opciones (los 3 puntos verticales).
3. Selecciona "Añadir a la pantalla de inicio" (o "Instalar aplicación").
4. Se creará un acceso directo en tu escritorio que abrirá la IA directamente 
   como si fuera una app nativa.

(Nota: Tu PC debe estar encendido y corriendo el servidor para poder conectarte).