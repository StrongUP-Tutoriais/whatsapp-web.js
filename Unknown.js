require("./auto-loader");
const express = require('express');
const bodyParser = require('body-parser');
const { Client, Location, Poll, List, Buttons, LocalAuth, MessageMedia } = require('./index');
const qrcodeterm = require("qrcode-terminal");
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ===============================
// NOVO: Carrega usuarios.json
// ===============================
const usersFilePath = path.join(__dirname, "usuarios.json");
let usuarios = {};

if (fs.existsSync(usersFilePath)) {
    usuarios = JSON.parse(fs.readFileSync(usersFilePath));
    console.log(`[LOG] usuarios.json carregado → ${Object.keys(usuarios).length} usuário(s) encontrado(s)`);
} else {
    fs.writeFileSync(usersFilePath, JSON.stringify({}, null, 2));
    console.log("[LOG] usuarios.json criado (vazio)");
}

// ===============================
// NOVO: Mapa de instâncias
// ===============================
const clientMap = {};
const qrStore = {};

// Rate limiter original
const limiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    message: 'Muitas requisições vindas deste IP, tente novamente mais tarde.',
    headers: true
});

const app = express();
app.use(limiter);
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// FUNÇÃO ATUALIZADA: criarInstancia() COM LIMITE DE QR (PRODUÇÃO 2025)
// ==========================================
function criarInstancia(usuario) {
    if (clientMap[usuario]) {
        return clientMap[usuario];
    }

    console.log(`[INSTÂNCIA] Criando nova instância para: ${usuario}`);

    const sessionPath = path.join(__dirname, 'sessions', usuario);

    // === CONTROLE DE TENTATIVAS POR USUÁRIO ===
    const qrAttempts = { count: 0, timeout: null };
    const MAX_QR_ATTEMPTS = 4;        // Máximo 4 QRs (recomendado em produção)
    const QR_EXPIRE_TIME = 60000;     // 60 segundos por QR

    const client = new Client({
        authStrategy: new LocalAuth({ client: usuario, dataPath: sessionPath }),
        puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true },
    });


    client.on("qr", (qr) => {
        qrAttempts.count++;

        if (qrAttempts.count > MAX_QR_ATTEMPTS) {
            console.log(`\n[LIMITE] ${usuario.toUpperCase()} atingiu ${MAX_QR_ATTEMPTS} tentativas. Parando.`);
            delete qrStore[usuario];
            client.destroy().catch(() => { });
            delete clientMap[usuario];
            return;
        }

        console.log(`QR CODE ${qrAttempts.count}/${MAX_QR_ATTEMPTS} → ${usuario.toUpperCase()}`);
        // qrcodeterm.generate(qr, { small: true });
        qrStore[usuario] = qr;

        // Limpa timeout antigo
        if (qrAttempts.timeout) clearTimeout(qrAttempts.timeout);

        // Expira o QR em 60s e remove do qrStore (obrigatório!)
        qrAttempts.timeout = setTimeout(() => {
            console.log(`[QR EXPIRADO] QR ${qrAttempts.count} de ${usuario} expirou → removido do qrStore`);
            delete qrStore[usuario]; // ← ESSA LINHA SALVA VIDAS
        }, QR_EXPIRE_TIME);
    });

    client.on("authenticated", () => {
        console.log(`[OK] Autenticado com sucesso: ${usuario}`);
        qrAttempts.count = 0;
        if (qrAttempts.timeout) clearTimeout(qrAttempts.timeout);
        delete qrStore[usuario]; // Limpa QR da memória
    });

    client.on("ready", () => {
        console.log(`[ONLINE] WhatsApp conectado → ${usuario}`);
        console.warn(`Instância pronta: ${usuario} | Sessão salva em: ${sessionPath}\n`);
    });

    client.on("auth_failure", (msg) => {
        console.log(`[FALHA] Autenticação falhou → ${usuario}: ${msg}`);
    });

    client.on("disconnected", (reason) => {
        console.log(`[DESCONECTADO] ${usuario} | Motivo: ${reason}`);

        // Se foi logout manual ou sessão inválida → não reconecta
        if (reason === "invalid_session" || reason === "logged_out") {
            console.log(`[PARADO] Sessão inválida. Não será reconectado automaticamente.`);
            delete clientMap[usuario];
            delete qrStore[usuario];
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    });

    // Garante pasta da sessão
    try {
        fs.mkdirSync(sessionPath, { recursive: true });
    } catch (e) {
        console.error(`Erro criando pasta ${sessionPath}: ${e.message}`);
    }

    console.log(`[INIT] Inicializando cliente → ${usuario}`);
    client.initialize();
    clientMap[usuario] = client;

    return client;
}
// ==========================================
// INSTÂNCIA PADRÃO "admin" – INICIA AUTOMATICAMENTE
// ==========================================
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!usuarios[ADMIN_USER]) {
    usuarios[ADMIN_USER] = { senha: ADMIN_PASS };
    fs.writeFileSync(usersFilePath, JSON.stringify(usuarios, null, 2));
    console.log(`[ADMIN] Usuário admin criado → ${ADMIN_USER}`);
}

