import db from '../config/db.js'

// Essa função monta a parte do WHERE do SQL de forma dinâmica, filtrando os dados conforme o estabelecimento, período (mês inicial e final) e a campanha selecionada.
function montarWhere({ lojaId, mesInicio, mesFim, campanhaId }) {
  const condicoes = []
  const parametros = []

  condicoes.push('storeId = ?')
  parametros.push(lojaId)

  if (campanhaId) {
    const ehNumero = /^\d+$/.test(String(campanhaId))
    if (ehNumero) {
      condicoes.push('id = ?')
      parametros.push(Number(campanhaId))
    } else {
      condicoes.push('name = ?')
      parametros.push(campanhaId)
    }
  }

  if (mesInicio) {
    condicoes.push('_mes >= ?')
    parametros.push(mesInicio)
  }
  if (mesFim) {
    condicoes.push('_mes <= ?')
    parametros.push(mesFim)
  }

  const clausula = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
  return { clausula, parametros }
}


// GET /api/estabelecimento/campanhas
export const getCampanhasEstabelecimento = async (req, res) => {
  try {
    const usuario = req.user
    if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado!' })

    const perfil = String(usuario.perfil || '').toLowerCase()
    if (perfil !== 'estabelecimento') {
      return res.status(403).json({ erro: 'Acesso negado! Apenas estabelecimentos podem ver essas campanhas.' })
    }

    const lojaId = usuario.establishment_id
    const { mesInicio, mesFim, campanhaId } = req.query

    // Pega o nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [lojaId]
    )
    const lojaNome = linhaLoja?.store_name || '(Loja sem nome)'

    const { clausula, parametros } = montarWhere({ lojaId, mesInicio, mesFim, campanhaId })

    // KPIs
    const [[kpiTotal]] = await db.execute(`SELECT COUNT(*) AS total FROM campaign ${clausula}`, parametros)
    const [[kpiAtivas]] = await db.execute(
      `SELECT COUNT(*) AS total FROM campaign
       ${clausula ? clausula + ' AND ' : 'WHERE '} (LOWER(status_desc) LIKE '%ativ%')`,
      parametros
    )
    const [[kpiConcluidas]] = await db.execute(
      `SELECT COUNT(*) AS total FROM campaign
       ${clausula ? clausula + ' AND ' : 'WHERE '} (LOWER(status_desc) LIKE '%conclu%')`,
      parametros
    )

    // Novas no período
    let novasPeriodo = 0
    if (mesInicio || mesFim) {
      const [[novas]] = await db.execute(`SELECT COUNT(*) AS total FROM campaign ${clausula}`, parametros)
      novasPeriodo = Number(novas.total || 0)
    }

    // Gráficos
    const [statusCampanhas] = await db.execute(
      `SELECT COALESCE(NULLIF(TRIM(status_desc),''),'(sem status)') AS status_desc, COUNT(*) AS qtd
         FROM campaign
        ${clausula}
        GROUP BY status_desc
        ORDER BY qtd DESC`,
      parametros
    )

    const [badgesCampanhas] = await db.execute(
      `SELECT COALESCE(NULLIF(TRIM(badge),''),'(sem badge)') AS badge, COUNT(*) AS qtd
         FROM campaign
        ${clausula}
        GROUP BY badge
        ORDER BY qtd DESC`,
      parametros
    )

    const [campanhasPorMes] = await db.execute(
      `SELECT _mes AS mes, COUNT(*) AS qtd
         FROM campaign
        ${clausula}
        GROUP BY mes
        ORDER BY mes ASC`,
      parametros
    )

    // Filtros
    const [campanhasFiltro] = await db.execute(
      `SELECT DISTINCT name AS nomeCampanha
         FROM campaign
        WHERE storeId = ?
        ORDER BY name`,
      [lojaId]
    )

    const total = Number(kpiTotal.total || 0)
    const ativas = Number(kpiAtivas.total || 0)
    const concluidas = Number(kpiConcluidas.total || 0)

    return res.json({
      meta: {
        loja: { id: lojaId, nome: lojaNome }, 
        periodo: { mesInicio: mesInicio || null, mesFim: mesFim || null },
        campanhaId: campanhaId || null
      },
      kpis: {
        total,
        ativas,
        concluidas,
        ativasPct: total ? Math.round((ativas / total) * 100) : 0,
        concluidasPct: total ? Math.round((concluidas / total) * 100) : 0,
        novasPeriodo
      },
      graficos: {
        status: statusCampanhas,
        badges: badgesCampanhas,
        meses: campanhasPorMes
      },
      filtros: {
        campanhas: campanhasFiltro.map(c => c.nomeCampanha),
        mesesDisponiveis: campanhasPorMes.map(m => m.mes)
      }
    })
  } catch (erro) {
    console.error('Erro ao listar campanhas do estabelecimento:', erro)
    return res.status(500).json({ erro: 'Erro no servidor ao carregar o dashboard.' })
  }
}

