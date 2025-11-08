function normalize(str = "") {
  return String(str).toLowerCase();
}

// Estabelecimento
// grupo: 'priorizar' | 'ajustar_ou_pausar' | 'outros' (ou 'monitorar')
export function buildMensagemEstab(sug, grupo) {
  const status = normalize(sug.status_previsto);
  const conf = Math.round((sug.confianca || 0) * 100);
  const nome = sug.nome || "esta campanha";

  if (grupo === "priorizar") {
    if (status.includes("conclu")) {
      return (
        `A IA indica ~${conf}% de chance de que "${nome}" ` +
        `tenha um comportamento parecido com campanhas bem-sucedidas. ` +
        `Vale reaproveitar essa campanha em novos períodos, mantendo o que funcionou ` +
        `e testando pequenos ajustes de horário, público ou mensagem.`
      );
    }

    return (
      `A campanha "${nome}" aparece como promissora (${conf}% de confiança na classificação). ` +
      `Considere mantê-la ativa e testar incrementos graduais (como orçamento, canais ou criativos) ` +
      `para potencializar os resultados sem assumir um risco muito alto.`
    );
  }

  if (grupo === "ajustar_ou_pausar") {
    if (status.includes("rascunho")) {
      return (
        `A campanha "${nome}" parece estar em um estágio pouco aproveitado ` +
        `(${conf}% de confiança de estar como rascunho ou pouco otimizada). ` +
        `Revise segmentação, oferta e objetivo antes de disparar para evitar baixo desempenho.`
      );
    }

    if (status.includes("agend")) {
      return (
        `A campanha "${nome}" está agendada, mas a IA não identifica um padrão forte de sucesso ` +
        `em campanhas semelhantes (${conf}% de confiança). ` +
        `Vale revisar público, período e mensagem antes da data de início.`
      );
    }

    return (
      `A IA aponta que "${nome}" pode estar abaixo do potencial em relação a outras campanhas. ` +
      `Analise métricas de resultado (ex.: conversões, retorno) e considere testar variações ` +
      `ou pausar se o retorno estiver muito abaixo do esperado.`
    );
  }

  return (
    `A campanha "${nome}" está em zona intermediária (${conf}% de confiança): ` +
    `não há sinal forte de desempenho nem muito positivo nem muito negativo. ` +
    `Acompanhe os resultados por mais alguns dias antes de decidir escalar ou pausar.`
  );
}

// Admin
// grupo: 'priorizar' | 'ajustar_ou_pausar' | 'outros' (ou 'monitorar')
export function buildMensagemAdmin(sug, grupo) {
  const conf = Math.round((sug.confianca || 0) * 100);
  const nome = sug.nome || "campanha";
  const loja = sug.storeName || sug.storeId || "Loja";

  if (grupo === "priorizar") {
    return (
      `Campanha "${nome}" da ${loja} aparece com bom potencial ` +
      `(${conf}% de confiança na classificação). ` +
      `Vale sinalizar ao estabelecimento para manter ou ampliar essa campanha, ` +
      `avaliando espaço para aumento de investimento.`
    );
  }

  if (grupo === "ajustar_ou_pausar") {
    return (
      `Campanha "${nome}" da ${loja} indica possível baixa eficiência ` +
      `(${conf}% de confiança). ` +
      `Sugira ao estabelecimento revisar público, oferta e período; ` +
      `se o desempenho seguir abaixo do esperado, pausar ou substituir a campanha pode ser uma boa opção.`
    );
  }

  return (
    `Campanha "${nome}" da ${loja} está em zona neutra (${conf}% de confiança). ` +
    `Recomenda-se acompanhar de perto antes de sugerir mudanças mais agressivas.`
  );
}
