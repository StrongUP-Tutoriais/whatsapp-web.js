// Importação dos módulos necessários
require("./auto-loader");
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('./index');

const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
require('dotenv').config();   // ? ESSA LINHA LÊ O ARQUIVO .env

const app = express();

app.use(express.json({ limit: '10mb' }));                    // ← PARA LER JSON (POST /send-message, etc)
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // ← PARA LER form-data e x-www-form-urlencoded

const clientMap = {};
const qrStore = {};
const MAX_INSTANCES = parseInt(process.env.MAX_INSTANCES || '5'); // 5 pra VPS de 1GB, 10 pra 2GB+
let launchesEmAndamento = 0;
const launchQueue = [];

const usersFilePath = path.join(__dirname, "usuarios.json");
let usuarios = {};



const rateLimit = require('express-rate-limit');
app.use('/send-message', rateLimit({ windowMs: 60000, max: 30 }))
app.use('/login-post', rateLimit({ windowMs: 60000, max: 10 }))


if (fs.existsSync(usersFilePath)) {
    usuarios = JSON.parse(fs.readFileSync(usersFilePath));
    console.log(`[LOG] usuarios.json carregado → ${Object.keys(usuarios).length} usuário(s) encontrado(s)`);
} else {
    fs.writeFileSync(usersFilePath, JSON.stringify({}, null, 2));
    console.log("[LOG] usuarios.json criado (vazio)");
}

function criarInstancia(usuario) {
    // Se já existe, retorna
    if (clientMap[usuario]) {
        return clientMap[usuario];
    }

    // Admin não conta no limite
    const isAdmin = usuario === ADMIN_USER;
    const totalAtivas = Object.keys(clientMap).filter(u => u!== ADMIN_USER).length;

    if (!isAdmin && totalAtivas >= MAX_INSTANCES) {
        console.log(`[LIMITE] Recusado ${usuario} - ${totalAtivas}/${MAX_INSTANCES} ativas`);
        const err = new Error('LIMITE_INSTANCIAS');
        err.code = 'LIMITE_INSTANCIAS';
        throw err;
    }

    // Evita 2 Chromes abrindo pro mesmo usuário ao mesmo tempo
    if (qrStore[usuario + '_launching']) {
        console.log(`[FILA] ${usuario} já está iniciando, aguardando...`);
        return clientMap[usuario] || null;
    }
    qrStore[usuario + '_launching'] = true;

    console.log(`[INSTÂNCIA] Criando nova instância para: ${usuario} (${totalAtivas + 1}/${MAX_INSTANCES})`);

    const sessionPath = path.join(__dirname, 'sessions', usuario);
    const qrAttempts = { count: 0, timeout: null };
    const MAX_QR_ATTEMPTS = 4;
    const QR_EXPIRE_TIME = 60000;

    const client = new Client({
        authStrategy: new LocalAuth({ client: usuario, dataPath: sessionPath }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
            headless: true,
           ...(process.env.CHROME_PATH? { executablePath: process.env.CHROME_PATH } : {})
        },
        webVersionCache: {
            type: 'remote',
            remotePath: process.env.WA_VERSION_URL || `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/2.3000.1031490220-alpha.html`,
        },
    });

    client.on("qr", (qr) => {
        qrAttempts.count++;
        if (qrAttempts.count > MAX_QR_ATTEMPTS) {
            console.log(`\n[LIMITE] ${usuario.toUpperCase()} atingiu ${MAX_QR_ATTEMPTS} tentativas.`);
            delete qrStore[usuario];
            delete qrStore[usuario + '_launching'];
            client.destroy().catch(() => { });
            delete clientMap[usuario];
            return;
        }
        console.log(`QR CODE ${qrAttempts.count}/${MAX_QR_ATTEMPTS} → ${usuario.toUpperCase()}`);
        qrStore[usuario] = qr;
        if (qrAttempts.timeout) clearTimeout(qrAttempts.timeout);
        qrAttempts.timeout = setTimeout(() => {
            delete qrStore[usuario];
        }, QR_EXPIRE_TIME);
    });

    client.on("authenticated", () => {
        console.log(`[OK] Autenticado: ${usuario}`);
        qrAttempts.count = 0;
        if (qrAttempts.timeout) clearTimeout(qrAttempts.timeout);
        delete qrStore[usuario];
        delete qrStore[usuario + '_launching'];
    });

    client.on("ready", () => {
        console.log(`[ONLINE] ${usuario} | Sessão: ${sessionPath}`);
        delete qrStore[usuario + '_launching'];
    });

    client.on("auth_failure", (msg) => {
        console.log(`[FALHA] ${usuario}: ${msg}`);
        delete qrStore[usuario + '_launching'];
    });

client.on("disconnected", (reason) => {
    console.log(`[DESCONECTADO] ${usuario} | Motivo: ${reason}`);
    delete qrStore[usuario];
    delete qrStore[usuario + '_launching'];
    try { client.destroy().catch(()=>{}); } catch(e) {}
    delete clientMap[usuario];
    launchesEmAndamento = Math.max(0, launchesEmAndamento - 1);
    if (reason === "invalid_session" || reason === "logged_out") {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }
});

    client.on('message', async (msg) => {
        try {
            if (msg.fromMe) return;
            const isGrupo = msg.from.endsWith('@g.us');
            if (isGrupo) {
                const chat = await msg.getChat();
                const contato = await msg.getContact();
                console.log('[MSG GRUPO] ' + usuario + ' ← ' + chat.name + ' | ' + contato.pushname + ': ' + msg.body);
            } else {
                const contato = await msg.getContact();
                console.log('[MSG PV] ' + usuario + ' ← ' + contato.pushname + ': ' + msg.body);
            }
        } catch (e) {
            console.log('[MSG RECEBIDA] ' + usuario + ' ← ' + msg.from + ': ' + msg.body);
        }
    });

    try { fs.mkdirSync(sessionPath, { recursive: true }); } catch (e) {}

    // Inicialização com controle de concorrência
    launchesEmAndamento++;
    client.initialize()
       .catch(err => {
            console.error(`[ERRO INIT] ${usuario}: ${err.message}`);
            delete qrStore[usuario + '_launching'];
            delete clientMap[usuario];
        })
       .finally(() => {
            launchesEmAndamento--;
        });

    clientMap[usuario] = client;
    return client;
}



