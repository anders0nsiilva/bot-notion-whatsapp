// index.mjs

// Importa as bibliotecas necessárias
import express from 'express';
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { google } from 'googleapis';

// --- CONFIGURAÇÃO INICIAL ---
const app = express();

// Carrega as credenciais para a API do Google Sheets.
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

// --- LÓGICA DO GOOGLE SHEETS (COPIADA DO PROJETO ANTERIOR) ---

async function adicionarLinhaNaPlanilha(descricao, valor, categoria, tipo) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  } );
  const sheets = google.sheets({ version: "v4", auth });
  const novaLinha = [new Date().toISOString(), descricao, valor, categoria, tipo];
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Página1!A:E",
    valueInputOption: "USER_ENTERED",
    resource: { values: [novaLinha] },
  });
}

async function calcularTotalPorTipoNaPlanilha(tipo) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  } );
  const sheets = google.sheets({ version: "v4", auth });
  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Página1!C:E",
  });
  const linhas = resposta.data.values;
  if (!linhas || linhas.length === 0) return 0;
  return linhas.reduce((soma, linha) => {
    if (linha && linha.length > 2) {
      const valorDaLinha = parseFloat(String(linha[0]).replace(",", ".") || 0);
      const tipoDaLinha = linha[2];
      if (tipoDaLinha && tipoDaLinha.toLowerCase() === tipo.toLowerCase() && !isNaN(valorDaLinha)) {
        return soma + valorDaLinha;
      }
    }
    return soma;
  }, 0);
}

// --- LÓGICA DO WHATSAPP-WEB.JS ---

console.log('Iniciando o cliente do WhatsApp...');

const client = new Client({
  authStrategy: new LocalAuth(), // Salva a sessão para não precisar escanear o QR Code toda vez
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Isso é para ambientes com pouca memória como o Render
      '--disable-gpu'
    ],
  }
});

// Evento 1: Geração do QR Code
client.on('qr', qr => {
  console.log('QR Code recebido! Escaneie com seu celular:');
  qrcode.generate(qr, { small: true });
});

// Evento 2: Cliente autenticado e pronto
client.on('ready', () => {
  console.log('✅ Cliente do WhatsApp está pronto e conectado!');
});

// Evento 3: Mensagem recebida
client.on('message', async msg => {
  // Ignora mensagens que não sejam suas para segurança
  if (!msg.fromMe) {
    return;
  }

  const textoDaMensagem = msg.body;
  console.log(`Mensagem sua recebida: "${textoDaMensagem}"`);

  const partes = textoDaMensagem.split(",").map(part => part.trim());

  if (partes.length !== 4) {
    // Se o formato for inválido, simplesmente ignora.
    // Poderíamos enviar uma resposta de erro, mas vamos manter simples.
    if (textoDaMensagem.toLowerCase() === 'ping') {
        msg.reply('pong'); // Comando de teste para verificar se o bot está vivo
    }
    return;
  }

  try {
    let [descricao, valorStr, categoria, tipo] = partes;
    categoria = categoria.charAt(0).toUpperCase() + categoria.slice(1).toLowerCase();
    tipo = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase();
    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
      await client.sendMessage(msg.from, `❌ O valor "${valorStr}" não é um número.`);
      return;
    }

    console.log("A adicionar linha na planilha...");
    await adicionarLinhaNaPlanilha(descricao, valor, categoria, tipo);
    const gastoFormatado = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    console.log(`A consultar planilha para o total de: ${tipo}`);
    const totalPorTipo = await calcularTotalPorTipoNaPlanilha(tipo);
    const totalFormatado = totalPorTipo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const textoResposta = `✅ Gasto de ${gastoFormatado} registado!\n\nTotal de gastos com ${tipo}: ${totalFormatado}`;
    
    console.log(`A enviar resposta...`);
    // Responde na mesma conversa onde a mensagem foi enviada
    await client.sendMessage(msg.from, textoResposta);

  } catch (err) {
    console.error("Erro ao processar a mensagem:", err.message);
    await client.sendMessage(msg.from, `🤖 Ocorreu um erro: ${err.message}`);
  }
});

// Inicia o cliente do WhatsApp
client.initialize();

// Mantém o servidor web rodando para o Render não desligar o serviço
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor de "keep-alive" rodando na porta ${PORT} para manter o bot ativo.`);
});
