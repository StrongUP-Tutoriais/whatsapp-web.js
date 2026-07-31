@echo off
chcp 65001 >nul

::for /f "delims=" %%P in ('dir "%~dp0srvsms" /ad /b /s 2^>nul') do (
::    set "PASTA=%%P"
::    goto :Encontrada
::)

::color 0C
::echo.
::echo [ERRO] Pasta SRVSMS nao encontrada.
::echo.
::pause
::exit /b

:::Encontrada

::echo.
::echo [OK] Pasta encontrada:
::echo.

::cd /d "%PASTA%"


:: Verifica se está como Administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Solicitando permissao de Administrador...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "PASTA=C:\Users\-WYD-\Desktop\srvsms\whatsapp-web.js"

if not exist "%PASTA%" (
    color 0C
    echo.
    echo [ERRO] Pasta nao encontrada.
    echo.
    echo %PASTA%
    echo.
    pause
    exit /b
)

echo.
echo [OK] Pasta encontrada.
echo.

cd /d "%PASTA%"


if not exist "Unknown.js" (
    color 0C
    echo.
    echo [ERRO] Arquivo Unknown.js nao encontrado.
    echo.
    pause
    exit /b
)

echo.
echo [INFO] Verificando PM2...
echo.

call "%AppData%\npm\pm2.cmd" describe Unknown >nul 2>&1

if errorlevel 1 (
    echo [INFO] Configurando bot com limite de 700MB...
	
	:: apaga qualquer instancia antiga pra garantir que pegue o limite
	call "%AppData%\npm\pm2.cmd" delete Unknown >nul 2>&1
	
	:: inicia com restart automatico se passar de 700M
    call "%AppData%\npm\pm2.cmd" start Unknown.js --max-memory-restart 700M
	
	:: salva pra voltar sozinho se reiniciar o PC
	call "%AppData%\npm\pm2.cmd" save
	
	
) else (
    echo [INFO] Reiniciando bot...
    call "%AppData%\npm\pm2.cmd" restart all
)

if errorlevel 1 (
    color 0C
    echo.
    echo [ERRO] Falha ao iniciar o PM2.
    pause
    exit /b
)

cls
color 0A

echo.
echo ================================================================================
echo.
echo  ¦¦+    ¦¦+¦¦+  ¦¦+ ¦¦¦¦¦+ ¦¦¦¦¦¦¦¦+¦¦¦¦¦¦¦+ ¦¦¦¦¦+ ¦¦¦¦¦¦+ ¦¦¦¦¦¦+
echo  ¦¦¦    ¦¦¦¦¦¦  ¦¦¦¦¦+--¦¦++--¦¦+--+¦¦+----+¦¦+--¦¦+¦¦+--¦¦+¦¦+--¦¦+
echo  ¦¦¦ ¦+ ¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦   ¦¦¦   ¦¦¦¦¦¦¦+¦¦¦¦¦¦¦¦¦¦¦¦¦¦++¦¦¦¦¦¦++
echo  ¦¦¦¦¦¦+¦¦¦¦¦+--¦¦¦¦¦+--¦¦¦   ¦¦¦   +----¦¦¦¦¦+--¦¦¦¦¦+---+ ¦¦+---+
echo  +¦¦¦+¦¦¦++¦¦¦  ¦¦¦¦¦¦  ¦¦¦   ¦¦¦   ¦¦¦¦¦¦¦¦¦¦¦  ¦¦¦¦¦¦     ¦¦¦
echo   +--++--+ +-+  +-++-+  +-+   +-+   +------++-+  +-++-+     +-+
echo.
echo ================================================================================
echo.
echo                    STATUS: ONLINE E FUNCIONANDO
echo.
echo ================================================================================
echo.

pause