console.log(`\n[ADMIN] Iniciando instância oficial: ${ADMIN_USER}`);
const adminClient = criarInstancia(ADMIN_USER);

let clientStatus = 'initializing';
adminClient.on('ready', () => clientStatus = 'ready');
adminClient.on('qr', () => clientStatus = 'qr');
adminClient.on('disconnected', () => clientStatus = 'disconnected');


// ==========================================
// LOGIN COM BOTÃO PARA O PAINEL DO ADMIN
// ==========================================
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

// ==========================================
// NOVO: Processo de login (AGORA COM REDIRECIONAMENTO AUTOMÁTICO APÓS 4 TENTATIVAS)
// ==========================================
app.post('/login-post', async (req, res) => {
    const { user, pass } = req.body;
    if (!user) return res.send("Envie o usuário.");
    if (!usuarios[user]) return res.send("Usuário não encontrado.");
    if (usuarios[user].senha !== pass) {
        console.log(`[LOGIN] Senha incorreta para: ${user}`);
        return res.send("Senha incorreta.");
    }
    criarInstancia(user);

    const timeout = 20000;
    const interval = 1000;
    const start = Date.now();

    (function waitForQR() {
        if (qrStore[user]) {
            return QRCode.toDataURL(qrStore[user], (err, url) => {
                if (err) return res.send("Erro ao gerar imagem do QR.");
                return res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp Connect • ${user.toUpperCase()}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Inter',-apple-system,system-ui,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;}
        .card{background:rgba(255,255,255,0.1);backdrop-filter:blur(12px);border-radius:20px;border:1px solid rgba(255,255,255,0.2);padding:40px 30px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.3);}
        h2{font-size:1.8rem;margin-bottom:8px;font-weight:700;}
        .user{font-size:1.1rem;opacity:0.9;margin-bottom:30px;}
        .qr-container{background:white;padding:20px;border-radius:16px;display:inline-block;margin:20px 0;box-shadow:0 10px 30px rgba(0,0,0,0.2);}
        .qr-container img{width:260px;height:260px;border-radius:12px;}
        .instructions{margin-top:30px;line-height:1.7;font-size:1rem;opacity:0.95;}
        .steps{margin:20px 0;text-align:left;display:inline-block;background:rgba(255,255,255,0.15);padding:16px 20px;border-radius:12px;font-size:0.95rem;}
        .steps li{margin:10px 0;}
        .refresh{margin-top:25px;padding:12px 28px;background:rgba(255,255,255,0.25);border:none;border-radius:50px;color:white;font-weight:600;cursor:pointer;transition:all 0.3s;font-size:1rem;}
        .refresh:hover{background:rgba(255,255,255,0.4);transform:translateY(-2px);}
        .status{margin-top:20px;font-size:0.9rem;opacity:0.8;}
        .whatsapp-icon{width:60px;height:60px;background:#25d366;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px;box-shadow:0 8px 20px rgba(37,211,102,0.4);}
        footer{margin-top:40px;font-size:0.85rem;opacity:0.7;}
    </style>
    <script>
        setTimeout(() => location.reload(), 15000);
        setInterval(() => {
            fetch('/check-qr?user=${user}').then(r => r.json()).then(data => {
                if (!data.hasQR) window.location.href = '/login';
            });
        }, 3000);
    </script>
</head>
<body>
    <div class="card">
        <div class="whatsapp-icon">SMS</div>
        <h2>Conectar WhatsApp</h2>
        <div class="user">Usuário: <strong>${user.toUpperCase()}</strong></div>
        <div class="qr-container">
            <img src="${url}" alt="QR Code WhatsApp">
        </div>
        <div class="instructions">
            <strong>Como conectar:</strong>
            <div class="steps">
                <ol>
                    <li>Abra o WhatsApp no seu celular</li>
                    <li>Vá em Configurações → Aparelhos conectados</li>
                    <li>Toque em "Conectar um aparelho"</li>
                    <li>Escaneie este QR Code</li>
                </ol>
            </div>
            <p>Após escanear, aguarde aparecer no terminal:<br>
            <strong>"WHATSAPP PRONTO E CONECTADO"</strong></p>
        </div>
        <button class="refresh" onclick="location.reload()">Atualizar QR</button>
        <div class="status">
            Página atualiza automaticamente a cada 15 segundos<br>
            QR Code expira em alguns minutos
        </div>
        <footer>Multi-Instância WhatsApp • 2025</footer>
    </div>
</body>
</html>
                `);
            });
        }

        // AQUI É A PARTE NOVA (timeout inteligente)
        if (Date.now() - start >= timeout) {
            console.log(`[LOGIN] Timeout 20s → verificando se ${user} já está conectado...`);

            const client = clientMap[user];
            if (client && client.info) {
                // JÁ ESTÁ CONECTADO!
                return res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Já Conectado • ${user.toUpperCase()}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;}
        .card{background:rgba(255,255,255,0.12);backdrop-filter:blur(14px);border-radius:24px;padding:50px 40px;max-width:420px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.35);}
        .icon{width:90px;height:90px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 25px;font-size:48px;}
        h2{font-size:2rem;margin-bottom:15px;}
        p{line-height:1.7;margin:12px 0;}
    </style>
    <script>
        let s = 20;
        const t = setInterval(() => {
            s--;
            document.getElementById('c').innerText = s;
            if(s <= 0) {
                clearInterval(t);
                window.location.href = '/login';
            }
        }, 1000);
    </script>
</head>
<body>
    <div class="card">
        <div class="icon">Check</div>
        <h2>Você já está conectado!</h2>
        <p><strong>${user.toUpperCase()}</strong></p>
        <p>Sua sessão está ativa e pronta para uso.</p>
        <p>Pode fechar esta aba ou usar a API.</p>
        <p style="margin-top:30px;background:rgba(255,255,255,0.15);padding:12px;border-radius:12px;">
            Redirecionando em <strong id="c">20</strong> segundos...
        </p>
    </div>
</body>
</html>
                `);
            } else {
                return res.send("QR não foi gerado a tempo. Tente novamente ou verifique o terminal.");
            }
        }

        setTimeout(waitForQR, interval);
    })();
});

