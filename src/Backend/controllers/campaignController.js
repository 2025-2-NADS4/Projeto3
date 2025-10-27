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

    const { lojaId, mesInicio, mesFim, campanhaId } = req.query
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

    const [lojas] = await db.execute(`SELECT DISTINCT storeId FROM campaign ORDER BY storeId`)

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
        lojas: lojas.map(l => l.storeId),
        campanhas: campanhasFiltro.map(c => c.nomeCampanha),
        mesesDisponiveis: campanhasPorMes.map(m => m.mes)
      }
    })
  } catch (erro) {
    console.error('Erro ao listar campanhas do admin:', erro)
    return res.status(500).json({ erro: 'Erro no servidor ao carregar dashboard (admin).' })
  }
}