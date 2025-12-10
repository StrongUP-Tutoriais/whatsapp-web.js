// Importação dos módulos necessários
require("./auto-loader");
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { Client, Location, Poll, List, Buttons, LocalAuth, MessageMedia } = require('./index');
const qrcodeterm = require("qrcode-terminal");
const QRCode = require('qrcode');
const { format } = require('date-fns');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const stripAnsi = require('strip-ansi');
require('dotenv').config();   // ? ESSA LINHA LÊ O ARQUIVO .env


// Configuração do rate limiter para evitar abuso de requisições
const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 100, // 100 requisições por IP
    message: 'Muitas requisições vindas deste IP, tente novamente mais tarde.',
    headers: true
});

// Configuração do logger para registrar logs no console e em arquivo
const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, message }) => {
            return `{"${timestamp}","message":"${message}"}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'SYSLOG.log' })
    ]
});

// Definição do horário comercial
const businessHours = {
    start: 8,  // 08:00
    end: 19    // 19:00
};

// Função para verificar se está dentro do horário comercial
function isWithinBusinessHours() {
    const now = new Date();
    const currentHour = now.getHours();
    return currentHour >= businessHours.start && currentHour < businessHours.end;
}

const app = express();

// Aplica o rate limiter em todas as rotas
app.use(limiter);

// Configura o body-parser para aceitar payloads grandes
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Inicializa o cliente do WhatsApp com autenticação local
const client = new Client({
    authStrategy: new LocalAuth({ client: 'User', dataPath: './sessions' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    },
});


// Variável para status do cliente WhatsApp
let clientStatus = 'disconnected';

// Evento: Mostra o progresso do carregamento do WhatsApp Web
client.on('loading_screen', (percent, message) => {
    logger.info(`LOADING SCREEN ${percent} ${message}`);
});


// Evento: Autenticação bem-sucedida
client.on('authenticated', () => {
    logger.info('AUTHENTICATED');
});

// Evento: Falha na autenticação
client.on('auth_failure', msg => {
    logger.error('AUTHENTICATION FAILURE', msg);
});

// Evento: Cliente desconectado
client.on('disconnected', (reason) => {
    clientStatus = 'disconnected'; // Atualiza status
    client.destroy();
});

// Evento: Geração de QR Code para autenticação

client.on("qr", (qr) => {
    logger.info("QR Code gerado (necessário autenticar).");
    qrcodeterm.generate(qr, { small: true }, function (qrcode) {
        logger.info(qrcode); // salva o QR em texto também no log
    });
});



// Evento: Cliente pronto para uso
client.on('ready', async () => {
    clientStatus = 'ready';
    logger.info('READY');
    const debugWWebVersion = await client.getWWebVersion();
    logger.info(`WWebVersion = ${debugWWebVersion}`);
});


// Inicializa o cliente WhatsApp
client.initialize().catch((err) => {
    logger.error('Erro ao iniciar o cliente WhatsApp:', err);
});

// LISTA DE NÚMEROS VIP QUE PODEM LIGAR 24 HORAS (coloque com 55 + DDD + número)
const numerosVIP = [
    '5585985304415',  // ? seu número
    '5585988813026',  // ? esposa, sócio, mãe, etc
    '5585989003067'   // ? outro número importante
    // adicione ou remova quantos quiser
];

// REJEITA CHAMADAS FORA DO HORÁRIO — EXCETO PARA NÚMEROS VIP
client.on('call', async (call) => {
    const numero = call.from.replace('@c.us', ''); // remove o @c.us do final

    // SE FOR VIP ? deixa tocar mesmo fora do horário
    if (numerosVIP.includes(numero)) {
        logger.info(`Chamada ACEITA 24h (VIP): ${numero}`);
        return; // não rejeita, deixa tocar
    }

    // SE NÃO FOR VIP E ESTIVER FORA DO HORÁRIO ? rejeita
    if (!isWithinBusinessHours()) {
        try {
            await call.reject();
            await client.sendMessage(call.from,
                'Fora do horário comercial (08h às 19h).\n\n' +
                'Se for urgente, me mande uma mensagem que respondo assim que possível!'
            );
            logger.warn(`Chamada rejeitada (fora do horário): ${numero}`);
        } catch (error) {
            logger.error(`Erro ao rejeitar chamada: ${error.message}`);
        }
    }
    // dentro do horário ? toca normal pra todo mundo
});

// Evento: Recebimento de mensagens
client.on('message', async msg => {
    const chatId = msg.from;
    const messageBody = msg.body.trim().toLowerCase();

    // Responde "Oi" com delay de 30s se a mensagem for "jaco"
    if (messageBody === "jaco") {
        setTimeout(() => {
            msg.reply("Oi");
            logger.warn(`Mensagem "Oi" enviada em resposta a "jaco" para ${chatId}`);
        }, 30000);
    }

    // Responde com chave Pix se detectar a palavra "pix"
    const regex = /.*pix.*/i;
    if (regex.test(msg.body)) {
        logger.warn(`Cliente pediu a chave pix: ${msg.body}`);
        const respostasPix = [
            "Chave Pix CPF: 06484729301 - Nome: Jaco Leone Amorim Melo - , ATENCAO EM BREVE NAO VAMOS MAIS ENVIAR CHAVE PIX, SO SERA POSSIVEL USAR O PIX QUE O SISTEMA ENVIAR"
        ];
        setTimeout(() => {
            const randomResponse = respostasPix[Math.floor(Math.random() * respostasPix.length)];
            msg.reply(randomResponse);
            logger.warn(`Resposta Pix enviada para ${chatId}`);
        }, 10000);
    }

});

// Endpoint: Exibe logs do sistema em HTML
app.get('/logs', async (req, res) => {
    const logFilePath = path.join(__dirname, 'SYSLOG.log');
    fs.readFile(logFilePath, 'utf8', async (err, data) => {
        if (err) return res.status(500).send('Erro ao ler o arquivo de log.');

        // Remove códigos ANSI e limita últimas 500 linhas
        let linhas = stripAnsi(data).split("\n");
        if (linhas.length > 500) linhas = linhas.slice(-500);
        const logTexto = linhas.join("\n");

        // Gera QR Code em base64 (pequeno)
        let qrDataUrl = '';
        if (clientStatus !== 'ready' && clientStatus !== 'disconnected' && client?.qr) {
            try {
                qrDataUrl = await QRCode.toDataURL(client.qr, { width: 200 });
            } catch (e) {
                console.error('Erro ao gerar QR Code:', e);
            }
        }

        const whatsappStatusText = clientStatus === 'ready' ? 'WhatsApp pronto' : 'WhatsApp offline';
        const whatsappStatusColor = clientStatus === 'ready' ? 'green' : 'red';

        const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Logs do Sistema</title>
<style>
body { margin:0; font-family:Segoe UI,Tahoma,Verdana,sans-serif; background:#f4f6f9; color:#333; display:flex; flex-direction:column; min-height:100vh;}
header { background:linear-gradient(135deg,#0062ff,#00b4d8); color:#fff; padding:20px 40px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 6px rgba(0,0,0,0.2);}
header h1 { margin:0; font-size:1.8rem; }
.status { display:flex; align-items:center; font-weight:500; }
.status-bullet { width:12px; height:12px; border-radius:50%; margin-right:8px; background-color:${whatsappStatusColor};}
.content { flex:1; margin:20px; padding:20px; background:#fff; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); overflow-y:auto; max-height:calc(100vh - 260px);}
.content pre { margin:0; font-size:0.95rem; font-family:Courier New,monospace; white-space:pre-wrap; word-wrap:break-word;}
footer { text-align:center; padding:15px; background:#222; color:#aaa; font-size:0.9rem;}
img.qr { display:block; margin:20px auto; border:2px solid #ccc; border-radius:8px; }
</style>
</head>
<body>
<header>
<h1>Logs do Sistema</h1>
<div class="status">
<span class="status-bullet"></span>
${whatsappStatusText}
</div>
</header>

<div class="content" id="logContainer">
<pre>${logTexto}</pre>
${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="QR Code de autenticação" />` : ''}
</div>

