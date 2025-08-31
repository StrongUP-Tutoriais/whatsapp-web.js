#!/bin/bash

# 🎮 Setup divertido com aviãozinho atirando em naves 🚀

# ==============================
# Cores
# ==============================
GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
BLUE="\e[34m"
CYAN="\e[36m"
RESET="\e[0m"

LOGFILE="setup.log"
echo "" > "$LOGFILE"

# ==============================
# Barra de progresso
# ==============================
show_progress() {
  local duration=$1
  local steps=40
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
# Mensagem inicial
# ==============================
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}✨ Bem-vindo ao Setup Automático ✨${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Inicia animação em paralelo
anim_pid=$!

# ==============================
# Instala dependências
# ==============================
echo -e "\n${YELLOW}📦 Instalando dependências...${RESET}"
show_progress 6 &
progress_pid=$!
if ! npm install express > /dev/null 2>>"$LOGFILE"; then
  echo -e "${RED}❌ Falha ao instalar express${RESET}"
  kill $anim_pid 2>/dev/null
  exit 1
fi
if ! npm install pm2 -g > /dev/null 2>>"$LOGFILE"; then
  echo -e "${RED}❌ Falha ao instalar pm2${RESET}"
  kill $anim_pid 2>/dev/null
  exit 1
fi
wait $progress_pid
echo -e "${GREEN}✅ Dependências instaladas com sucesso!${RESET}\n"

# ==============================
# Inicia aplicação
# ==============================
if [ -f "Unknown.js" ]; then
  echo -e "${BLUE}⚡ Iniciando ${YELLOW}Unknown.js${RESET}"
  if ! pm2 start Unknown.js --name "meu-app" >>"$LOGFILE" 2>&1; then
    echo -e "${RED}❌ Erro ao iniciar Unknown.js${RESET}"
    kill $anim_pid 2>/dev/null
    exit 1
  fi
  echo -e "${GREEN}🚀 Aplicação está rodando no PM2!${RESET}"
else
  echo -e "${RED}❌ Arquivo Unknown.js não encontrado!${RESET}"
  kill $anim_pid 2>/dev/null
  exit 1
fi

# ==============================
# Finalização
# ==============================
kill $anim_pid 2>/dev/null
echo -e "\n${GREEN}✨ Setup finalizado com sucesso! Bom uso 🚀${RESET}"
