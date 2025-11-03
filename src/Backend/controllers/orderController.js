import db from "../config/db.js";

// GET /api/estabelecimento/pedidos
export async function getPedidosEstabelecimento(req, res) {
  try {
    const { establishment_id } = req.user;
    const { mesInicio, mesFim } = req.query;

    const where = ["companyId = ?"];
    const params = [establishment_id];
    if (mesInicio) { where.push("createdAt >= ?"); params.push(`${mesInicio}-01`); }
    if (mesFim) { where.push("createdAt < DATE_ADD(?, INTERVAL 1 MONTH)"); params.push(`${mesFim}-01`); }

    // KPIs
    const [kpiRows] = await db.execute(`
      SELECT
        COUNT(*) AS total_pedidos,
        SUM(totalAmount) AS receita_total,
        AVG(totalAmount) AS ticket_medio_geral,
        SUM(CASE WHEN LOWER(status) LIKE '%cancel%' THEN 1 ELSE 0 END)/COUNT(*)*100 AS taxa_cancelamento
      FROM \`order\`
      WHERE ${where.join(" AND ")}
    `, params);
    const kpis = kpiRows[0];

    // Pedidos por status
    const [statusRows] = await db.execute(`
      SELECT status AS status, COUNT(*) AS qtde
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      GROUP BY status
    `, params);

    // Pedidos por canal (salesChannel)
    const [canalRows] = await db.execute(`
      SELECT salesChannel AS canal, COUNT(*) AS qtde
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      GROUP BY salesChannel
    `, params);

    // Receita por mês
    const [receitaMes] = await db.execute(`
      SELECT DATE_FORMAT(createdAt, '%Y-%m') AS mes, SUM(totalAmount) AS receita
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
      ORDER BY mes
    `, params);

    // Ticket médio por canal
    const [ticketCanal] = await db.execute(`
      SELECT salesChannel AS canal, AVG(totalAmount) AS ticket_medio
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      GROUP BY salesChannel
    `, params);

    // Tempo médio de preparo por tipo
    const [tempoMedio] = await db.execute(`
      SELECT orderType AS tipo, AVG(preparationTime) AS tempo_medio
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      GROUP BY orderType
    `, params);

    // Pedidos por hora do dia
    const [horarios] = await db.execute(`
      SELECT HOUR(createdAt) AS hora, COUNT(*) AS qtde
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      GROUP BY HOUR(createdAt)
      ORDER BY hora
    `, params);

    // Meses disponíveis (para ser utilizado nos filtros do frontend)
    const [meses] = await db.execute(`
      SELECT DATE_FORMAT(createdAt, '%Y-%m') AS ym
      FROM \`order\`
      WHERE companyId = ?
      GROUP BY ym
      ORDER BY ym
    `, [establishment_id]);
    const mesesDisponiveis = meses.map((m) => m.ym);

    // Pega o nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [establishment_id]
    )
    const lojaNome = linhaLoja?.store_name || '(Loja sem nome)'

    res.json({
      kpis,
      graficos: {
        status: statusRows,
        canal: canalRows,
        receitaMes,
        ticketCanal,
        tempoMedio,
        horarios,
      },
      filtros: { mesesDisponiveis },
      meta: { loja: { id: establishment_id, nome: lojaNome } },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao carregar dados de pedidos." });
  }
}

/** Utilitário: transforma 'YYYY-MM' em limites de data [início, fim) */
function intervaloMes(yyyymm) {
  // Exemplo: "2025-07" → início: 2025-07-01 00:00:00, fim: 2025-08-01 00:00:00
  const [ano, mes] = (yyyymm || "").split("-").map(Number);
  if (!ano || !mes) return { inicio: null, fim: null };

  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0));
  const fim = new Date(Date.UTC(mes === 12 ? ano + 1 : ano, mes === 12 ? 0 : mes, 1, 0, 0, 0));
  return { inicio, fim };
}

// Monta o WHERE dinâmico
function montarWhere({ companyId, mesInicio, mesFim }) {
  const condicoes = [];
  const valores = [];

  if (companyId) {
    condicoes.push("companyId = ?");
    valores.push(companyId);
  }

  // Janela de datas baseada em createdAt
  const { inicio: dataInicio } = intervaloMes(mesInicio || "");
  const { fim: dataFim } = intervaloMes(mesFim || "");

  if (dataInicio) {
    condicoes.push("createdAt >= ?");
    valores.push(dataInicio);
  }
  if (dataFim) {
    condicoes.push("createdAt < ?");
    valores.push(dataFim);
  }

  const clausula = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  return { clausula, valores };
}

