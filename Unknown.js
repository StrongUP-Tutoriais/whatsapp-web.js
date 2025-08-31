const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { Client, Location, Poll, List, Buttons, LocalAuth } = require('./index');
const qrcodeterm = require("qrcode-terminal");
const { format } = require('date-fns');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const menu = require('./menu.js');
const rateLimit = require('express-rate-limit');



// Configura��o do limite de requisi��es por IP
const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 100, // Limite de 100 requisi��es por IP a cada 5 minutos
    message: 'Muitas requisi��es vindas deste IP, tente novamente mais tarde.',
    headers: true
});



const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Adiciona a data e hora no formato desejado
        winston.format.printf(({ timestamp, message }) => {
            return `{"${timestamp}","message":"${message}"}`; // Formata a saída conforme desejado
        })
    ),
    transports: [
        new winston.transports.Console(), // Log no console
        new winston.transports.File({ filename: 'SYSLOG.log' }) // Log em arquivo
    ]
});


// Configurações de horário comercial
const businessHours = {
    start: 8,  // 08:00
    end: 19    // 19:00
};

// Função para verificar se estamos dentro do horário comercial
function isWithinBusinessHours() {
    const now = new Date();
    const currentHour = now.getHours();
    return currentHour >= businessHours.start && currentHour < businessHours.end;
}

const app = express();

// Configurando o body-parser para aceitar payloads maiores
app.use(bodyParser.json({ limit: '10mb' })); // Reduza o limite se não for necessário mais
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));



// Inicializando o cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "User01", dataPath: "./Sessoes" }),
    // proxyAuthentication: { username: 'username', password: 'password' },
    puppeteer: {
        // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
    }
});

client.on('disconnected', (reason) => {
    logger.error('Cliente desconectado:', reason);
    client.destroy();
    client.initialize();
});

// Geração do QR code
client.on("qr", (qr) => {
    qrcodeterm.generate(qr, { small: true }, function (qrcode) {
        logger.warn('QR code gerado com sucesso');
        console.log(qrcode);  // Mostrando o QR code no console

        // Logando o QR code no arquivo de logs
        logger.warn('QR Code gerado: \n' + qrcode); // Adicionando o conteúdo do QR Code no log
    });
});

client.on('auth_failure', msg => {
    // Fired if session restore was unsuccessful
    console.error('AUTHENTICATION FAILURE', msg);
});

let clientStatus = 'disconnected'; // Inicialmente, o cliente está desconectado

client.on('ready', async () => {
    console.log('READY');
    clientStatus = 'ready'; // Inicialmente, o cliente está desconectado
    const debugWWebVersion = await client.getWWebVersion();
    console.log(`WWebVersion = ${debugWWebVersion}`);

    client.pupPage.on('pageerror', function (err) {
        console.log('Page error: ' + err.toString());
    });
    client.pupPage.on('error', function (err) {
        console.log('Page error: ' + err.toString());
    });

});

// Inicializando o cliente
client.initialize().catch((err) => {
    logger.error('Erro ao inicializar o cliente do WhatsApp:', err);
});

// Controle de chamadas fora do horário comercial
if (!isWithinBusinessHours()) {
    let rejectCalls = true;
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

}


/**
 * client.on('message', async msg => {
    await menu.processUserResponse(client, msg); // Processa a resposta do cliente
    await menu.handleNewChat(client, msg); // Continua enviando o menu se necessário
});
 * 
 * 
 */



