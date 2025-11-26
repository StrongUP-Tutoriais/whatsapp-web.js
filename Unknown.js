// Importação dos módulos necessários
require("./auto-loader");
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { Client, Location, Poll, List, Buttons, LocalAuth } = require('./index');
const qrcodeterm = require("qrcode-terminal");
const QRCode = require('qrcode');
const { format } = require('date-fns');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { sendAlert } = require('./mailer');
const stripAnsi = require('strip-ansi');
const Gerencianet = require('gn-api-sdk-node')





const gerencianet = new Gerencianet(options)

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

client.on('loading_screen', (percent, message) => {
    logger.log('LOADING SCREEN', percent, message);
});

// Evento: Autenticação bem-sucedida
client.on('authenticated', () => {
    logger.info('AUTHENTICATED');
});

// Evento: Falha na autenticação
client.on('auth_failure', msg => {
    logger.error('AUTHENTICATION FAILURE', msg);
    sendAlert("WhatsApp - Falha de Autenticacao", `O cliente falhou ao autenticar.\n\nDetalhes: ${msg}`);
});

// Evento: Cliente desconectado
client.on('disconnected', (reason) => {
    clientStatus = 'disconnected'; // Atualiza status
    sendAlert("WhatsApp - Cliente Desconectado", `O cliente foi desconectado. Motivo: ${reason}`);
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
    logger.error('Erro ao iniciar o cliente WhatsApp:',err);
});

// Evento: Rejeita chamadas fora do horário comercial
client.on('call', async (call) => {
    if (!isWithinBusinessHours()) {
        try {
            await call.reject();
            await client.sendMessage(call.from, 'Fora do horário comercial.');
            logger.warn(`Chamada rejeitada de: ${call.from}`);
        } catch (error) {
            logger.error('Erro ao rejeitar chamada:', error.message);
        }
    }
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
            "Chave Pix Telefone: 85985304415 - Nome: Jaco Leone Amorim Melo - Inst: Caixa Economica Federal"
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
    const isWid = number.includes('@c.us') ? true : false;
    if (isWid) {
        return number.replace('@c.us', '').replace(/[^0-9]/g, '');
    }
    return number.replace(/[^0-9]/g, '');
}

// Endpoint: Envio de mensagem (versão 1)
app.post('/send-message01', [
    body('to').isString().notEmpty().withMessage('Número do destinatário é obrigatório'),
    body('msg').isString().notEmpty().withMessage('Mensagem é obrigatória'),
    body('u').isString().notEmpty().withMessage('Login é obrigatório'),
    body('p').isString().notEmpty().withMessage('Senha é obrigatória')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { to, msg, u, p } = req.body;
    // Sanitiza inputs
    const sanitizedMsg = msg.replace(/<[^>]*>?/gm, '');
    // O login sanitizado não é usado, mas pode ser utilizado para autenticação futura
    // const sanitizedLogin = u.replace(/[^a-zA-Z0-9]/g, '');
    try {
        const formattedNumber = phoneNumberFormatter(to);
        if (!formattedNumber) {
            logger.warn(`Tentativa de enviar mensagem para número inválido: ${to}`);
            return res.status(400).json({ error: 'Número de telefone inválido' });
        }
        const contactId = `${formattedNumber}@c.us`;
        // Verifica se o número está registrado no WhatsApp
        const isRegistered = await client.isRegisteredUser(contactId);
        if (!isRegistered) {
            logger.warn(`número não registrado no WhatsApp: ${formattedNumber}`);
            logger.info(`número não registrado no WhatsApp: ${formattedNumber},'Mensagem:',${msg}`);
            return res.status(400).json({ error: 'Número não registrado no WhatsApp' });
        }
        // Envia a mensagem
        await client.sendMessage(contactId, sanitizedMsg);
        logger.info(`Mensagem enviada com sucesso para: ${formattedNumber},'Mensagem:',${msg}`);
        res.status(200).send('Mensagem enviada com sucesso!');
    } catch (error) {
        logger.error(`Erro ao enviar mensagem: ${error.message || error}`);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

// Endpoint: Envio de mensagem (versão 2)
app.post('/send-message02', [
    body('to').isString().notEmpty().withMessage('Número do destinatário é obrigatório'),
    body('msg').isString().notEmpty().withMessage('Mensagem é obrigatória'),
    body('login').isString().notEmpty().withMessage('Login é obrigatório'),
    body('pass').isString().notEmpty().withMessage('Senha é obrigatória')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { to, msg, login, pass } = req.body;
    // Sanitiza inputs
    const sanitizedMsg = msg.replace(/<[^>]*>?/gm, '');
    // O login sanitizado não é usado, mas pode ser utilizado para autenticação futura
    // const sanitizedLogin = login.replace(/[^a-zA-Z0-9]/g, '');
    try {
        const formattedNumber = phoneNumberFormatter(to);
        if (!formattedNumber) {
            logger.warn(`Tentativa de enviar mensagem para número inválido: ${to}`);
            return res.status(400).json({ error: 'Número de telefone inválido' });
        }
        const contactId = `${formattedNumber}@c.us`;
        // Verifica se o número está registrado no WhatsApp
        const isRegistered = await client.isRegisteredUser(contactId);
        if (!isRegistered) {
            logger.warn(`número não registrado no WhatsApp: ${formattedNumber}`);
            logger.info(`número não registrado no WhatsApp: ${formattedNumber},'Mensagem:',${msg}`);
            return res.status(400).json({ error: 'Número não registrado no WhatsApp' });
        }
        // Envia a mensagem
        await client.sendMessage(contactId, sanitizedMsg);
        logger.info(`Mensagem enviada com sucesso para: ${formattedNumber},'Mensagem:',${msg}`);
        res.status(200).send('Mensagem enviada com sucesso!');
    } catch (error) {
        logger.error(`Erro ao enviar mensagem: ${error.message || error}`);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

// Middleware para capturar erros não tratados
app.use((err, req, res, next) => {
    logger.error('Erro capturado pelo middleware:', err.stack);
    res.status(500).json({ error: 'Erro interno no servidor' });
});

// Inicializa o servidor Express na porta 8000
app.listen(8000, () => {
    logger.warn('Servidor rodando na porta 8000');
});