// Função para o painel do ADMIN, podendo ver todas as lojas e aplicar filtros adicionais.
function montarWhereAdmin({ lojaId, mesInicio, mesFim, campanhaId }) {
  const condicoes = []
  const parametros = []

  if (lojaId) {
    condicoes.push('storeId = ?')
    parametros.push(lojaId)
  }

  if (campanhaId) {
    const ehNumero = /^\d+$/.test(String(campanhaId))
    if (ehNumero) {
      condicoes.push('id = ?')
      parametros.push(Number(campanhaId))
    } else {
      condicoes.push('name = ?')
      parametros.push(campanhaId)
    }
  }

  if (mesInicio) {
    condicoes.push('_mes >= ?')
    parametros.push(mesInicio)
  }
  if (mesFim) {
    condicoes.push('_mes <= ?')
    parametros.push(mesFim)
  }

  const clausula = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
  return { clausula, parametros }
}

// GET /api/admin/campanhas
// Query: lojaId?, mesInicio?, mesFim?, campanhaId?
export const getCampanhasAdmin = async (req, res) => {
  try {
    const usuario = req.user
    if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado!' })

    const perfil = String(usuario.perfil || '').toLowerCase()
    if (perfil !== 'admin') {
      return res.status(403).json({ erro: 'Acesso negado! Apenas administradores podem acessar.' })
    }

    const { lojaId: lojaIdQuery, mesInicio, mesFim, campanhaId, storeName } = req.query
    let lojaId = lojaIdQuery

    if (!lojaId && storeName) {
      const [[loja]] = await db.execute(
        `SELECT establishment_id
           FROM estabelecimentos
          WHERE store_name = ?
          LIMIT 1`,
        [storeName]
      )
      if (loja) {
        lojaId = loja.establishment_id
      }
    }

    const { clausula, parametros } = montarWhereAdmin({ lojaId, mesInicio, mesFim, campanhaId })

    const [[kpiTotal]] = await db.execute(`SELECT COUNT(*) AS total FROM campaign ${clausula}`, parametros)
    const [[kpiAtivas]] = await db.execute(
      `SELECT COUNT(*) AS total FROM campaign
       ${clausula ? clausula + ' AND ' : 'WHERE '}
       (LOWER(status_desc) LIKE '%ativ%')`,
      parametros
    )
    const [[kpiConcluidas]] = await db.execute(
      `SELECT COUNT(*) AS total FROM campaign
       ${clausula ? clausula + ' AND ' : 'WHERE '}
       (LOWER(status_desc) LIKE '%conclu%')`,
      parametros
    )

    let novasPeriodo = 0
    if (mesInicio || mesFim) {
      const [[novas]] = await db.execute(`SELECT COUNT(*) AS total FROM campaign ${clausula}`, parametros)
      novasPeriodo = Number(novas.total || 0)
    }

    const [statusCampanhas] = await db.execute(
      `SELECT COALESCE(NULLIF(TRIM(status_desc),''),'(sem status)') AS status_desc, COUNT(*) AS qtd
       FROM campaign ${clausula}
       GROUP BY status_desc ORDER BY qtd DESC`,
      parametros
    )

    const [badgesCampanhas] = await db.execute(
      `SELECT COALESCE(NULLIF(TRIM(badge),''),'(sem badge)') AS badge, COUNT(*) AS qtd
       FROM campaign ${clausula}
       GROUP BY badge ORDER BY qtd DESC`,
      parametros
    )

    const [campanhasPorMes] = await db.execute(
      `SELECT _mes AS mes, COUNT(*) AS qtd
       FROM campaign ${clausula}
       GROUP BY mes ORDER BY mes ASC`,
      parametros
    )

    // Meses disponíveis sempre da base toda
    const [mesesTodos] = await db.execute(
      `SELECT DISTINCT _mes AS mes
         FROM campaign
        ORDER BY mes ASC`
    )

    // lista de lojas usando NOME em vez de storeId
    const [lojas] = await db.execute(
      `SELECT DISTINCT e.store_name
         FROM campaign c
         JOIN estabelecimentos e ON e.establishment_id = c.storeId
        ORDER BY e.store_name`
    )

    const [campanhasFiltro] = lojaId
      ? await db.execute(
          `SELECT DISTINCT name AS nomeCampanha FROM campaign WHERE storeId = ? ORDER BY name`,
          [lojaId]
        )
      : await db.execute(`SELECT DISTINCT name AS nomeCampanha FROM campaign ORDER BY name`)

    const total = Number(kpiTotal.total || 0)
    const ativas = Number(kpiAtivas.total || 0)
    const concluidas = Number(kpiConcluidas.total || 0)

    return res.json({
      meta: {
        lojaId: lojaId || null,
        storeName: storeName || null,
        periodo: { mesInicio: mesInicio || null, mesFim: mesFim || null },
        campanhaId: campanhaId || null
      },
      kpis: {
        total,
        ativas,
        concluidas,
        ativasPct: total ? Math.round((ativas / total) * 100) : 0,
        concluidasPct: total ? Math.round((concluidas / total) * 100) : 0,
        novasPeriodo
      },
      graficos: {
        status: statusCampanhas,
        badges: badgesCampanhas,
        meses: campanhasPorMes
      },
      filtros: {
        lojas: lojas.map(l => l.store_name),
        campanhas: campanhasFiltro.map(c => c.nomeCampanha),
        mesesDisponiveis: mesesTodos.map(m => m.mes)
      }
    })
  } catch (erro) {
    console.error('Erro ao listar campanhas do admin:', erro)
    return res.status(500).json({ erro: 'Erro no servidor ao carregar dashboard (admin).' })
  }
}