// Evento de recebimento de mensagens
client.on('message', async msg => {

    const chatId = msg.from;
    const messageBody = msg.body.trim().toLowerCase();

    // Exemplo de resposta com delay
    if (msg.body === "jaco" || msg.body.toLowerCase() === "jaco") {
        setTimeout(() => {
            msg.reply("Oi");
            logger.warn(`Mensagem "Oi" enviada em resposta a "jaco" para ${chatId}`);
        }, 30000);  // Delay de 30 segundos
    }

    // Regex para detectar mensagens relacionadas a Pix
    const regex = /.*pix.*/i;
    if (regex.test(msg.body)) {
        logger.warn(`Cliente pediu a chave pix: ${msg.body}`);
        const respostasPix = [
            "Chave Pix Telefone: 85985304415 - Nome: Jaco Leone Amorim Melo - Inst: Caixa Economica Federal"
        ];

        // Função para escolher uma resposta Pix aleatoriamente
        setTimeout(() => {
            const randomResponse = respostasPix[Math.floor(Math.random() * respostasPix.length)];
            msg.reply(randomResponse);
            logger.warn(`Resposta Pix enviada para ${chatId}`);
        }, 10000);


    }
});

app.get('/logs', (req, res) => {
    const logFilePath = path.join(__dirname, 'SYSLOG.log'); // Caminho do arquivo de log

    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error("Erro ao ler o arquivo de log:", err);
            return res.status(500).send('Erro ao ler o arquivo de log.');
        }

        // Verifica o status do cliente (Exemplo de lógica para status online/offline)
        const clientStatusColor = clientStatus === 'ready' ? 'green' : 'red';
        const whatsappStatusText = clientStatus === 'ready' ? 'WhatsApp está pronto para enviar as mensagens' : 'WhatsApp está offline ainda';
        const whatsappStatusColor = clientStatus === 'ready' ? 'green' : 'red';

        // Cria um HTML com design mais refinado e rolagem automática
        const htmlContent = `
            <html>
                <head>
                    <title>Logs do Sistema</title>
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            font-family: 'Roboto', sans-serif;
                            background: linear-gradient(135deg, #f7f7f7, #e2e2e2);
                            color: #333;
                            padding: 20px;
                        }
                        header {
                            background: #4CAF50;
                            color: white;
                            padding: 15px;
                            text-align: center;
                            border-radius: 8px 8px 0 0;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        header h1 {
                            font-size: 2.5rem;
                            margin-right: 20px;
                        }
                        .status {
                            display: flex;
                            align-items: center;
                            font-size: 1.2rem;
                            color: #fff;
                            background-color: ${whatsappStatusColor};
                            padding: 10px;
                            border-radius: 20px;
                            font-weight: bold;
                        }
                        .status-bullet {
                            width: 16px;
                            height: 16px;
                            border-radius: 50%;
                            display: inline-block;
                            margin-right: 10px;
                        }
                        .green { background-color: #28a745; }
                        .red { background-color: #dc3545; }
                        .content {
                            background-color: #ffffff;
                            padding: 20px;
                            border-radius: 8px;
                            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                            margin-top: 20px;
                            font-size: 1.1rem;
                            height: 400px;
                            overflow-y: auto;
                        }
                        pre {
                            background-color: #1e1e1e;
                            color: #f7f7f7;
                            padding: 20px;
                            font-size: 14px;
                            border-radius: 8px;
                            overflow-x: auto;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                        }
                        footer {
                            text-align: center;
                            margin-top: 30px;
                            padding: 15px;
                            background-color: #333;
                            color: #fff;
                            border-radius: 0 0 8px 8px;
                        }
                        footer p {
                            font-size: 0.9rem;
                        }
                        /* Responsividade */
                        @media (max-width: 768px) {
                            header h1 {
                                font-size: 2rem;
                            }
                            .status {
                                font-size: 1rem;
                            }
                            pre {
                                font-size: 12px;
                            }
                        }
                    </style>
                </head>
                <body>
                    <header>
                        <h1>Logs do Sistema</h1>
                        <div class="status">
                            <span class="status-bullet ${whatsappStatusColor}"></span> 
                            ${whatsappStatusText}
                        </div>
                    </header>

                    <div class="content" id="logContainer">
                        <pre>${data}</pre>
                    </div>

                    <footer>
                        <p>&copy; 2025 Sistema de Logs - Todos os direitos reservados</p>
                    </footer>

                    <script>
                        // Função para rolar automaticamente até o final do log
                        const logContainer = document.getElementById('logContainer');
                        logContainer.scrollTop = logContainer.scrollHeight;
                    </script>
                </body>
            </html>
        `;

        res.send(htmlContent);
    });
});

