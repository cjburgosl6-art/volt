@echo off
title Iniciando Asistente IA Local

:: Asegurar que el script se ejecute desde la carpeta donde se encuentra guardado
cd /d "%~dp0"

echo ========================================
echo   1. Asegurando que Ollama esta activo
echo ========================================
start "" /min ollama serve

echo.
echo ========================================
echo   2. Iniciando ChromaDB
echo ========================================
start "ChromaDB" /min python -m chromadb.cli.cli run --path ./chroma_db

:: Tiempo de espera para que ChromaDB y Ollama respondan
echo Esperando inicializacion de servicios...
timeout /t 5 /nobreak > nul

echo.
echo ========================================
echo   3. Iniciando Servidor Node.js
echo ========================================
start "Servidor Volt" node visor.mjs

:: Esperar a que Node levante la interfaz
timeout /t 3 /nobreak > nul

echo.
echo ========================================
echo   4. Abriendo interfaz en el navegador
echo ========================================
start http://localhost:3000

exit