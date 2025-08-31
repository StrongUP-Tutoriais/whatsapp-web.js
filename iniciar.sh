#!/bin/bash

# 🎯 Script interativo de setup com estilo, emojis e prevenção de erros

# ==============================
# Cores
# ==============================
GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
BLUE="\e[34m"
CYAN="\e[36m"
RESET="\e[0m"

# ==============================
# Função de log
# ==============================
LOGFILE="setup.log"
echo "" > "$LOGFILE" # limpa log no início

log_error() {
  echo -e "${RED}❌ ERRO: $1${RESET}"
  echo "[ERRO] $(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOGFILE"
}

log_info() {
  echo "[INFO] $(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOGFILE"
}

# ==============================
# Verifica se é root
# ==============================
if [ "$EUID" -ne 0 ]; then
  log_error "Script precisa ser executado como root!"
  echo -e "${RED}⚠️  Por favor, execute como root ou use sudo!${RESET}"
  exit 1
fi

# ==============================
# Função barra de progresso
# ==============================
show_progress() {
  local duration=$1
  local steps=50
  local progress=0
  local completed=""

  echo -n "🚀 Progresso: ["
  while [ $progress -le $steps ]; do
    completed=$(printf "%-${progress}s" "#" | tr ' ' '#')
    printf "\r🚀 Progresso: [%-${steps}s] %d%%" "$completed" $((progress * 2))
    sleep $((duration / steps))
    progress=$((progress + 1))
  done
  echo -e "] ✅\n"
}

# ==============================
# Boas-vindas
# ==============================
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}✨ Bem-vindo ao Setup Automático ✨${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
sleep 1

# ==============================
# Verifica dependências essenciais
# ==============================
echo -e "${YELLOW}🔍 Verificando dependências do sistema...${RESET}"

if ! command -v npm &> /dev/null; then
  log_error "npm não encontrado! Instale Node.js antes de continuar."
  echo -e "${RED}❌ npm não encontrado. Instale Node.js (https://nodejs.org) e tente novamente.${RESET}"
  exit 1
fi

log_info "npm encontrado."

# ==============================
# Instala dependências do projeto
# ==============================
echo -e "${YELLOW}📦 Instalando dependências necessárias...${RESET}"
show_progress 5 &
progress_pid=$!
if ! npm install express > /dev/null 2>>"$LOGFILE"; then
  log_error "Falha ao instalar express"
  echo -e "${RED}❌ Erro ao instalar dependência express.${RESET}"
  kill $progress_pid 2>/dev/null
  exit 1
fi

if ! npm install pm2 -g > /dev/null 2>>"$LOGFILE"; then
  log_error "Falha ao instalar pm2 globalmente"
  echo -e "${RED}❌ Erro ao instalar o PM2.${RESET}"
  kill $progress_pid 2>/dev/null
  exit 1
fi
wait $progress_pid

echo -e "${GREEN}✅ Dependências instaladas com sucesso!${RESET}\n"
log_info "Dependências instaladas."

# ==============================
# Iniciando aplicação
# ==============================
if [ -f "Unknown.js" ]; then
  echo -e "${BLUE}⚡ Iniciando o arquivo ${YELLOW}Unknown.js${BLUE} com PM2...${RESET}"

  if ! pm2 start Unknown.js --name "meu-app" >>"$LOGFILE" 2>&1; then
    log_error "Erro ao iniciar Unknown.js com PM2"
    echo -e "${RED}❌ Falha ao iniciar aplicação com PM2.${RESET}"
    exit 1
  fi

  echo -e "${GREEN}🚀 Aplicação agora está sendo gerenciada pelo PM2!${RESET}"
  echo -e "${CYAN}💻 Para verificar, use: ${YELLOW}pm2 list${RESET}"
  log_info "Aplicação Unknown.js iniciada com sucesso."
else
  log_error "Arquivo Unknown.js não encontrado."
  echo -e "${RED}❌ Erro: Arquivo 'Unknown.js' não encontrado!${RESET}"
  exit 1
fi

# ==============================
# Finalização
# ==============================
echo -e "\n${GREEN}✨ Setup finalizado com sucesso! Bom uso do seu app 🚀${RESET}"
log_info "Setup finalizado com sucesso."
