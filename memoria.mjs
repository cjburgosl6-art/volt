import { ChromaClient } from "chromadb";

const chroma = new ChromaClient({
  host: "localhost",
  port: 8000,
  ssl: false
});

async function obtenerEmbedding(texto) {
  const res = await fetch("http://localhost:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text",
      prompt: texto
    })
  });
  const data = await res.json();
  return data.embedding;
}

async function ejecutarDemo() {
  const coleccion = await chroma.getOrCreateCollection({ 
    name: "recuerdos_volt",
    embeddingFunction: null 
  });

  // Guardar un dato
  const miDato = "A mi dueño le gusta programar en JavaScript y está aprendiendo Java en un i7 con 32GB RAM.";
  const vectorDato = await obtenerEmbedding(miDato);

  await coleccion.add({
    ids: ["nota_1"],
    embeddings: [vectorDato],
    documents: [miDato]
  });
  console.log("✔ DATO GUARDADO EN LA MEMORIA DE VOLT.");

  // Consultar el dato
  const pregunta = "¿Qué lenguajes de programación conozco o estudio?";
  const vectorPregunta = await obtenerEmbedding(pregunta);

  const resultado = await coleccion.query({
    queryEmbeddings: [vectorPregunta],
    nResults: 1
  });

  console.log("\n RECUERDO RECUPERADO:");
  console.log(resultado.documents[0][0]);
}

ejecutarDemo();