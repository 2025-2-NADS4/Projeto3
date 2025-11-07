import db from "../config/db.js";

function montarWhere({ lojaId, mesInicio, mesFim }) {
  const condicoes = [];
  const parametros = [];

  // Estabelecimento sempre obrigatório
  if (lojaId) {
    condicoes.push("storeId = ?");
    parametros.push(lojaId);
  }

  if (mesInicio) {
    condicoes.push("_mes >= ?");
    parametros.push(mesInicio);
  }
  if (mesFim) {
    condicoes.push("_mes <= ?");
    parametros.push(mesFim);
  }

  const clausula = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  return { clausula, parametros };
}

// GET /api/estabelecimento/campaignqueue
export const getCampaignQueueEstabelecimento = async (req, res) => {
  try {
    const usuario = req.user;
    if (!usuario) return res.status(401).json({ erro: "Usuário não autenticado!" });

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "estabelecimento") {
      return res
        .status(403)
        .json({ erro: "Acesso negado! Apenas estabelecimentos podem acessar." });
    }

    const lojaId = usuario.establishment_id;
    const { mesInicio, mesFim } = req.query;

    const { clausula, parametros } = montarWhere({ lojaId, mesInicio, mesFim });

    // Mensagens totais
    const [[kpiTotal]] = await db.execute(
      `SELECT COUNT(*) AS total FROM campaign_queue ${clausula}`,
      parametros
    );

    // Contagem por status (Enviada, Lida, Pendente)
    const [rowsStatus] = await db.execute(
      `SELECT 
          COALESCE(NULLIF(TRIM(status_desc),''),'(sem status)') AS status_desc,
          COUNT(*) AS qtd
       FROM campaign_queue
       ${clausula}
       GROUP BY status_desc
       ORDER BY qtd DESC`,
      parametros
    );

    // Agrupamento por bucket lógico (Lida, Enviada, Pendente, Outros)
    const bucket = { lida: 0, enviada: 0, pendente: 0, outros: 0 };
    rowsStatus.forEach((r) => {
      const s = (r.status_desc || "").toLowerCase();
      if (s.includes("lida") || s.includes("read") || s.includes("visualizad"))
        bucket.lida += r.qtd;
      else if (s.includes("pend") || s.includes("queue") || s.includes("aguard"))
        bucket.pendente += r.qtd;
      else if (s.includes("env") || s.includes("sent") || s.includes("dispar"))
        bucket.enviada += r.qtd;
      else bucket.outros += r.qtd;
    });

    const baseLeitura = bucket.lida + bucket.enviada + bucket.pendente;
    const taxaLeitura = baseLeitura
      ? Math.round((bucket.lida / baseLeitura) * 100)
      : 0;

    // Gráfico por mês
    const [rowsMes] = await db.execute(
      `SELECT _mes AS mes, COUNT(*) AS qtd
       FROM campaign_queue
       ${clausula}
       GROUP BY mes
       ORDER BY mes ASC`,
      parametros
    );

    // KPI de leitura por estabelecimento (Top 10)
    const [rowsStores] = await db.execute(
      `SELECT storeId,
              SUM(CASE WHEN LOWER(status_desc) LIKE '%lida%' OR LOWER(status_desc) LIKE '%read%' THEN 1 ELSE 0 END) AS lidas,
              SUM(CASE WHEN LOWER(status_desc) LIKE '%lida%' 
                        OR LOWER(status_desc) LIKE '%pend%' 
                        OR LOWER(status_desc) LIKE '%env%' THEN 1 ELSE 0 END) AS base
       FROM campaign_queue
       ${clausula}
       GROUP BY storeId
       HAVING base > 0
       ORDER BY (lidas/base) DESC
       LIMIT 10`,
      parametros
    );

    // Nome do estabelecimento
    const [[lojaNome]] = await db.execute(
      `SELECT store_name FROM estabelecimentos WHERE establishment_id = ? LIMIT 1`,
      [lojaId]
    );

    return res.json({
      meta: { lojaId, lojaNome: lojaNome?.store_name || "Estabelecimento" },
      kpis: {
        total: Number(kpiTotal.total || 0),
        taxaLeitura,
        lidas: bucket.lida,
        pendentes: bucket.pendente,
        enviadas: bucket.enviada,
        baseLeitura,
      },
      graficos: {
        status: rowsStatus,
        meses: rowsMes,
        topStores: rowsStores.map((s) => ({
          storeId: s.storeId,
          taxa: s.base ? Math.round((s.lidas / s.base) * 100) : 0,
          base: s.base,
        })),
      },
      filtros: {
        mesesDisponiveis: rowsMes.map((r) => r.mes),
      },
    });
  } catch (erro) {
    console.error("Erro em getCampaignQueueEstabelecimento:", erro);
    return res.status(500).json({ erro: "Erro interno ao carregar CampaignQueue." });
  }
};

