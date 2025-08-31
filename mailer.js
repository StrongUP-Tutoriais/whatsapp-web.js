// mailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // TLS
    auth: {
        user: "jacoleonehc@gmail.com",
        pass: "mtvomxvplgnahqto" // senha de app do Gmail
    },
    tls: {
        rejectUnauthorized: false // ignora erro de certificado
    }
});

async function sendAlert(subject, message) {
    try {
        await transporter.sendMail({
            from: '"Monitor WhatsApp" <jacoleonehc@gmail.com>',
            to: "jacoleonehc@gmail.com",
            subject,
            text: message,
        });
        console.log("📧 Alerta enviado por e-mail:", subject);
    } catch (err) {
        console.error("❌ Erro ao enviar e-mail:", err.message);
    }
}

module.exports = { sendAlert };
