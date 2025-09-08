/**
 * Envia uma mensagem de resposta para o usuário via API do WhatsApp.
 * AJUSTADO COM DEBUG AVANÇADO
 */
async function enviarMensagemWhatsApp(para, texto) {
  const payload = {
    messaging_product: "whatsapp",
    to: para,
    text: { body: texto },
  };

  console.log("-> Preparando para enviar para a API do WhatsApp. Payload:", JSON.stringify(payload, null, 2));

  try {
    const respostaAPI = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ),
      }
    );

    const dadosRespostaAPI = await respostaAPI.json();

    if (!respostaAPI.ok) {
      // Se a API retornar um erro (status não for 2xx), vamos logar em detalhes.
      console.error("<- ERRO da API do WhatsApp:", JSON.stringify(dadosRespostaAPI, null, 2));
    } else {
      // Se a API aceitar a solicitação, vamos logar a resposta de sucesso.
      console.log("<- SUCESSO da API do WhatsApp. Resposta:", JSON.stringify(dadosRespostaAPI, null, 2));
    }

  } catch (error) {
    console.error("<- FALHA CRÍTICA ao tentar contatar a API do WhatsApp:", error.message);
  }
}