const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
    console.error('[ERRO] Defina ADMIN_USER e ADMIN_PASS no arquivo .env');
    process.exit(1);
}
if (!usuarios[ADMIN_USER]) {
    usuarios[ADMIN_USER] = { senha: bcrypt.hashSync(ADMIN_PASS, 10) };
    fs.writeFileSync(usersFilePath, JSON.stringify(usuarios, null, 2));
    console.log(`[ADMIN] Usuário admin criado → ${ADMIN_USER}`);
}
console.log(`\n[ADMIN] Iniciando instância oficial: ${ADMIN_USER}`);
const adminClient = criarInstancia(ADMIN_USER);

function validarUsuarioSenha(user, pass) {
    const u = usuarios[user];
    if (!u || !u.senha) return false;
    const hash = u.senha;
    // bcrypt hash
    if (hash.startsWith('$2')) {
        return bcrypt.compareSync(pass, hash);
    }
    // compatibilidade com senha em texto puro - valida e migra
    if (hash === pass) {
        u.senha = bcrypt.hashSync(pass, 10);
        fs.writeFileSync(usersFilePath, JSON.stringify(usuarios, null, 2));
        console.log(`[MIGRAÇÃO] Senha de ${user} migrada para bcrypt`);
        return true;
    }
    return false;
}
function pegarInstancia(user) {
    return clientMap[user] || null;
}

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization;
    const expected = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
    if (!auth || auth !== expected) {
        res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('Acesso negado');
    }
    next();
}