// GET /api/admin/pedidos
export async function getPedidosAdmin(req, res) {
  try {
    const { mesInicio, mesFim, companyId } = req.query;

    // WHERE dinâmico
    const { clause, vals } = montarWhere({ mesInicio, mesFim, companyId });

    // KPIs
    const [[tot]] = await db.execute(
      `SELECT COUNT(*) AS total_pedidos,
              COALESCE(SUM(totalAmount),0) AS receita_total,
              COALESCE(AVG(totalAmount),0) AS ticket_medio_geral
         FROM \`order\` ${clause}`,
      vals
    );

    const [[canc]] = await db.execute(
      `SELECT COUNT(*) AS cancelados
         FROM \`order\`
        ${clause ? clause + " AND" : "WHERE"} status = 'CANCELED'`,
      vals
    );

    const totalPedidos = Number(tot?.total_pedidos || 0);
    const cancelados = Number(canc?.cancelados || 0);
    const taxa_cancelamento = totalPedidos ? (cancelados / totalPedidos) * 100 : 0;

    // Gráficos
    const [status] = await db.execute(
      `SELECT status, COUNT(*) AS qtde
         FROM \`order\` ${clause}
        GROUP BY status
        ORDER BY qtde DESC`,
      vals
    );

    const [canal] = await db.execute(
      `SELECT salesChannel AS canal, COUNT(*) AS qtde
         FROM \`order\` ${clause}
        GROUP BY salesChannel
        ORDER BY qtde DESC`,
      vals
    );

    const [receitaMes] = await db.execute(
      `SELECT DATE_FORMAT(createdAt,'%Y-%m') AS mes,
              COALESCE(SUM(totalAmount),0) AS receita
         FROM \`order\` ${clause}
        GROUP BY DATE_FORMAT(createdAt,'%Y-%m')
        ORDER BY mes`,
      vals
    );

    const [ticketCanal] = await db.execute(
      `SELECT salesChannel AS canal,
              COALESCE(AVG(totalAmount),0) AS ticket_medio
         FROM \`order\` ${clause}
        GROUP BY salesChannel
        ORDER BY canal`,
      vals
    );

    // Tempo médio por tipo, usado o preparationTime (minutos) agrupado por orderType
    const [tempoMedio] = await db.execute(
      `SELECT orderType AS tipo,
              COALESCE(AVG(preparationTime),0) AS tempo_medio
         FROM \`order\` ${clause}
        GROUP BY orderType
        ORDER BY tipo`,
      vals
    );

    const [horarios] = await db.execute(
      `SELECT HOUR(createdAt) AS hora, COUNT(*) AS qtde
         FROM \`order\` ${clause}
        GROUP BY HOUR(createdAt)
        ORDER BY hora`,
      vals
    );

    // Filtros auxiliares
    // Meses completos
    const [mesesTodos] = await db.execute(
      `SELECT DISTINCT DATE_FORMAT(createdAt,'%Y-%m') AS mes
         FROM \`order\`
        ORDER BY mes`
    );
    const mesesDisponiveis = mesesTodos.map((r) => r.mes);

    // Lista de lojas (companyId)
    const [lojasRows] = await db.execute(
      `SELECT DISTINCT companyId
         FROM \`order\`
        ORDER BY companyId`
    );
    const lojas = lojasRows.map((r) => ({ id: r.companyId, nome: r.companyId }));

    // Resposta em Json
    res.json({
      kpis: {
        total_pedidos: totalPedidos,
        receita_total: Number(tot?.receita_total || 0),
        ticket_medio_geral: Number(tot?.ticket_medio_geral || 0),
        taxa_cancelamento,
      },
      graficos: {
        status: status.map((s) => ({ status: s.status, qtde: Number(s.qtde || 0) })),
        canal: canal.map((c) => ({ canal: c.canal, qtde: Number(c.qtde || 0) })),
        receitaMes: receitaMes.map((r) => ({ mes: r.mes, receita: Number(r.receita || 0) })),
        ticketCanal: ticketCanal.map((t) => ({ canal: t.canal, ticket_medio: Number(t.ticket_medio || 0) })),
        tempoMedio: tempoMedio.map((t) => ({ tipo: t.tipo, tempo_medio: Number(t.tempo_medio || 0) })),
        horarios: horarios.map((h) => ({ hora: Number(h.hora || 0), qtde: Number(h.qtde || 0) })),
      },
      filtros: {
        mesesDisponiveis,
      },
      lojas, 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao carregar dados de pedidos (admin)." });
  }
}