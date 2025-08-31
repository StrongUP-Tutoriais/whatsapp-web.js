#!/bin/bash

# Verifica se o script está sendo executado como root
if [ "$EUID" -ne 0 ]; then
  echo "Por favor, execute como root ou use sudo!"
  exit
fi

# Função para exibir barra de progresso
show_progress() {
  local duration=$1
  local steps=50
  local progress=0
  local completed=""

  echo -n "Progresso: ["
  while [ $progress -le $steps ]; do
    completed=$(printf "%-${progress}s" "#" | tr ' ' '#')
    printf "\rProgresso: [%-${steps}s] %d%%" "$completed" $((progress * 2))
    sleep $((duration / steps))
    progress=$((progress + 1))
  done
  echo -e "]\n"
}

# Mensagem inicial
echo "INICIANDO SCRIPT"

# Instala as dependências do projeto com barra de progresso
echo "Instalando dependências necessárias..."
show_progress 5 &
progress_pid=$!
npm install express > /dev/null 2>&1 && npm install pm2 -g > /dev/null 2>&1
wait $progress_pid
echo "Dependências instaladas com sucesso."

# Inicia o arquivo 'Unknown.js' com PM2
if [ -f "Unknown.js" ]; then
  echo "Iniciando o arquivo Unknown.js com PM2..."
  pm2 start Unknown.js --name "meu-app"
  echo "Aplicação gerenciada pelo PM2!"
else
  echo "Erro: Arquivo 'Unknown.js' não encontrado!"
fi

# Lista os processos do PM2
#pm2 list