app.post('/send-message', async (req, res) => {
    const { to, msg, login, pass } = req.body;

    // === LOG INICIAL ===
    console.log(`[SEND] Requisição → Usuário: ${login} → Para: ${to}`);

    // === AUTENTICAÇÃO ===
    if (!validarUsuarioSenha(login, pass)) {
        console.warn(`[SEND] Acesso negado - Usuário: ${login} - IP: ${req.ip}`);
        return res.status(401).json({ success: false, error: "Login ou senha incorretos" });
    }

    // === PEGA INSTÂNCIA DO USUÁRIO ===
    const instancia = pegarInstancia(login);
    if (!instancia) {
        return res.status(400).json({
            success: false,
            error: "Instância não iniciada. Acesse /login e escaneie o QR Code."
        });
    }

    // === VALIDAÇÕES BÁSICAS ===
    if (!to || !msg) {
        return res.status(400).json({ success: false, error: "Parâmetros 'to' e 'msg' são obrigatórios" });
    }

    // === LIMPEZA DA MENSAGEM (remove HTML, XSS, etc.) ===
    const textoLimpo = msg.toString()
        .replace(/<[^>]*>/g, '')    // Remove qualquer HTML
        //.replace(/\s+/g, ' ')       // Remove quebras de linha extras
        .trim();

    if (!textoLimpo) {
        return res.status(400).json({ success: false, error: "Mensagem vazia após limpeza" });
    }

    // === FORMATA NÚMERO (BRASIL 2025) ===
    let numero = to.replace(/\D/g, ''); // remove tudo que não é número

    if (numero.length === 11) numero = '55' + numero;                    // 85999999999 → 5585999999999
    else if (numero.length === 10) numero = '55' + numero;              // número antigo sem 9
    else if (numero.length === 12 && numero.startsWith('55')) numero = numero; // já veio com 55
    else if (numero.length === 13 && numero.startsWith('55')) numero = numero; // 55 + DDD + 9 + 8 dígitos
    else {
        return res.status(400).json({ success: false, error: "Número inválido ou formato incorreto" });
    }

    if (!/^55\d{10,11}$/.test(numero)) {
        return res.status(400).json({ success: false, error: "Número fora do padrão brasileiro" });
    }

    const chatId = `${numero}@s.whatsapp.net`;  // ← Recomendado em 2025 (funciona com todas as versões)

    try {
        await instancia.sendMessage(chatId, textoLimpo);

        // === LOG DE SUCESSO ===
        console.info(`[SEND] Mensagem enviada → ${login} → ${numero} (${textoLimpo.length} chars)`);

        // === RESPOSTA PADRÃO MK-AUTH 2025 ===
        return res.json({
            success: true,
            message: "Mensagem enviada com sucesso!",
            numero: numero,
            preview: textoLimpo.substring(0, 80) + (textoLimpo.length > 80 ? "..." : "")
        });

    } catch (error) {
        console.error(`[SEND] Erro (${login} → ${numero}): ${error.message}`);

        const err = error.message.toLowerCase();

        // === ERROS ESPECÍFICOS (iguais ao MK-AUTH oficial) ===
        if (err.includes('no lid') ||
            err.includes('not found') ||
            err.includes('not on whatsapp') ||
            err.includes('number not') ||
            err.includes('invalid')) {
            return res.status(400).json({
                success: false,
                error: "Número sem WhatsApp ou inválido"
            });
        }

        if (err.includes('rate-overlimit') || err.includes('429')) {
            return res.status(429).json({
                success: false,
                error: "Muitas mensagens. Aguarde alguns minutos."
            });
        }

        // === ERRO GENÉRICO ===
        return res.status(500).json({
            success: false,
            error: "Erro interno ao enviar mensagem"
        });
    }
});