<footer>
<p>&copy; 2025 Sistema de Logs - Todos os direitos reservados</p>
</footer>

<script>
const logContainer = document.getElementById('logContainer');
logContainer.scrollTop = logContainer.scrollHeight;
</script>
</body>
</html>
        `;

        res.send(htmlContent);
    });
});

// Função utilitária: Formata número de telefone para o padrão do WhatsApp
function phoneNumberFormatter(number) {
    if (!number) return '';

    // Remove espaços e caracteres especiais
    number = number.replace(/[^0-9]/g, '');

    // Se tiver 13 dígitos começando com 55, beleza
    if (number.length >= 11 && !number.startsWith("55")) {
        number = "55" + number;
    }

    return number;
}


// ========== ENDPOINT FINAL 2025 - VERSÃO 01 (FUNCIONA 100%) ==========
app.post('/send-message', [
    body('to').isString().notEmpty(),
    body('msg').isString().notEmpty(),
    body('u').isString().notEmpty(),
    body('p').isString().notEmpty()
], async (req, res) => {
    const { to, msg, u, p } = req.body;
    const sanitizedMsg = msg.replace(/<[^>]*>?/gm, '').trim();

    if (!sanitizedMsg) {
        return res.status(400).json({ error: 'Mensagem vazia' });
    }

    try {
        let formattedNumber = phoneNumberFormatter(to);
        if (!formattedNumber || formattedNumber.length < 12) {
            return res.status(400).json({ error: 'Número inválido' });
        }

        // FORMA QUE NUNCA FALHA EM 2025
        const chatId = `${formattedNumber}@s.whatsapp.net`;

        // REMOVA O isRegisteredUser() ? ele está quebrado!
        // Se o número não existir, o sendMessage já vai dar erro (e você trata no catch)

        await client.sendMessage(chatId, sanitizedMsg);

        logger.info(`Mensagem enviada ? ${formattedNumber}`);
        res.status(200).json({ success: true, to: formattedNumber });

    } catch (error) {
        // Aqui você já sabe se o número não existe ou está bloqueado
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('no lid') || errMsg.includes('not found') || errMsg.includes('failed')) {
            logger.warn(`Número provavelmente não tem WhatsApp ou bloqueado: ${to}`);
            return res.status(400).json({ error: 'Número não tem WhatsApp ou está bloqueado' });
        }

        logger.error(`Erro inesperado ao enviar para ${to}: ${error.message}`);
        res.status(500).json({ error: 'Erro interno' });
    }
});




// ROTA OFICIAL MK-AUTH 2025 – FUNCIONA 100% COM O QUE VOCÊ ACABOU DE VER
app.post('/APIWPP/send-message', [
    body('to').isString().notEmpty(),
    body('msg').isString().notEmpty(),
    body('login').isString().notEmpty(),
    body('pass').isString().notEmpty()
], async (req, res) => {
    const { to, msg, login, pass } = req.body;

    // AUTENTICAÇÃO 100% VIA .env (sem fallback = mais seguro e limpo)
    const loginValido = process.env.API_LOGIN;
    const senhaValida = process.env.API_PASS;

    // Se não tiver .env ou faltar as variáveis, o bot simplesmente não inicia (erro claro)
    if (!loginValido || !senhaValida) {
        logger.error('ERRO: API_LOGIN ou API_PASS não definidos no arquivo .env');
        process.exit(1); // Para o bot imediatamente
    }

    if (login !== loginValido || pass !== senhaValida) {
        logger.warn(`Acesso negado MK-AUTH - IP: ${req.ip}`);
        return res.status(401).json({ success: false, error: "Login ou senha incorretos" });
    }

    // Limpa mensagem (remove HTML e deixa só texto puro + markdown do WhatsApp)
    const texto = msg.replace(/<[^>]*>/g, '').trim();
    if (!texto) return res.status(400).json({ success: false, error: "Mensagem vazia" });

    try {
        let numero = to.replace(/\D/g, ''); // remove tudo que não é número
        if (numero.length === 11) numero = '55' + numero;           // 85999999999 ? 5585999999999
        if (numero.length === 10) numero = '55' + numero;           // caso venha sem o 9
        if (!/^55\d{10,11}$/.test(numero)) {
            return res.status(400).json({ success: false, error: "Número inválido" });
        }

        const chatId = `${numero}@s.whatsapp.net`;

        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: "WhatsApp desconectado no momento" });
        }

        await client.sendMessage(chatId, texto);

        logger.info(`MK-AUTH ? Enviado para ${numero}`);
        res.json({
            success: true,
            message: "Mensagem enviada com sucesso!",
            numero: numero,
            preview: texto.substring(0, 80) + (texto.length > 80 ? "..." : "")
        });

    } catch (error) {
        logger.error(`Erro MK-AUTH ${to}: ${error.message}`);
        const err = error.message.toLowerCase();
        if (err.includes('no lid') || err.includes('not found') || err.includes('invalid')) {
            return res.status(400).json({ success: false, error: "Número sem WhatsApp ou inválido" });
        }
        res.status(500).json({ success: false, error: "Erro ao enviar mensagem" });
    }
});



// ROTA SEND-DOCUMENT – WORKAROUND ARQUIVO TEMPORÁRIO (EVITA BUG PROTOBUF 2025)
app.post('/APIWPP/send-document', async (req, res) => {
    let tempFilePath = null;
    try {
        const { to, caption = '', document, filename = 'boleto.pdf', login, pass } = req.body;

        // AUTENTICAÇÃO 100% SEGURA VIA .env
        const loginValido = process.env.API_LOGIN;
        const senhaValida = process.env.API_PASS;

        if (!loginValido || !senhaValida) {
            logger.error('ERRO: API_LOGIN ou API_PASS não definidos no .env');
            process.exit(1);
        }

        if (login !== loginValido || pass !== senhaValida) {
            return res.status(401).json({ success: false, error: 'Acesso negado' });
        }


        if (!to || !document)
            return res.status(400).json({ success: false, error: 'Faltando to ou document' });

        // Formata número
        let numero = to.replace(/\D/g, '');
        if (numero.length === 11) numero = '55' + numero;
        if (!/^55\d{10,11}$/.test(numero))
            return res.status(400).json({ success: false, error: 'Número inválido' });

        // Corrige encoding corrompido do MK-AUTH
        let base64Clean = document
            .replace(/^data:.+;base64,/, '') // Remove prefixo
            .replace(/%3D/g, '=')            // = corrompido
            .replace(/%2F/g, '/')            // / corrompido
            .replace(/%2B/g, '+')            // + corrompido
            .replace(/%0A/g, '\n')           // Nova linha
            .replace(/%0D/g, '\r');          // Carriage return

        const buffer = Buffer.from(base64Clean, 'base64');
        if (buffer.length < 5000 || buffer.length > 15 * 1024 * 1024) {
            return res.status(400).json({ success: false, error: 'PDF com tamanho inválido (5KB - 15MB)' });
        }

        // SALVA COMO ARQUIVO TEMPORÁRIO (PUXA A VALIDAÇÃO DO BUFFER)
        tempFilePath = path.join(__dirname, `temp_boleto_${Date.now()}_${numero.slice(-9)}.pdf`);
        fs.writeFileSync(tempFilePath, buffer);

        // CRIA MEDIA DO ARQUIVO LOCAL (EVITA ERRO DE BASE64)
        const media = MessageMedia.fromFilePath(tempFilePath);

        // Envia SEM caption no mesmo objeto (bug fix: caption separada causa protobuf fail)
        const chatId = `${numero}@s.whatsapp.net`;
        await client.sendMessage(chatId, media);

        // Envia caption como mensagem SEPARADA (workaround para bug 2025)
        //  if (caption.trim()) {
        //      await new Promise(r => setTimeout(r, 1500)); // Delay 1.5s para evitar race condition
        //      await client.sendMessage(chatId, caption.trim());
        //  }


        // ENVIA TEXTO 2 SEGUNDOS DEPOIS DO BOLETO
        await new Promise(r => setTimeout(r, 2000));
        await client.sendMessage(chatId, `*Segue seu boleto em anexo!*`);



        // Remove temp
        fs.unlinkSync(tempFilePath);
        tempFilePath = null;

        logger.info(`PDF ENVIADO VIA TEMP FILE ? ${numero} (${(buffer.length / 1024).toFixed(1)} KB)`);
        res.json({ success: true, message: 'Boleto enviado com sucesso!', numero, tamanho: `${(buffer.length / 1024).toFixed(1)} KB` });

    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        logger.error(`ERRO PDF 2025: ${error.message}`);
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('invalid value') || errMsg.includes('body')) {
            return res.status(400).json({ success: false, error: 'Bug do WhatsApp com base64 corrompido. Use PDF menor ou verifique MK-AUTH.' });
        }
        if (errMsg.includes('no lid') || errMsg.includes('not found')) {
            return res.status(400).json({ success: false, error: 'Número sem WhatsApp' });
        }
        res.status(500).json({ success: false, error: 'Falha ao enviar', detalhes: error.message });
    }
});


// LEITOR TURBO 2025 ? 9 LINHAS, PEGA TUDO
//app.use((req, res) => {
//    const ip = req.ip || req.socket.remoteAddress || '???';
//    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
//    console.log('\n+------------------ WHATSAPP BOT RECEBEU ------------------');
//    console.log(` ${agora} ¦ ${req.method.padEnd(6)} ¦ ${req.path.padEnd(20)} ¦ IP: ${ip}`);
//    console.log(` Query  ?`, req.query);
//    console.log(` Body   ?`, req.body || '(vazio)');
//    console.log(` Headers? Content-Type: ${req.get('content-type') || '???'} | UA: ${req.get('user-agent')?.slice(0,50)||'???'}`);
//    console.log('+-----------------------------------------------------------\n');
//    res.json({ ok: true, mensagem: "DADOS MOSTRADOS NO TERMINAL ? olhe aí!", recebido_as: agora });
//});



// Inicializa o servidor Express na porta 8000
app.listen(8000, () => {
    logger.warn('Servidor rodando na porta 8000');
});