// GET /api/admin/campaignqueue
export const getCampaignQueueAdmin = async (req, res) => {
  try {
    const usuario = req.user;
    if (!usuario) return res.status(401).json({ erro: "Usuário não autenticado!" });

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "admin") {
      return res
        .status(403)
        .json({ erro: "Acesso negado! Apenas administradores podem acessar." });
    }

    const { lojaId: lojaIdQuery, mesInicio, mesFim, storeName } = req.query;
    let lojaId = lojaIdQuery;

    if (!lojaId && storeName) {
      const [[loja]] = await db.execute(
        `SELECT establishment_id
           FROM estabelecimentos
          WHERE store_name = ?
          LIMIT 1`,
        [storeName]
      );
      if (loja) {
        lojaId = loja.establishment_id;
      }
    }

    const { clausula, parametros } = montarWhere({ lojaId, mesInicio, mesFim });

    const [[kpiTotal]] = await db.execute(
      `SELECT COUNT(*) AS total FROM campaign_queue ${clausula}`,
      parametros
    );

    const [rowsStatus] = await db.execute(
      `SELECT 
          COALESCE(NULLIF(TRIM(status_desc),''),'(sem status)') AS status_desc,
          COUNT(*) AS qtd
       FROM campaign_queue
       ${clausula}
       GROUP BY status_desc
       ORDER BY qtd DESC`,
      parametros
    );

    // Buckets
    const bucket = { lida: 0, enviada: 0, pendente: 0, outros: 0 };
    rowsStatus.forEach((r) => {
      const s = (r.status_desc || "").toLowerCase();
      if (s.includes("lida") || s.includes("read")) bucket.lida += r.qtd;
      else if (s.includes("pend") || s.includes("queue")) bucket.pendente += r.qtd;
      else if (s.includes("env") || s.includes("sent")) bucket.enviada += r.qtd;
      else bucket.outros += r.qtd;
    });

    const baseLeitura = bucket.lida + bucket.enviada + bucket.pendente;
    const taxaLeitura = baseLeitura
      ? Math.round((bucket.lida / baseLeitura) * 100)
      : 0;

    const [rowsMes] = await db.execute(
      `SELECT _mes AS mes, COUNT(*) AS qtd
       FROM campaign_queue
       ${clausula}
       GROUP BY mes
       ORDER BY mes ASC`,
      parametros
    );

    // Meses disponíveis completos
    const [mesesTodos] = await db.execute(
      `SELECT DISTINCT _mes AS mes
         FROM campaign_queue
        ORDER BY mes ASC`
    );

    const [rowsStores] = await db.execute(
      `SELECT storeId,
              SUM(CASE WHEN LOWER(status_desc) LIKE '%lida%' THEN 1 ELSE 0 END) AS lidas,
              SUM(CASE WHEN LOWER(status_desc) LIKE '%lida%' 
                        OR LOWER(status_desc) LIKE '%pend%' 
                        OR LOWER(status_desc) LIKE '%env%' THEN 1 ELSE 0 END) AS base
       FROM campaign_queue
       ${clausula}
       GROUP BY storeId
       HAVING base > 0
       ORDER BY (lidas/base) DESC
       LIMIT 10`,
      parametros
    );

    // É feito a busca da lista de lojas pelo nome
    const [lojas] = await db.execute(
      `SELECT DISTINCT e.store_name
         FROM campaign_queue c
         JOIN estabelecimentos e ON e.establishment_id = c.storeId
        ORDER BY e.store_name`
    );

    // Resposta em JSON
    return res.json({
      meta: { lojaId: lojaId || null, storeName: storeName || null },
      kpis: {
        total: Number(kpiTotal.total || 0),
        taxaLeitura,
        lidas: bucket.lida,
        pendentes: bucket.pendente,
        enviadas: bucket.enviada,
        baseLeitura,
      },
      graficos: {
        status: rowsStatus,
        meses: rowsMes,
        topStores: rowsStores.map((s) => ({
          storeId: s.storeId,
          taxa: s.base ? Math.round((s.lidas / s.base) * 100) : 0,
          base: s.base,
        })),
      },
      filtros: {
        lojas: lojas.map((r) => r.store_name),
        mesesDisponiveis: mesesTodos.map((r) => r.mes),
      },
    });
  } catch (erro) {
    console.error("Erro em getCampaignQueueAdmin:", erro);
    return res.status(500).json({ erro: "Erro interno ao carregar CampaignQueue (admin)." });
  }
};