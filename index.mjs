// Importa as bibliotecas necessárias.
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
// CORREÇÃO CRÍTICA: A chave privada precisa ser formatada corretamente.
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

// --- FUNÇÕES DE LÓGICA DE NEGÓCIO (VERSÃO GOOGLE SHEETS) ---

/**
 * Adiciona uma nova linha de dados na planilha do Google Sheets.
 */
async function adicionarLinhaNaPlanilha(descricao, valor, categoria, tipo) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  } );

  const sheets = google.sheets({ version: "v4", auth });

  const novaLinha = [
    new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), // Coluna A: Data e Hora (fuso horário do Brasil)
    descricao,               // Coluna B: Descrição
    valor,                   // Coluna C: Valor
    categoria,               // Coluna D: Categoria
    tipo,                    // Coluna E: Tipo
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Página1!A:E", // Verifique se o nome da sua aba é "Página1"
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
  } );

  const sheets = google.sheets({ version: "v4", auth });

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Página1!C:E", // Obtém as colunas Valor (C) e Tipo (E)
  });

  const linhas = resposta.data.values;

  if (!linhas || linhas.length === 0) {
    return 0;
  }

  const total = linhas.reduce((soma, linha) => {
    if (linha && linha.length >= 3) { // Garante que a linha tem pelo menos 3 colunas (C, D, E)
      const valorDaLinhaStr = String(linha[0]).replace("R$", "").replace(".", "").replace(",", ".").trim();
      const valorDaLinha = parseFloat(valorDaLinhaStr);
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
 */
async function enviarMensagemWhatsApp(para, texto) {
  const payload = {
    messaging_product: "whatsapp",
    to: para,
    text: { body: texto },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, // Usando a v20.0, a mais recente
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ),
      }
    );
    const data = await response.json();
    if (data.error) {
        console.error("<- ERRO da API do WhatsApp:", JSON.stringify(data, null, 2));
    } else {
        console.log("<- SUCESSO da API do WhatsApp:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
      console.error("<- FALHA CRÍTICA ao contatar a API do WhatsApp:", error.message);
  }
}

// --- ROTAS DA API ---

// Rota para a verificação do Webhook
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
    console.error("Erro na rota /webhook:", err.message, err.stack);
    res.sendStatus(500);
  }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});