// ROTA AUXILIAR para o JavaScript da página verificar se o QR ainda existe
app.get('/check-qr', (req, res) => {
    res.json({ hasQR: !!qrStore[req.query.user] });
});

// ==========================================
// Funções auxiliares
// ==========================================
function validarUsuarioSenha(user, pass) {
    return usuarios[user] && usuarios[user].senha === pass;
}

function pegarInstancia(user) {
    return clientMap[user] || null;
}

// ==========================================
// ROTA /APIWPP/send-message → MULTI-INSTÂNCIA (NÍVEL MK-AUTH 2025)
// ==========================================
app.post('/APIWPP/send-message', async (req, res) => {
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

app.post('/APIWPP/send-document', async (req, res) => {
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
        if (numero.length === 10) numero = '55' + numero; // caso venha sem o 9
        if (!/^55\d{10,11}$/.test(numero)) {
            return res.status(400).json({ success: false, error: "Número inválido" });
        }

        // === CORRIGE BASE64 DO MK-AUTH ===
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
        tempFilePath = path.join(__dirname, `boleto_${Date.now()}_${numero.slice(-4)}.pdf`);
        fs.writeFileSync(tempFilePath, buffer);
        const media = MessageMedia.fromFilePath(tempFilePath);

        const chatId = `${numero}@s.whatsapp.net`;

        // === ENVIA DOCUMENTO ===
        await instancia.sendMessage(chatId, media);

        // === ENVIA TEXTO APÓS 2 SEGUNDOS ===
        await new Promise(r => setTimeout(r, 2000));
        await instancia.sendMessage(chatId, `*Segue seu boleto em anexo!*`);

        // === LIMPA TEMP ===
        fs.unlinkSync(tempFilePath);
        tempFilePath = null;

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

        console.error(`[DOC] Erro (${login} → ${to}): ${error.message}`);

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

// LEITOR TURBO 2025 ? 9 LINHAS, PEGA TUDO
/**
 * app.use((req, res) => {
    const ip = req.ip || req.socket.remoteAddress || '???';
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
    console.log('\n+------------------ WHATSAPP BOT RECEBEU ------------------');
    console.log(` ${agora} ¦ ${req.method.padEnd(6)} ¦ ${req.path.padEnd(20)} ¦ IP: ${ip}`);
    console.log(` Query  ?`, req.query);
    console.log(` Body   ?`, req.body || '(vazio)');
    console.log(` Headers? Content-Type: ${req.get('content-type') || '???'} | UA: ${req.get('user-agent')?.slice(0, 50) || '???'}`);
    console.log('+-----------------------------------------------------------\n');
    res.json({ ok: true, mensagem: "DADOS MOSTRADOS NO TERMINAL ? olhe aí!", recebido_as: agora });
});
 */


// ==========================================
// ROTA ADMIN: /admin → Painel de administração (versão segura mínima)
// ==========================================
app.get('/admin', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')}`) {
        res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('Acesso negado');
    }

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
            <td><span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:50%;background:${conectado==='Conectado'?'#2ecc71':'#e74c3c'};box-shadow:0 0 10px ${conectado==='Conectado'?'#2ecc71':'#e74c3c'};"></span><strong style="color:${conectado==='Conectado'?'#2ecc71':'#e74c3c'};">${conectado}</strong></span></td>
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
  <button type="submit" class="background:#e74c3c;padding:10px 20px;border:none;border-radius:30px;color:white;font-weight:600;cursor:pointer;" 
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
// ==========================================
// Criar novo usuário
// ==========================================
app.post('/admin-create', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')}`) {
        return res.status(401).send('Acesso negado');
    }

    const { user, pass } = req.body;
    if (!user || !pass) return res.send('Preencha usuário e senha');
    if (usuarios[user]) return res.send(`Usuário "${user}" já existe!`);

    usuarios[user] = { senha: pass };
    fs.writeFileSync(usersFilePath, JSON.stringify(usuarios, null, 2));
    console.log(`[ADMIN] Novo cliente criado: ${user}`);

    res.send(`
        <script>
            alert('Usuário "${user}" criado com sucesso!');
            setTimeout(() => { window.location = '/admin' }, 1000);
        </script>
    `);
});

// ==========================================
// Deletar usuário
// ==========================================
app.post('/admin-delete', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')}`) {
        return res.status(401).send('Acesso negado');
    }

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

// ROTA DE LOGOUT (funciona com Basic Auth também)
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

// Inicializa o servidor Express na porta 8000
app.listen(8000, () => {
    console.warn('Servidor rodando na porta 8000');
});