app.post('/send-document', async (req, res) => {
    let tempFilePath = null;
    try {
        const { to, caption = '', document, filename = 'boleto.pdf', login, pass } = req.body;

        // === AUTENTICAÇÃO ===
        if (!validarUsuarioSenha(login, pass)) {
            console.warn(`[DOC] Acesso negado - Usuário: ${login} - IP: ${req.ip}`);
            return res.status(401).json({ success: false, error: "Login ou senha incorretos" });
        }

        // === INSTÂNCIA DO USUÁRIO ===
        const instancia = pegarInstancia(login);
        if (!instancia) {
            return res.status(400).json({
                success: false,
                error: "Instância não iniciada. Acesse /login e escaneie o QR Code."
            });
        }

        // === VALIDAÇÕES BÁSICAS ===
        if (!to || !document) {
            return res.status(400).json({ success: false, error: "Parâmetros 'to' e 'document' são obrigatórios" });
        }

        // === FORMATA NÚMERO ===
        let numero = to.replace(/\D/g, '');
        if (numero.length === 11) numero = '55' + numero;
        if (numero.length === 10) numero = '55' + numero;
        if (!/^55\d{10,11}$/.test(numero)) {
            return res.status(400).json({ success: false, error: "Número inválido" });
        }

        // === CORRIGE BASE64 ===
        const base64Clean = document
            .replace(/^data:.+;base64,/, '')
            .replace(/%3D/g, '=')
            .replace(/%2F/g, '/')
            .replace(/%2B/g, '+')
            .replace(/%0A/g, '\n')
            .replace(/%0D/g, '\r');

        const buffer = Buffer.from(base64Clean, 'base64');

        // === VALIDA TAMANHO ===
        if (buffer.length < 5000 || buffer.length > 15 * 1024 * 1024) {
            return res.status(400).json({ success: false, error: "PDF deve ter entre 5KB e 15MB" });
        }

        // === SALVA TEMP ===
        const safeFilename = path.basename(filename) || 'boleto.pdf';
        tempFilePath = path.join(__dirname, `boleto_${Date.now()}_${numero.slice(-4)}.pdf`);
        fs.writeFileSync(tempFilePath, buffer);

        const media = MessageMedia.fromFilePath(tempFilePath);
        media.filename = safeFilename; // <- CORREÇÃO: usa o nome que vem da API
        media.mimetype = 'application/pdf';

        const chatId = `${numero}@s.whatsapp.net`;

        // === ENVIA BOLETO COM LEGENDA (se tiver) ===
        const textoLimpo = caption.toString().replace(/<[^>]*>/g, '').trim();
        if (textoLimpo) {
            await instancia.sendMessage(chatId, media, { caption: textoLimpo });
        } else {
            await instancia.sendMessage(chatId, media);
        }

        // === ENVIA VÍDEO TUTORIAL COMO DOCUMENTO ===
        const videoPath = path.join(__dirname, 'videos', 'Video_Explicativo.mp4');
        if (fs.existsSync(videoPath)) {
            try {
                const stats = fs.statSync(videoPath);
                console.log(`[DOC] Vídeo: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

                await new Promise(r => setTimeout(r, 2000));

                const videoMedia = MessageMedia.fromFilePath(videoPath);
                videoMedia.mimetype = 'video/mp4';
                videoMedia.filename = 'Video_Explicativo.mp4';

                await instancia.sendMessage(chatId, videoMedia, {
                    caption: '✅ Vídeo explicando como pagar pelo link Novo! 🎥',
                    sendMediaAsDocument: true
                });

                console.info(`[DOC] Vídeo enviado para ${numero}`);
            } catch (videoError) {
                console.error(`[DOC] Erro ao enviar vídeo para ${numero}:`, videoError.message);
                await instancia.sendMessage(chatId, 'Desculpe, não consegui enviar o vídeo explicativo agora. 😔');
            }
        }

        // === LIMPA TEMP ===
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        // === SUCESSO ===
        console.info(`[DOC] Boleto enviado por ${login} → ${numero} (${(buffer.length / 1024).toFixed(1)} KB)`);
        return res.json({
            success: true,
            message: "Boleto enviado com sucesso!",
            numero,
            tamanho_kb: (buffer.length / 1024).toFixed(1)
        });

    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        const loginLog = req.body?.login || 'desconhecido';
        const toLog = req.body?.to || 'desconhecido';

        console.error(`[DOC] Erro grave (${loginLog} → ${toLog}): ${error.message}`);

        const msg = error.message.toLowerCase();
        if (msg.includes('no lid') || msg.includes('not found') || msg.includes('not on whatsapp')) {
            return res.status(400).json({ success: false, error: "Número sem WhatsApp ou inválido" });
        }
        if (msg.includes('invalid value') || msg.includes('protobuf') || msg.includes('body')) {
            return res.status(400).json({ success: false, error: "PDF corrompido ou muito grande" });
        }

        return res.status(500).json({ success: false, error: "Erro interno ao enviar documento" });
    }
});

app.get('/login', (req, res) => {
    console.log(`[HTTP] Alguém acessou /login (IP: ${req.ip})`);
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login • WhatsApp Multi-Instância</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #fff;
        }
        .card {
            background: rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            padding: 50px 40px;
            width: 100%;
            max-width: 420px;
            text-align: center;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.35);
            animation: fadeInUp 0.9s ease-out;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(40px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .logo {
            width: 80px;
            height: 80px;
            background: #25D366;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 25px;
            font-size: 42px;
            font-weight: bold;
            color: white;
            box-shadow: 0 12px 30px rgba(37, 211, 102, 0.45);
        }
        h2 {
            font-size: 2rem;
            margin-bottom: 10px;
            font-weight: 700;
        }
        .subtitle {
            font-size: 1.1rem;
            opacity: 0.9;
            margin-bottom: 40px;
            font-weight: 500;
        }
        form {
            display: flex;
            flex-direction: column;
            gap: 18px;
        }
        input {
            padding: 16px 20px;
            font-size: 1.05rem;
            border: none;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            outline: none;
            transition: all 0.3s;
        }
        input::placeholder {
            color: rgba(255, 255, 255, 0.7);
        }
        input:focus {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(1.02);
            box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15);
        }
        button {
            padding: 16px;
            font-size: 1.1rem;
            font-weight: 600;
            color: white;
            background: linear-gradient(90deg, #25D366, #128C7E);
            border: none;
            border-radius: 14px;
            cursor: pointer;
            margin-top: 10px;
            transition: all 0.3s;
            box-shadow: 0 8px 25px rgba(37, 211, 102, 0.4);
        }
        button:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 35px rgba(37, 211, 102, 0.5);
        }
        button:active {
            transform: translateY(-1px);
        }
        .admin-btn {
            margin-top: 40px;
            padding-top: 30px;
            border-top: 1px solid rgba(255,255,255,0.2);
        }
        .admin-btn a {
            display: inline-block;
            background: rgba(58, 189, 46, 0.99);
            color: white;
            padding: 12px 28px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: 600;
            font-size: 0.95rem;
            transition: all 0.3s;
            backdrop-filter: blur(10px);
        }
        .admin-btn a:hover {
            background: rgba(8, 252, 60, 1);
            transform: translateY(-3px);
        }
        .footer {
            margin-top: 50px;
            font-size: 0.9rem;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">SMS</div>
        <h2>WhatsApp Connect</h2>
        <div class="subtitle">Acesso Multi-Instância</div>

        <form method="POST" action="/login-post">
            <input type="text" name="user" placeholder="Usuário" required autofocus>
            <input type="password" name="pass" placeholder="Senha" required>
            <button type="submit">Entrar e Conectar</button>
        </form>

        <div class="admin-btn">
            <a href="/admin">Painel do Administrador</a>
        </div>

        <div class="footer">
            Sistema Multi-Instância • 2025<br>
            Desenvolvido com dedicação e café
        </div>
    </div>
</body>
</html>
    `);
});



app.post('/login-post', async (req, res) => {
    const { user, pass } = req.body;
    if (!user) return res.send("Envie o usuário.");
    if (!validarUsuarioSenha(user, pass)) {
        console.log(`[LOGIN] Senha incorreta para: ${user}`);
        return res.send("Usuário não encontrado ou senha incorreta.");
    }

    // 1 - SE JÁ TÁ ONLINE, RETORNA NA HORA (não espera 20s)
    const existing = clientMap[user];
    if (existing && existing.info) {
        console.log(`[LOGIN] ${user} já está conectado`);
        return res.send(`
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Já Conectado</title>
<style>body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff} .card{background:rgba(255,255,255,0.12);padding:40px;border-radius:20px;text-align:center}</style>
</head><body><div class="card"><h2>✓ ${user.toUpperCase()} já está conectado!</h2><p>Sessão ativa, pode usar a API.</p><a href="/login" style="color:#fff">Voltar</a></div></body></html>`);
    }

   try {
    criarInstancia(user);
} catch (err) {
    if (err.code === 'LIMITE_INSTANCIAS') {
        return res.status(429).send(`
        <h2>Servidor lotado</h2>
        <p>Tem ${MAX_INSTANCES} instâncias ativas. Tente mais tarde ou fale com o admin para aumentar o limite.</p>
        <a href="/login">Voltar</a>
        `);
    }
    throw err;
}

    const timeout = 60000; // AGORA 60s - Chrome na VPS é lento
    const interval = 1000;
    const start = Date.now();

    (function waitForQR() {
        // 2 - Se QR apareceu, mostra
        if (qrStore[user]) {
            return QRCode.toDataURL(qrStore[user], (err, url) => {
                if (err) return res.send("Erro ao gerar imagem do QR. Tente novamente.");
                return res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp Connect • ${user.toUpperCase()}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;}
        .card{background:rgba(255,255,255,0.1);backdrop-filter:blur(12px);border-radius:20px;padding:40px 30px;max-width:420px;width:100%;text-align:center}
        .qr-container{background:white;padding:20px;border-radius:16px;display:inline-block;margin:20px 0}
        .qr-container img{width:260px;height:260px}
    </style>
    <script>
        setTimeout(() => location.reload(), 45000);
        setInterval(() => {
            fetch('/check-qr?user=${user}').then(r => r.json()).then(data => {
                if (!data.hasQR) window.location.href = '/login';
            });
        }, 3000);
    </script>
</head>
<body>
    <div class="card">
        <h2>Conectar WhatsApp</h2>
        <p>Usuário: <strong>${user.toUpperCase()}</strong></p>
        <div class="qr-container"><img src="${url}" alt="QR Code"></div>
        <p>Escaneie no WhatsApp > Aparelhos conectados</p>
        <button onclick="location.reload()" style="margin-top:15px;padding:10px 20px;border-radius:20px;border:none;cursor:pointer">Atualizar QR</button>
    </div>
</body>
</html>
                `);
            });
        }

        // 3 - Se conectou enquanto esperava
        const client = clientMap[user];
        if (client && client.info) {
            return res.send(`<h2>Conectado! ${user.toUpperCase()} online!</h2><script>setTimeout(()=>window.location='/login',2000)</script>`);
        }

        // 4 - Ainda dentro do tempo? Continua esperando
        if (Date.now() - start < timeout) {
            return setTimeout(waitForQR, interval);
        }

        // 5 - Estourou os 60s - Chrome ainda iniciando
        console.log(`[LOGIN] Timeout 60s sem QR para ${user} - Chrome pode estar lento`);
        return res.send(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Carregando...</title>
<style>body{font-family:sans-serif;background:#667eea;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center} .card{background:rgba(0,0,0,0.2);padding:30px;border-radius:15px}</style>
<script>setTimeout(()=>location.reload(),8000);</script>
</head><body>
<div class="card">
<h2>⏳ Iniciando navegador...</h2>
<p>Primeira vez demora até 60s na VPS (Chrome pesado)</p>
<p><strong>Não feche.</strong> Recarregando automaticamente em 8s...</p>
<p style="margin-top:15px;opacity:0.8">Se ficar nisso, olhe o terminal: <code>pm2 logs</code></p>
<button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;border-radius:20px;border:none;cursor:pointer">Tentar agora</button>
</div>
</body></html>
        `);
    })();
});



app.get('/check-qr', (req, res) => {
    res.json({ hasQR: !!qrStore[req.query.user] });
});
app.get('/admin', requireAdmin, (req, res) => {

    // Escape seguro para HTML e para atributos JavaScript
    const escapeHTML = (str) => String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);

    const escapeJS = (str) => String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');

    let listaUsuarios = '';
    for (const [user, dados] of Object.entries(usuarios)) {
        if (user === ADMIN_USER) continue;

        const conectado = clientMap[user] && clientMap[user].info ? 'Conectado' : 'Desconectado';
        const statusClass = conectado === 'Conectado' ? 'status-on' : 'status-off';

        listaUsuarios += `
        <tr>
            <td><strong>${escapeHTML(user).toUpperCase()}</strong></td>
            <td><span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:50%;background:${conectado === 'Conectado' ? '#2ecc71' : '#e74c3c'};box-shadow:0 0 10px ${conectado === 'Conectado' ? '#2ecc71' : '#e74c3c'};"></span><strong style="color:${conectado === 'Conectado' ? '#2ecc71' : '#e74c3c'};">${conectado}</strong></span></td>
            <td>
                <form method="POST" action="/admin-delete" style="display:inline;" 
                      onsubmit="return confirm('Tem certeza que quer DELETAR o usuário \\'${escapeJS(user)}\\'?')">
                    <input type="hidden" name="user" value="${escapeHTML(user)}">
                    <button type="submit" 
                            style="background:#e74c3c;padding:8px 16px;border:none;border-radius:8px;color:white;cursor:pointer;font-size:0.9rem;">
                        Deletar
                    </button>
                </form>
            </td>
        </tr>`;
    }

    if (!listaUsuarios) {
        listaUsuarios = '<tr><td colspan="3" style="text-align:center;color:#95a5a6;padding:30px 0;">Nenhum cliente cadastrado ainda</td></tr>';
    }

    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin • WhatsApp Multi-Instância</title>

    <!-- Google Fonts sem aviso no console -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#2c3e50,#34495e);min-height:100vh;color:#fff;padding:20px;}
        .container{max-width:900px;margin:auto;background:rgba(255,255,255,0.08);backdrop-filter:blur(12px);border-radius:20px;padding:40px;box-shadow:0 20px 40px rgba(0,0,0,0.4);}
        h1{font-size:2.5rem;text-align:center;margin-bottom:10px;}
        .subtitle{text-align:center;opacity:0.8;margin-bottom:40px;}
        .card{background:rgba(255,255,255,0.1);border-radius:16px;padding:30px;margin-bottom:30px;}
        h2{font-size:1.6rem;margin-bottom:20px;color:#1abc9c;}
        form{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;}
        input{padding:14px 18px;border:none;border-radius:12px;background:rgba(255,255,255,0.2);color:white;font-size:1rem;flex:1;min-width:200px;}
        input::placeholder{color:rgba(255,255,255,0.7);}
        button{padding:14px 28px;background:#1abc9c;border:none;border-radius:12px;color:white;font-weight:600;cursor:pointer;transition:all .3s;}
        button:hover{background:#16a085;transform:translateY(-2px);}
        table{width:100%;border-collapse:collapse;margin-top:20px;}
        th,td{padding:16px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);}
        th{background:rgba(255,255,255,0.1);font-weight:600;}
        tr:hover{background:rgba(255,255,255,0.05);}
        .footer{margin-top:50px;text-align:center;opacity:0.7;font-size:0.9rem;}
        .status-on{color:#2ecc71;}
        .status-off{color:#e74c3c;}
        .logout{position:fixed;top:20px;right:30px;background:#e74c3c;padding:10px 20px;border-radius:30px;color:white;text-decoration:none;font-weight:600;z-index:1000;}
        .fab{position:fixed;bottom:30px;right:30px;background:linear-gradient(90deg,#25D366,#128C7E);color:white;padding:18px 28px;border-radius:50px;text-decoration:none;font-weight:600;font-size:1.1rem;box-shadow:0 10px 30px rgba(37,211,102,0.5);z-index:1000;transition:all .3s;display:flex;align-items:center;gap:10px;}
        .fab:hover{transform:scale(1.05);box-shadow:0 15px 40px rgba(37,211,102,0.6);}
    </style>
</head>
<body>
    <div class="container">
        <form action="/admin-logout" method="POST" style="display:inline;">
  <button type="submit" style="background:#e74c3c;padding:10px 20px;border:none;border-radius:30px;color:white;font-weight:600;cursor:pointer;" 
          onclick="return confirm('Tem certeza que quer sair?')">
    Sair
  </button>
</form>

        <h1>Administração</h1>
        <p class="subtitle">Gerencie todos os clientes do sistema</p>

        <div class="card">
            <h2>Criar Novo Cliente</h2>
            <form method="POST" action="/admin-create">
                <input type="text" name="user" placeholder="Nome do usuário (ex: cliente1)" required>
                <input type="password" name="pass" placeholder="Senha do cliente" required>
                <button type="submit">Criar Usuário</button>
            </form>
        </div>

        <div class="card">
            <h2>Clientes Cadastrados (${Object.keys(usuarios).length - 1})</h2>
            <table>
                <thead><tr><th>Usuário</th><th>Status</th><th>Ação</th></tr></thead>
                <tbody>${listaUsuarios}</tbody>
            </table>
        </div>

        <div class="footer">
            WhatsApp Multi-Instância • 2025 • Sessões ativas: ${Object.keys(clientMap).length}
            <p style="margin-top:10px;opacity:0.8;font-size:0.9rem;">Logado como <strong>ADMIN</strong></p>
        </div>

        <a href="/login" class="fab">
            Ir para Login do Cliente
        </a>
    </div>
</body>
</html>`);
});

app.post('/admin-create', requireAdmin, async (req, res) => {

    const { user, pass } = req.body;
    if (!user || !pass) return res.send('Preencha usuário e senha');
    if (usuarios[user]) return res.send(`Usuário "${user}" já existe!`);

    usuarios[user] = { senha: await bcrypt.hash(pass, 10) };
    fs.writeFileSync(usersFilePath, JSON.stringify(usuarios, null, 2));
    console.log(`[ADMIN] Novo cliente criado: ${user}`);

    res.send(`
        <script>
            alert('Usuário "${user}" criado com sucesso!');
            setTimeout(() => { window.location = '/admin' }, 1000);
        </script>
    `);
});
app.post('/admin-delete', requireAdmin, (req, res) => {

    const { user } = req.body;
    if (!user || user === ADMIN_USER) return res.send('Erro: não pode deletar este usuário');

    // Remove do JSON
    delete usuarios[user];
    fs.writeFileSync(usersFilePath, JSON.stringify(usuarios, null, 2));

    // Remove sessão e instância
    if (clientMap[user]) {
        clientMap[user].destroy().catch(() => { });
        delete clientMap[user];
    }
    const sessionPath = path.join(__dirname, 'sessions', user);
    fs.rmSync(sessionPath, { recursive: true, force: true });

    console.log(`[ADMIN] Cliente deletado: ${user}`);

    res.send(`
        <script>
            alert('Usuário "${user}" deletado com sucesso!');
            setTimeout(() => { window.location = '/admin' }, 1000);
        </script>
    `);
});
app.post('/admin-logout', (req, res) => {
    // Força o navegador a pedir usuário/senha de novo na próxima vez
    res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
    res.status(401).send(`
        <script>
            alert('Você foi deslogado com sucesso!');
            setTimeout(() => location.href = '/login', 500);
        </script>
        Você foi deslogado. Redirecionando...
    `);
});
/**
 // ← COLOQUE AQUI (bem no comecinho)
app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '???';
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
    console.log('\n+------------------ WHATSAPP BOT RECEBEU ------------------');
    console.log(` ${agora} ¦ ${req.method.padEnd(6)} ¦ ${req.path.padEnd(20)} ¦ IP: ${ip}`);
    console.log(` Query  ?`, req.query);
    console.log(` Body   ?`, req.body || '(vazio)');
    console.log(` Headers? Content-Type: ${req.get('content-type') || '???'} | UA: ${req.get('user-agent')?.slice(0, 50) || '???'}`);
    console.log('+-----------------------------------------------------------\n');
    next(); // ← ESSA LINHA É OBRIGATÓRIA!!!
});
 */
// ============================================= ROTA 404 – DEVE VIR ANTES DO LISTEN!!! =============================================
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: "Rota não encontrada",
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// ============================================= ERRO GLOBAL (opcional, mas recomendado) =============================================
app.use((err, req, res, next) => {
    console.error("[ERRO GLOBAL]", err);
    res.status(500).json({ success: false, error: "Erro interno do servidor" });
});


// limpa boleto que ficou pra trás e trava de launching
setInterval(() => {
    // limpa trava que ficou presa
    for (const k of Object.keys(qrStore)) {
        if (k.endsWith('_launching')) delete qrStore[k];
    }
    // limpa pdfs temporários de boleto
    fs.readdirSync(__dirname).forEach(f => {
        if (f.startsWith('boleto_') && f.endsWith('.pdf')) {
            try { fs.unlinkSync(path.join(__dirname, f)); } catch{}
        }
    });
}, 60 * 60 * 1000); // 1x por hora


// ============================================= START DO SERVIDOR – SEMPRE POR ÚLTIMO!!! =============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nSERVIDOR RODANDO COM SUCESSO NA PORTA ${PORT}`);
    const host = process.env.HOST_IP || 'localhost';
    console.log(`Login →      http://${host}:${PORT}/login`);
    console.log(`Admin →      http://${host}:${PORT}/admin`);
    console.log(`API   → POST http://${host}:${PORT}/send-message\n`);
});
