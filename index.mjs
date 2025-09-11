// index.mjs
import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import express from "express";
import { MongoClient } from "mongodb";

// --- CONFIGURAÇÃO DO MONGODB ---
const uri = "mongodb+srv://andersonsiilva99:EyX75uhGALtck6Ag@bot-financeiro.xdlrglh.mongodb.net/?retryWrites=true&w=majority&appName=bot-financeiro";
const clientDB = new MongoClient(uri);
await clientDB.connect();
const db = clientDB.db("botFinanceiro");
const lancamentos = db.collection("lancamentos");

// --- WHATSAPP BOT ---
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

client.on("qr", qr => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("🤖 Bot do WhatsApp está online!");
});

client.on("message", async msg => {
  const texto = msg.body.trim().toLowerCase();

  // Registrar lançamento ex: "gastei 50 mercado"
  if (texto.startsWith("gastei")) {
    const partes = texto.split(" ");
    const valor = parseFloat(partes[1]);
    const categoria = partes.slice(2).join(" ") || "outros";

    if (!isNaN(valor)) {
      await lancamentos.insertOne({
        valor,
        categoria,
        data: new Date()
      });
      msg.reply(`✅ Lançamento registrado: R$${valor.toFixed(2)} em ${categoria}`);
    } else {
      msg.reply("⚠️ Não entendi o valor. Use: gastei 50 mercado");
    }
  }

  // Consultar total
  else if (texto === "total") {
    const gastos = await lancamentos.aggregate([
      { $group: { _id: null, total: { $sum: "$valor" } } }
    ]).toArray();

    const total = gastos.length > 0 ? gastos[0].total : 0;
    msg.reply(`💰 Seu total de gastos é: R$${total.toFixed(2)}`);
  }

  // Consultar por categoria
  else if (texto.startsWith("total ")) {
    const categoria = texto.replace("total ", "");
    const gastos = await lancamentos.aggregate([
      { $match: { categoria } },
      { $group: { _id: null, total: { $sum: "$valor" } } }
    ]).toArray();

    const total = gastos.length > 0 ? gastos[0].total : 0;
    msg.reply(`📊 Total em ${categoria}: R$${total.toFixed(2)}`);
  }
});

// --- API EXPRESS (opcional para Render pingar e manter ativo) ---
const app = express();
app.get("/", (req, res) => res.send("Bot financeiro rodando 🚀"));
app.listen(3000, () => console.log("Servidor web ativo na porta 3000"));

client.initialize();
