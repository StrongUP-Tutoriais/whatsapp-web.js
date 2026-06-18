# WhatsApp Multi-Instância MK-AUTH 2025

Servidor Node.js para rodar **várias contas de WhatsApp** no mesmo servidor, com login por QR Code, API de envio e painel admin. Baseado em whatsapp-web.js com sessões isoladas.

> Este README foi gerado a partir do seu Unknown.js

---

## 🚀 Funcionalidades Principais

- ✅ **Multi-tenant real** - cada cliente em /sessions/usuario
- ✅ **Login via QR** com página /login auto-refresh
- ✅ **API /send-message** e **/send-document** (PDF + vídeo)
- ✅ **Painel Admin** com criação/deleção de usuários
- ✅ **bcrypt** - senhas criptografadas e migração automática
- ✅ **Controle de QR** - max 4 tentativas, expira 60s
- ✅ **Reconexão inteligente** para NAVIGATION/TIMEOUT
- ✅ **Log diferenciado PV e Grupo** (seu código atual)

## 📦 Instalação

```bash
npm install express whatsapp-web.js qrcode qrcode-terminal dotenv bcrypt
```

Crie o `.env`:

```env
ADMIN_USER=admin
ADMIN_PASS=qualquercoisa
PORT=8000
HOST_IP=127.0.0.1
CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
```

Inicie:
```bash
node Unknown.js
```

## 🗂️ Estrutura do Projeto

```
/whatsapp-web.js/
├── Unknown.js # <--- seu arquivo principal
├── usuarios.json # criado automaticamente
├── sessions/
│ ├── admin/
│ └── cliente1/
└── videos/
    └── Video_Explicativo.mp4
```

## 🔑 Rotas da API

### 1. Enviar Mensagem
`POST /send-message`
```json
{
  "login": "cliente1",
  "pass": "123456",
  "to": "859888813826",
  "msg": "Olá do MK-AUTH"
}
```

### 2. Enviar Documento
`POST /send-document`

### 3. Admin
- `GET /admin` - Basic Auth
- `POST /admin-create`
- `POST /admin-delete`

## 💡 Seu Código de Log (PV e Grupo)

Este é o trecho que você ajustou no criarInstancia():

```javascript
client.on('message', async (msg) => {
    try {
        if (msg.fromMe) return;
        const isGrupo = msg.from.endsWith('@g.us');
        if (isGrupo) {
            const chat = await msg.getChat();
            const contato = await msg.getContact();
            const nomeGrupo = chat.name || 'Grupo';
            const nomePessoa = contato.pushname || contato.name || 'Desconhecido';
            const numero = contato.id.user;
            console.log('[MSG GRUPO] ' + usuario + ' ← ' + nomeGrupo + ' | ' + nomePessoa + ' (' + numero + '): ' + msg.body);
        } else {
            const contato = await msg.getContact();
            const nome = contato.pushname || contato.name || 'Desconhecido';
            const numero = contato.id.user || msg.from.split('@')[0];
            console.log('[MSG PV] ' + usuario + ' ← ' + nome + ' (' + numero + '): ' + msg.body);
        }
    } catch (e) {
        console.log('[MSG RECEBIDA] ' + usuario + ' ← ' + msg.from + ': ' + msg.body);
    }
});
```

Saída no terminal:
```
[MSG PV] admin ← Vaneza Karen (558588813826): c
[MSG GRUPO] admin ← Meular | Vaneza Karen (558588813826): 1
```

## 🛡️ Segurança Implementada

1. **validarUsuarioSenha()** - aceita hash bcrypt
2. **requireAdmin** - protege rotas admin
3. **Sessões isoladas** com LocalAuth
4. **Limpeza automática** de sessão em logout

## 📄 Licença

MIT - Projeto MK-AUTH 2025
