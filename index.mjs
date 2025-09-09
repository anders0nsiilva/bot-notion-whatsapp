// Importa as bibliotecas necessárias.
// A 'googleapis' é a biblioteca oficial do Google para aceder às suas APIs.
import express from "express";
import { google } from "googleapis";

// --- CONFIGURAÇÃO INICIAL ---
const app = express();
app.use(express.json());

// Carrega as chaves secretas do WhatsApp a partir das Variáveis de Ambiente.
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Carrega as credenciais para a API do Google Sheets.
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// A chave privada precisa de ser formatada corretamente para ser lida como variável de ambiente.
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

// --- FUNÇÕES DE LÓGICA DE NEGÓCIO (VERSÃO GOOGLE SHEETS) ---

/**
 * Adiciona uma nova linha de dados na planilha do Google Sheets.
 */
async function adicionarLinhaNaPlanilha(descricao, valor, categoria, tipo) {
  // Autenticação com a API do Google
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  // Prepara a linha a ser inserida. A data é adicionada automaticamente.
  const novaLinha = [
    new Date().toISOString(), // Coluna A: Data e Hora
    descricao,               // Coluna B: Descrição
    valor,                   // Coluna C: Valor
    categoria,               // Coluna D: Categoria
    tipo,                    // Coluna E: Tipo
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Página1!A:E", // Assumindo que o separador se chama 'Página1'
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [novaLinha],
    },
  });
}

/**
 * Lê a planilha, filtra por "Tipo" e calcula a soma dos valores.
 */
async function calcularTotalPorTipoNaPlanilha(tipo) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Página1!C:E", // Obtém apenas as colunas Valor, Categoria e Tipo
  });

  const linhas = resposta.data.values;

  if (!linhas || linhas.length === 0) {
    return 0;
  }

  // O reduce soma os valores. Itera por cada linha, verifica se o tipo
  // na coluna E (índice 2) é o que procuramos e, se for, soma o valor da coluna C (índice 0).
  const total = linhas.reduce((soma, linha) => {
    // Garante que a linha e as colunas existem antes de tentar aceder-lhes.
    if (linha && linha.length > 2) {
      const valorDaLinha = parseFloat(String(linha[0]).replace(",", ".") || 0);
      const tipoDaLinha = linha[2];

      if (tipoDaLinha && tipoDaLinha.toLowerCase() === tipo.toLowerCase() && !isNaN(valorDaLinha)) {
        return soma + valorDaLinha;
      }
    }
    return soma;
  }, 0);

  return total;
}

/**
 * Envia uma mensagem de resposta para o utilizador via API do WhatsApp.
 * (Esta função não muda)
 */
async function enviarMensagemWhatsApp(para, texto) {
  const payload = {
    messaging_product: "whatsapp",
    to: para,
    text: { body: texto },
  };

  const response = await fetch(
    `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  const data = await response.json();
  console.log("<- Resposta da API do WhatsApp:", data);
}

// --- ROTAS DA API (A LÓGICA PRINCIPAL) ---

// Rota para a verificação do Webhook (NÃO MUDA)
// IMPORTANTE: A rota agora é /webhook para evitar conflitos.
app.get("/webhook", (req, res) => {
    if (
        req.query["hub.mode"] === "subscribe" &&
        req.query["hub.verify_token"] === VERIFY_TOKEN
      ) {
        res.send(req.query["hub.challenge"]);
      } else {
        res.sendStatus(400);
      }
});

// Rota para receber as mensagens do WhatsApp
app.post("/webhook", async (req, res) => {
  console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!messageObject || messageObject.type !== 'text') {
      return res.sendStatus(200);
    }
    
    const textoDaMensagem = messageObject.text.body;
    const numeroRemetente = messageObject.from;

    const partes = textoDaMensagem.split(",").map(part => part.trim());

    if (partes.length !== 4) {
        const respostaErro = `Formato inválido. Utilize:\nDescrição, Valor, Categoria, Tipo de Pagamento`;
        await enviarMensagemWhatsApp(numeroRemetente, respostaErro);
        return res.sendStatus(200);
    }

    let [descricao, valorStr, categoria, tipo] = partes;
    
    // Capitaliza a primeira letra para consistência
    categoria = categoria.charAt(0).toUpperCase() + categoria.slice(1).toLowerCase();
    tipo = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase();

    const valor = parseFloat(valorStr.replace(",", "."));

    if (isNaN(valor)) {
        const respostaErro = `O valor "${valorStr}" não é um número.`;
        await enviarMensagemWhatsApp(numeroRemetente, respostaErro);
        return res.sendStatus(200);
    }

    console.log("A adicionar linha na planilha...");
    await adicionarLinhaNaPlanilha(descricao, valor, categoria, tipo);
    const gastoFormatado = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    console.log(`A consultar planilha para o total de: ${tipo}`);
    const totalPorTipo = await calcularTotalPorTipoNaPlanilha(tipo);
    const totalFormatado = totalPorTipo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const textoResposta = `✅ Gasto de ${gastoFormatado} registado!\n\nTotal de gastos com ${tipo}: ${totalFormatado}`;

    console.log(`A enviar resposta para ${numeroRemetente}`);
    await enviarMensagemWhatsApp(numeroRemetente, textoResposta);

    res.sendStatus(200);

  } catch (err) {
    console.error("Erro na rota /webhook:", err.message);
    res.sendStatus(500);
  }
});

// --- INICIALIZAÇÃO DO SERVIDOR (NÃO MUDA) ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});

