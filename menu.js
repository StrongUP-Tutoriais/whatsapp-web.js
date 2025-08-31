const MENU_EXPIRATION = 24 * 60 * 60 * 1000; // 24h em milissegundos
const MENU_TIMEOUT = 180000; // 3 minutos
const MAX_INVALID_ATTEMPTS = 2;

const usersLastInteraction = new Map();
const usersInSupport = new Map();
const invalidResponseCount = new Map(); // Contador de erros do usuário

const menuMessage = `
🌐 *Bem-vindo ao Provedor XYZ!*
Escolha uma opção:
1️⃣ - Suporte Técnico
2️⃣ - Informações sobre Planos
3️⃣ - Financeiro
4️⃣ - Falar com um Atendente
5️⃣ - Sair do Menu
`;

/**
 * Função simulada de NLP.
 * Em um cenário real, integre com Dialogflow, Watson Assistant ou outro serviço.
 * Retorna um objeto com a ação sugerida e a confiança.
 */
async function interpretMessage(message) {
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('problema') || lowerMsg.includes('suporte')) {
    return { action: 'SUPORTE_TECNICO', confidence: 0.9 };
  } else if (lowerMsg.includes('plano') || lowerMsg.includes('internet')) {
    return { action: 'INFORMACOES_PLANOS', confidence: 0.9 };
  } else if (lowerMsg.includes('boleto') || lowerMsg.includes('financeiro')) {
    return { action: 'FINANCEIRO', confidence: 0.9 };
  } else if (lowerMsg.includes('atendente')) {
    return { action: 'ATENDIMENTO_HUMANO', confidence: 0.9 };
  }
  return { action: 'DESCONHECIDO', confidence: 0.5 };
}

/**
 * Reinicia o estado do usuário, removendo dados do menu, suporte e contador de erros.
 */
function resetUserState(chatId) {
  usersLastInteraction.delete(chatId);
  usersInSupport.delete(chatId);
  invalidResponseCount.delete(chatId);
  console.log(`Usuário ${chatId} teve o estado reiniciado.`);
}

/**
 * Envia o menu para o usuário e atualiza o timestamp da interação.
 */
async function sendMenu(client, chatId) {
  usersLastInteraction.set(chatId, Date.now());
  await client.sendMessage(chatId, menuMessage);
}

/**
 * Verifica se o menu deve ser enviado para o usuário.
 */
async function handleNewChat(client, msg) {
  const chatId = msg.from;
  const now = Date.now();

  // Se o usuário já está aguardando atendimento, não reenvia o menu.
  if (usersInSupport.has(chatId)) return;

  // Se já recebeu o menu nas últimas 24h, não reenvia.
  if (usersLastInteraction.has(chatId)) {
    const lastInteraction = usersLastInteraction.get(chatId);
    if (now - lastInteraction < MENU_EXPIRATION) return;
  }

  await sendMenu(client, chatId);
}

/**
 * Processa a resposta do usuário.
 * Caso a resposta não seja uma opção pré-definida, utiliza NLP para interpretar a mensagem.
 */
