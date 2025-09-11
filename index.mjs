// Importações
import makeWASocket, { useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { MongoClient, ServerApiVersion } from "mongodb";

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
  await clientDB.connect();
  db = clientDB.db("botFinanceiro");
  lancamentos = db.collection("lancamentos");
  console.log("✅ Conectado com sucesso ao MongoDB Atlas!");
}

// --- INICIALIZAÇÃO DO BOT ---
async function startBot() {
  await connectToDatabase();

  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth");

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console.log)
    },
    printQRInTerminal: true // Mostra QR direto no terminal
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("📱 Escaneie este QR Code:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log("✅ Bot conectado ao WhatsApp!");
    } else if (connection === "close") {
      console.log("❌ Conexão fechada. Tentando reconectar...");
      startBot();
    }
  });

  // --- MENSAGENS ---
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const texto = msg.message.conversation?.trim().toLowerCase();
    if (!texto) return;

    console.log(`📩 Mensagem recebida: "${texto}"`);

    try {
      if (texto.startsWith("gastei ")) {
        const partes = texto.split(" ");
        if (partes.length < 3) {
          return await sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Formato inválido. Use: gastei 50 mercado" });
        }
        const valor = parseFloat(partes[1]);
        const categoria = partes.slice(2).join(" ");

        if (!isNaN(valor)) {
          await lancamentos.insertOne({ valor, categoria, data: new Date() });
          await sock.sendMessage(msg.key.remoteJid, { text: `✅ Lançamento registrado: R$${valor.toFixed(2)} em ${categoria}` });
        } else {
          await sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Não entendi o valor. Use: gastei 50 mercado" });
        }
      }
      else if (texto === "total") {
        const gastos = await lancamentos.aggregate([{ $group: { _id: null, total: { $sum: "$valor" } } }]).toArray();
        const total = gastos.length > 0 ? gastos[0].total : 0;
        await sock.sendMessage(msg.key.remoteJid, { text: `💰 Seu total de gastos é: R$${total.toFixed(2)}` });
      }
      else if (texto.startsWith("total ")) {
        const categoria = texto.replace("total ", "");
        const gastos = await lancamentos.aggregate([{ $match: { categoria } }, { $group: { _id: null, total: { $sum: "$valor" } } }]).toArray();
        const total = gastos.length > 0 ? gastos[0].total : 0;
        await sock.sendMessage(msg.key.remoteJid, { text: `📊 Total em ${categoria}: R$${total.toFixed(2)}` });
      }
    } catch (err) {
      console.error("Erro ao processar comando:", err.message);
      await sock.sendMessage(msg.key.remoteJid, { text: "🤖 Ocorreu um erro no banco de dados." });
    }
  });
}

startBot();
