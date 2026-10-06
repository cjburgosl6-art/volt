@echo off
title Sistema Volt IA - Servidores
echo ============================================
echo   Iniciando Entorno Completo de Volt IA
echo ============================================

:: 1. Iniciar ChromaDB en una ventana secundaria en segundo plano
echo [1/3] Lanzando Servidor de Memoria ChromaDB (Puerto 8000)...
start "Volt - ChromaDB" cmd /k "python -m uvicorn chromadb.app:app --host 127.0.0.1 --port 8000"

:: Esperar 3 segundos a que ChromaDB levante
timeout /t 3 /nobreak > nul

:: 2. Asegurar que Ollama esté activo (en segundo plano)
echo [2/3] Verificando servicio de Ollama...
start "Volt - Ollama" /min ollama serve

:: 3. Iniciar el servidor Web Node.js
echo [3/3] Iniciando Servidor Web Volt (Puerto 3000)...
start http://localhost:3000
node visor.mjs

pause