// GET /api/estabelecimento/campanhas/sugestoes
export async function getCampanhasSugestoesEstabelecimento(req, res) {
  try {
    const { establishment_id } = req.user;
    if (!establishment_id) {
      return res.status(401).json({ erro: "Usuário não autenticado!" });
    }

    const [rows] = await db.execute(
      `SELECT 
         s.campaignId,
         c.name       AS campanha_nome,
         s.status_previsto,
         s.confianca,
         s.grupo,
         s.gerado_em
       FROM campaign_ai_sugestoes s
       JOIN campaign c ON c.id = s.campaignId
       WHERE s.storeId = ?
       ORDER BY 
         CASE 
           WHEN s.grupo = 'priorizar' THEN 1
           WHEN s.grupo = 'ajustar_ou_pausar' THEN 2
           ELSE 3
         END,
         s.confianca DESC`,
      [establishment_id]
    );

    const priorizar = [];
    const ajustarOuPausar = [];
    const outros = [];

    for (const r of rows) {
      const item = {
        campaignId: r.campaignId,
        nome: r.campanha_nome,
        status_previsto: r.status_previsto,
        confianca: Number(r.confianca),
        gerado_em: r.gerado_em,
      };

      if (r.grupo === "priorizar") priorizar.push(item);
      else if (r.grupo === "ajustar_ou_pausar") ajustarOuPausar.push(item);
      else outros.push(item);
    }

    return res.json({
      priorizar,
      ajustar_ou_pausar: ajustarOuPausar,
      outros,
    });
  } catch (err) {
    console.error("Erro em getCampanhasSugestoesEstabelecimento:", err);
    return res.status(500).json({ erro: "Erro ao carregar sugestões de campanhas (estab)." });
  }
}

// GET /api/admin/campanhas/sugestoes
export async function getCampanhasSugestoesAdmin(req, res) {
  try {
    const usuario = req.user;
    if (!usuario) {
      return res.status(401).json({ erro: "Usuário não autenticado!" });
    }

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "admin") {
      return res
        .status(403)
        .json({ erro: "Acesso negado! Apenas administradores podem acessar." });
    }

    let { storeName } = req.query;
    let storeId = null;

    // Se vier storeName, converte para establishment_id (storeId)
    if (storeName) {
      const [[loja]] = await db.execute(
        `SELECT establishment_id
           FROM estabelecimentos
          WHERE store_name = ?
          LIMIT 1`,
        [storeName]
      );
      if (loja) {
        storeId = loja.establishment_id;
      }
    }

    const condicoes = [];
    const params = [];

    if (storeId) {
      condicoes.push("s.storeId = ?");
      params.push(storeId);
    }

    const clausula = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `SELECT 
         s.storeId,
         e.store_name,
         s.campaignId,
         c.name AS campanha_nome,
         s.status_previsto,
         s.confianca,
         s.grupo,
         s.gerado_em
       FROM campaign_ai_sugestoes s
       JOIN campaign c ON c.id = s.campaignId
  LEFT JOIN estabelecimentos e
         ON e.establishment_id = s.storeId
       ${clausula}
       ORDER BY 
         e.store_name,
         CASE 
           WHEN s.grupo = 'priorizar' THEN 1
           WHEN s.grupo = 'ajustar_ou_pausar' THEN 2
           ELSE 3
         END,
         s.confianca DESC`,
      params
    );

    // Devolve a lista de lojas disponíveis para o filtro
    const [lojasRows] = await db.execute(
      `SELECT DISTINCT e.store_name
         FROM campaign_ai_sugestoes s
         JOIN estabelecimentos e ON e.establishment_id = s.storeId
        ORDER BY e.store_name`
    );
    const lojas = lojasRows.map((l) => l.store_name);

    return res.json({
      meta: {
        storeName: storeName || null,
      },
      filtros: {
        lojas,
      },
      sugestoes: rows.map((r) => ({
        storeId: r.storeId,
        storeName: r.store_name,
        campaignId: r.campaignId,
        nome: r.campanha_nome,
        status_previsto: r.status_previsto,
        confianca: Number(r.confianca),
        grupo: r.grupo,
        gerado_em: r.gerado_em,
      })),
    });
  } catch (erro) {
    console.error("Erro em getCampanhasSugestoesAdmin:", erro);
    return res
      .status(500)
      .json({ erro: "Erro ao carregar sugestões de campanhas (admin)." });
  }
}