// Importa as bibliotecas necessárias.
// O 'express' é usado para criar o servidor web e as rotas da API.
// O 'node-fetch' é usado para fazer requisições para a API do Notion.
import express from "express";
import fetch from "node-fetch";

// Inicializa a aplicação Express.
const app = express();

// Middleware para o Express entender JSON.
// Isso permite que a gente acesse os dados enviados no corpo (body) da requisição, como req.body.
app.use(express.json());

// Carrega as chaves secretas a partir das Variáveis de Ambiente.
// Esta é a forma segura de gerenciar segredos em produção.
// O Render injeta os valores que você configurou no painel.
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID;

// --- FUNÇÃO PRINCIPAL: CRIAR ENTRADA NO NOTION ---
// Esta função é o coração da lógica. Ela recebe os dados e os envia para o Notion.
async function criarEntrada(descricao, valor, categoria) {
  // Monta o objeto (payload) no formato que a API do Notion espera.
  const payload = {
    parent: { database_id: DATABASE_ID },
    properties: {
      // O nome da propriedade ("Descrição") deve ser EXATAMENTE igual ao nome da coluna na sua base do Notion.
      "Descrição": {
        title: [
          {
            text: {
              content: descricao,
            },
          },
        ],
      },
      "Valor": {
        number: valor,
      },
      "Categoria": {
        select: {
          name: categoria,
        },
      },
    },
  };

  // Faz a requisição para a API do Notion usando 'fetch'.
  const resposta = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      // O token de autorização é enviado no cabeçalho.
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28", // Versão da API do Notion.
    },
    // O corpo da requisição contém os dados da nova linha a ser criada, convertidos para texto JSON.
    body: JSON.stringify(payload),
  });

  // Retorna a resposta do Notion (seja de sucesso ou de erro).
  return await resposta.json();
}

// --- ROTA DA API ---
// Define o endpoint que ficará "escutando" por novas requisições.
// A URL final será: https://bot-notion-whatsapp.onrender.com/notion
app.post("/notion", async (req, res) => {
  try {
    // Extrai os dados do corpo da requisição.
    // Futuramente, esta parte será adaptada para ler os dados que o WhatsApp envia.
    const { descricao, valor, categoria } = req.body;

    // Chama a função para criar a entrada no Notion com os dados recebidos.
    const respostaNotion = await criarEntrada(descricao, valor, categoria);

    // Envia a resposta do Notion de volta para quem chamou a API.
    res.json(respostaNotion);
  } catch (err) {
    // Em caso de erro, envia uma mensagem de erro com status 500 (Erro Interno do Servidor).
    console.error("Erro na rota /notion:", err); // Loga o erro no console do Render para depuração.
    res.status(500).json({ erro: err.message });
  }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
// Define a porta em que o servidor vai rodar. O Render gerencia isso automaticamente,
// mas é uma boa prática definir um valor padrão (como 8080 ou 3000).
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