async function processUserResponse(client, msg) {
  const chatId = msg.from;
  const response = msg.body.trim();

  // Ignora mensagens se o menu não foi enviado
  if (!usersLastInteraction.has(chatId)) return;

  // Se o usuário já está em atendimento, apenas registra a mensagem.
  if (usersInSupport.has(chatId)) {
    await client.sendMessage(chatId, "📨 *Mensagem registrada!* Um atendente responderá em breve.");
    return;
  }

  // Se a resposta for uma opção pré-definida
  if (['1', '2', '3', '4', '5'].includes(response)) {
    switch (response) {
      case '1': // Suporte Técnico
        await client.sendMessage(
          chatId,
          "📞 *Suporte Técnico* - Prezado cliente, se estiver enfrentando problemas como lentidão, travamentos ou similar, desligue e ligue novamente seu roteador. Se o problema persistir, descreva sua situação para que possamos ajudar."
        );
        usersInSupport.set(chatId, true);
        // Após MENU_TIMEOUT, limpa o estado para permitir nova interação
        setTimeout(() => {
          usersLastInteraction.delete(chatId);
          console.log(`Usuário ${chatId} removido do menu após ${MENU_TIMEOUT / 60000} minutos de inatividade.`);
        }, MENU_TIMEOUT);
        break;

      case '2': // Informações sobre Planos
        await client.sendMessage(
          chatId,
          "💰 *Planos* - Temos planos de 100Mbps por R$99/mês e 300Mbps por R$149/mês. Deixe seu endereço e ponto de referência; nossa equipe entrará em contato em breve."
        );
        resetUserState(chatId);
        await sendMenu(client, chatId);
        break;

      case '3': // Financeiro
        await client.sendMessage(
          chatId,
          "💳 *Financeiro* - Para dúvidas sobre boletos ou questões financeiras, acesse nosso site ou fale com um atendente."
        );
        resetUserState(chatId);
        await sendMenu(client, chatId);
        break;

      case '4': // Atendimento Humano
        await client.sendMessage(
          chatId,
          "👨‍💼 *Atendimento Humano* - Por favor, descreva seu problema e um atendente responderá em breve."
        );
        usersInSupport.set(chatId, true);
        break;

      case '5': // Sair do Menu
        await client.sendMessage(
          chatId,
          "🔚 *Você saiu do menu.* Digite 'menu' para visualizar as opções novamente."
        );
        resetUserState(chatId);
        break;
    }
  } else {
    // Processa a mensagem via NLP
    const nlpResult = await interpretMessage(response);
    console.log(`NLP retornou: ${JSON.stringify(nlpResult)}`);
    
    if (nlpResult.confidence >= 0.8) {
      switch (nlpResult.action) {
        case 'SUPORTE_TECNICO':
          await client.sendMessage(
            chatId,
            "📞 *Suporte Técnico (via NLP)* - Parece que você está com algum problema. Tente reiniciar seu roteador e, se persistir, descreva sua situação para que possamos ajudar."
          );
          usersInSupport.set(chatId, true);
          break;
        case 'INFORMACOES_PLANOS':
          await client.sendMessage(
            chatId,
            "💰 *Planos (via NLP)* - Temos planos de 100Mbps por R$99/mês e 300Mbps por R$149/mês. Deixe seu endereço e ponto de referência, e entraremos em contato."
          );
          resetUserState(chatId);
          await sendMenu(client, chatId);
          break;
        case 'FINANCEIRO':
          await client.sendMessage(
            chatId,
            "💳 *Financeiro (via NLP)* - Para dúvidas sobre boletos ou questões financeiras, acesse nosso site ou fale com um atendente."
          );
          resetUserState(chatId);
          await sendMenu(client, chatId);
          break;
        case 'ATENDIMENTO_HUMANO':
          await client.sendMessage(
            chatId,
            "👨‍💼 *Atendimento Humano (via NLP)* - Por favor, descreva seu problema e um atendente responderá em breve."
          );
          usersInSupport.set(chatId, true);
          break;
        default:
          await client.sendMessage(
            chatId,
            "❌ Desculpe, não entendi sua mensagem. Por favor, escolha uma opção do menu ou digite 'menu' para visualizar as opções."
          );
      }
    } else {
      // Se a confiança estiver baixa, solicita que o usuário escolha uma opção válida
      const errorCount = invalidResponseCount.get(chatId) || 0;
      if (errorCount >= MAX_INVALID_ATTEMPTS) {
        await client.sendMessage(
          chatId,
          "⚠️ *Muitas respostas inválidas!* O atendimento foi encerrado. Digite 'menu' para recomeçar."
        );
        resetUserState(chatId);
        return;
      }
      invalidResponseCount.set(chatId, errorCount + 1);
      await client.sendMessage(
        chatId,
        "❌ Opção inválida. Por favor, escolha uma das opções do menu ou reformule sua mensagem."
      );
    }
  }
}

module.exports = { handleNewChat, processUserResponse };
