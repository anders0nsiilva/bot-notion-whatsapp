//// index.mjs

// Importa as bibliotecas necessárias
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { MongoClient, ServerApiVersion } from 'mongodb';

// --- CONFIGURAÇÃO DO MONGODB ---
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('A variável de ambiente MONGODB_URI não foi definida!');
}

const clientDB = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, lancamentos;

async function connectToDatabase() {
  try {
    await clientDB.connect();
    db = clientDB.db("botFinanceiro");
    lancamentos = db.collection("lancamentos");
    console.log("✅ Conectado com sucesso ao MongoDB Atlas!");
  } catch (e) {
    console.error("❌ Falha ao conectar ao MongoDB Atlas", e);
    process.exit(1);
  }
}

// --- LÓGICA DO WHATSAPP-WEB.JS ---

console.log('Iniciando o cliente do WhatsApp...');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
  }
});

client.on('qr', qr => {
  console.log('QR Code recebido! Escaneie com seu celular:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Cliente do WhatsApp está pronto e conectado!');
});

client.on('message', async msg => {
  if (!msg.fromMe) {
    return;
  }

  const texto = msg.body.trim().toLowerCase();
  console.log(`Mensagem sua recebida: "${texto}"`);

  try {
    if (texto.startsWith("gastei ")) {
      const partes = texto.split(" ");
      if (partes.length < 3) {
        return msg.reply("⚠️ Formato inválido. Use: gastei 50 mercado");
      }
      const valor = parseFloat(partes[1]);
      const categoria = partes.slice(2).join(" ");

      if (!isNaN(valor)) {
        await lancamentos.insertOne({ valor, categoria, data: new Date() });
        msg.reply(`✅ Lançamento registrado: R$${valor.toFixed(2)} em ${categoria}`);
      } else {
        msg.reply("⚠️ Não entendi o valor. Use: gastei 50 mercado");
      }
    }
    else if (texto === "total") {
      const gastos = await lancamentos.aggregate([{ $group: { _id: null, total: { $sum: "$valor" } } }]).toArray();
      const total = gastos.length > 0 ? gastos[0].total : 0;
      msg.reply(`💰 Seu total de gastos é: R$${total.toFixed(2)}`);
    }
    else if (texto.startsWith("total ")) {
      const categoria = texto.replace("total ", "");
      const gastos = await lancamentos.aggregate([{ $match: { categoria } }, { $group: { _id: null, total: { $sum: "$valor" } } }]).toArray();
      const total = gastos.length > 0 ? gastos[0].total : 0;
      msg.reply(`📊 Total em ${categoria}: R$${total.toFixed(2)}`);
    }
  } catch (err) {
    console.error("Erro ao processar comando:", err.message);
    msg.reply(`🤖 Ocorreu um erro no banco de dados.`);
  }
});

// --- INICIALIZAÇÃO ---

async function start() {
  await connectToDatabase();
  await client.initialize();
  console.log("Bot inicializado e pronto para receber mensagens.");
}

start();