// Função para formatar número de telefone
function phoneNumberFormatter(number) {
    if (!number) return '';
    const isWid = number.includes('@c.us') ? true : false;
    if (isWid) {
        return number.replace('@c.us', '').replace(/[^0-9]/g, '');
    }
    return number.replace(/[^0-9]/g, '');
}


// Endpoint para envio de mensagens
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

    // Sanitização dos inputs para evitar injeções de código
    const sanitizedMsg = msg.replace(/<[^>]*>?/gm, '');  // Remove tags HTML
    const sanitizedLogin = u.replace(/[^a-zA-Z0-9]/g, '');  // Remove caracteres especiais

    try {
        const formattedNumber = phoneNumberFormatter(to);

        if (!formattedNumber) {
            logger.warn(`Tentativa de enviar mensagem para número inválido: ${to}`);
            return res.status(400).json({ error: 'Número de telefone inválido' });
        }

        const contactId = `${formattedNumber}@c.us`; // Formata o número corretamente para o WhatsApp

        // Verifica se o número está registrado no WhatsApp
        const isRegistered = await client.isRegisteredUser(contactId);

        if (!isRegistered) {
            logger.warn(`número não registrado no WhatsApp: ${formattedNumber}`);
            logger.info(`número não registrado no WhatsApp: ${formattedNumber},'Mensagem:',${msg}`);
            return res.status(400).json({ error: 'Número não registrado no WhatsApp' });
        }

        // Envia a mensagem caso o número seja válido e registrado
        await client.sendMessage(contactId, sanitizedMsg);
        logger.info(`Mensagem enviada com sucesso para: ${formattedNumber},'Mensagem:',${msg}`);
        res.status(200).send('Mensagem enviada com sucesso!');
    } catch (error) {
        logger.error(`Erro ao enviar mensagem: ${error.message || error}`);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }


});


// Endpoint para envio de mensagens
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

    // Sanitização dos inputs para evitar injeções de código
    const sanitizedMsg = msg.replace(/<[^>]*>?/gm, '');  // Remove tags HTML
    const sanitizedLogin = login.replace(/[^a-zA-Z0-9]/g, '');  // Remove caracteres especiais

    try {
        const formattedNumber = phoneNumberFormatter(to);

        if (!formattedNumber) {
            logger.warn(`Tentativa de enviar mensagem para número inválido: ${to}`);
            return res.status(400).json({ error: 'Número de telefone inválido' });
        }

        const contactId = `${formattedNumber}@c.us`; // Formata o número corretamente para o WhatsApp

        // Verifica se o número está registrado no WhatsApp
        const isRegistered = await client.isRegisteredUser(contactId);

        if (!isRegistered) {
            logger.warn(`número não registrado no WhatsApp: ${formattedNumber}`);
            logger.info(`número não registrado no WhatsApp: ${formattedNumber},'Mensagem:',${msg}`);
            return res.status(400).json({ error: 'Número não registrado no WhatsApp' });
        }

        // Envia a mensagem caso o número seja válido e registrado
        await client.sendMessage(contactId, sanitizedMsg);
        logger.info(`Mensagem enviada com sucesso para: ${formattedNumber},'Mensagem:',${msg}`);
        res.status(200).send('Mensagem enviada com sucesso!');
    } catch (error) {
        logger.error(`Erro ao enviar mensagem: ${error.message || error}`);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }


});

// Middleware para capturar erros
app.use((err, req, res, next) => {
    logger.error('Erro capturado pelo middleware:', err.stack);
    res.status(500).json({ error: 'Erro interno no servidor' });
});

// Inicializando o servidor
app.listen(8000, () => {
    logger.warn('Servidor rodando na porta 8000');
});
