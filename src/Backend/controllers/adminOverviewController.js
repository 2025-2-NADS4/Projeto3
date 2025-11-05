import db from "../config/db.js";

// Função para converter 'YYYY-MM' em limites de data
function intervaloMes(anoMes) {
  const [ano, mes] = anoMes.split("-").map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0)); 
  const fim = new Date(Date.UTC(ano, mes, 1, 0, 0, 0));       
  return { inicio, fim };
}

// Função para converter um objeto Date em 'YYYY-MM-DD' para uso em SQL
function dataSQL(data) {
  return data.toISOString().slice(0, 10);
}

// Função para montar o WHERE dinâmico com base no período e no estabelecimento 
function montarWherePedidos({ mesInicio, mesFim, companyId }) {
  const condicoes = ["o.isTest = 0"];
  const parametros = [];

  if (mesInicio) {
    const { inicio } = intervaloMes(mesInicio);
    condicoes.push("o.createdAt >= ?");
    parametros.push(dataSQL(inicio));
  }

  if (mesFim) {
    const { fim } = intervaloMes(mesFim);
    condicoes.push("o.createdAt < ?");
    parametros.push(dataSQL(fim));
  }

  if (companyId) {
    condicoes.push("o.companyId = ?");
    parametros.push(companyId);
  }

  return {
    sql: condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "",
    params: parametros,
  };
}

// GET /api/admin/estabelecimentos/dashboard
export async function getAdminOverview(req, res) {
  try {
    const { mesInicio, mesFim, companyId } = req.query || {};
    const where = montarWherePedidos({ mesInicio, mesFim, companyId });

    // KPIs
    // Faturamento total (CONCLUDED)
    const [fatTotal] = await db.execute(
      `
      SELECT COALESCE(SUM(o.totalAmount),0) AS v
      FROM \`order\` o
      ${where.sql}
        AND o.status = 'CONCLUDED'
      `,
      where.params
    );
    const faturamento_total = Number(fatTotal[0]?.v || 0);

    // Total pedidos
    const [totPed] = await db.execute(
      `SELECT COUNT(*) AS n FROM \`order\` o ${where.sql}`,
      where.params
    );
    const total_pedidos = Number(totPed[0]?.n || 0);

    // Pedidos Cancelados
    const [totCanc] = await db.execute(
      `SELECT COUNT(*) AS n FROM \`order\` o ${where.sql} AND o.status = 'CANCELED'`,
      where.params
    );
    const cancelados = Number(totCanc[0]?.n || 0);

    // Ticket médio geral (concluídos)
    const [tick] = await db.execute(
      `
      SELECT CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(o.totalAmount)/COUNT(*) END AS tm
      FROM \`order\` o
      ${where.sql}
        AND o.status = 'CONCLUDED'
      `,
      where.params
    );
    const ticket_medio_geral = Number(tick[0]?.tm || 0);

    // Lojas ativas
    const [lojAt] = await db.execute(
      `SELECT COUNT(DISTINCT o.companyId) AS n FROM \`order\` o ${where.sql}`,
      where.params
    );
    const lojas_ativas = Number(lojAt[0]?.n || 0);

    // Tempo médio de preparo (min)
    const [prep] = await db.execute(
      `
      SELECT AVG(COALESCE(o.takeOutTimeInSeconds/60.0, o.preparationTime)) AS tmin
      FROM \`order\` o
      ${where.sql}
        AND o.status IN ('CONCLUDED','DISPATCHED','CONFIRMED','PLACED','PENDING')
      `,
      where.params
    );
    const tempo_preparo_medio_min = Number(prep[0]?.tmin || 0);

    // Taxa cancelamento
    const taxa_cancelamento = total_pedidos ? (cancelados / total_pedidos) * 100 : 0;

    // taxa de recompra média (clientes com >1 pedido / clientes com >=1 pedido)
    const [rep] = await db.execute(
      `
      SELECT
        SUM(CASE WHEN c.qtd > 1 THEN 1 ELSE 0 END) AS clientes_recompradores,
        COUNT(*) AS clientes_com_pedido
      FROM (
        SELECT o.customer, COUNT(*) AS qtd
        FROM \`order\` o
        ${where.sql}
        GROUP BY o.customer
      ) c
      `,
      where.params
    );
    const clientes_com_pedido = Number(rep[0]?.clientes_com_pedido || 0);
    const clientes_recompradores = Number(rep[0]?.clientes_recompradores || 0);
    const taxa_recompra_media = clientes_com_pedido ? (clientes_recompradores / clientes_com_pedido) * 100 : 0;

    // Gráficos
    // Faturamento por mês (somente concluídos)
    const [fatMes] = await db.execute(
      `
      SELECT DATE_FORMAT(o.createdAt, '%Y-%m') AS mes,
             COALESCE(SUM(CASE WHEN o.status='CONCLUDED' THEN o.totalAmount ELSE 0 END),0) AS receita
      FROM \`order\` o
      ${where.sql}
      GROUP BY DATE_FORMAT(o.createdAt, '%Y-%m')
      ORDER BY mes
      `,
      where.params
    );

    // Top 10 lojas por faturamento (com nome da loja)
    const [top] = await db.execute(
      `
      SELECT 
        o.companyId,
        e.store_name,
        COALESCE(
          SUM(
            CASE WHEN o.status='CONCLUDED' THEN o.totalAmount ELSE 0 END
          ),
          0
        ) AS receita
      FROM \`order\` o
      LEFT JOIN estabelecimentos e
             ON e.establishment_id = o.companyId
      ${where.sql}
      GROUP BY o.companyId, e.store_name
      ORDER BY receita DESC
      LIMIT 10
      `,
      where.params
    );

    // Heatmap performance (receita por loja por mês) com nome da loja
    const [heat] = await db.execute(
      `
      SELECT 
        o.companyId,
        e.store_name,
        DATE_FORMAT(o.createdAt,'%Y-%m') AS mes,
        COALESCE(SUM(CASE WHEN o.status='CONCLUDED' THEN o.totalAmount ELSE 0 END),0) AS receita
      FROM \`order\` o
      LEFT JOIN estabelecimentos e
             ON e.establishment_id = o.companyId
      ${where.sql}
      GROUP BY o.companyId, e.store_name, DATE_FORMAT(o.createdAt,'%Y-%m')
      ORDER BY o.companyId, mes
      `,
      where.params
    );

    // Distribuição por canal (concluído / cancelado / outros)
    const [canal] = await db.execute(
      `
      SELECT o.salesChannel AS canal,
             SUM(CASE WHEN o.status='CONCLUDED' THEN 1 ELSE 0 END) AS concluido,
             SUM(CASE WHEN o.status='CANCELED'  THEN 1 ELSE 0 END) AS cancelado,
             SUM(CASE WHEN o.status NOT IN ('CONCLUDED','CANCELED') THEN 1 ELSE 0 END) AS outros
      FROM \`order\` o
      ${where.sql}
      GROUP BY o.salesChannel
      ORDER BY concluido DESC
      `,
      where.params
    );

    // Ticket médio por canal (somente concluídos)
    const [ticketCanal] = await db.execute(
      `
      SELECT o.salesChannel AS canal,
             CASE WHEN SUM(CASE WHEN o.status='CONCLUDED' THEN 1 ELSE 0 END) = 0
                  THEN 0
                  ELSE SUM(CASE WHEN o.status='CONCLUDED' THEN o.totalAmount ELSE 0 END)
                       / SUM(CASE WHEN o.status='CONCLUDED' THEN 1 ELSE 0 END)
             END AS ticket_medio
      FROM \`order\` o
      ${where.sql}
      GROUP BY o.salesChannel
      ORDER BY ticket_medio DESC
      `,
      where.params
    );

    // Tempo médio de preparo por loja 
    const [prepLoja] = await db.execute(
      `
      SELECT 
        o.companyId,
        e.store_name,
        AVG(COALESCE(o.takeOutTimeInSeconds/60.0, o.preparationTime)) AS tempo_medio_min
      FROM \`order\` o
      LEFT JOIN estabelecimentos e
             ON e.establishment_id = o.companyId
      ${where.sql}
      GROUP BY o.companyId, e.store_name
      ORDER BY tempo_medio_min ASC
      `,
      where.params
    );

    // Taxa de recompra por mês
    const [recMes] = await db.execute(
      `
      SELECT
        t.mes,
        CASE WHEN t.clientes_total=0 THEN 0
             ELSE (t.clientes_recompradores / t.clientes_total) * 100
        END AS taxa
      FROM (
        SELECT DATE_FORMAT(o.createdAt, '%Y-%m') AS mes,
               SUM(CASE WHEN cc.qtd > 1 THEN 1 ELSE 0 END) AS clientes_recompradores,
               COUNT(*) AS clientes_total
        FROM \`order\` o
        JOIN (
          SELECT customer, COUNT(*) AS qtd
          FROM \`order\`
          WHERE isTest = 0
          GROUP BY customer
        ) cc ON cc.customer = o.customer
        ${where.sql}
        GROUP BY DATE_FORMAT(o.createdAt, '%Y-%m')
      ) t
      ORDER BY t.mes
      `,
      where.params
    );

    // Filtros auxiliares
    const [meses] = await db.execute(
      `
      SELECT DISTINCT DATE_FORMAT(o.createdAt,'%Y-%m') AS mes
      FROM \`order\` o
      WHERE o.isTest = 0
      ORDER BY mes
      `
    );

    // Lista de lojas com nome para o filtro
    const [lojas] = await db.execute(
      `
      SELECT DISTINCT 
        o.companyId AS id,
        e.store_name
      FROM \`order\` o
      LEFT JOIN estabelecimentos e
             ON e.establishment_id = o.companyId
      WHERE o.isTest = 0
      ORDER BY e.store_name, o.companyId
      `
    );

    // Resposta em Json
    res.json({
      kpis: {
        faturamento_total: Number(faturamento_total.toFixed(2)),
        ticket_medio_geral: Number(ticket_medio_geral.toFixed(2)),
        lojas_ativas,
        taxa_cancelamento: Number(taxa_cancelamento.toFixed(2)),
        tempo_preparo_medio_min: Number(tempo_preparo_medio_min.toFixed(2)),
        taxa_recompra_media: Number(taxa_recompra_media.toFixed(2)),
      },
      graficos: {
        faturamentoMes: fatMes.map(r => ({
          mes: r.mes,
          receita: Number(r.receita || 0),
        })),
        topLojas: top.map(r => ({
          companyId: r.companyId,
          nomeLoja: r.store_name || "(Loja sem nome)",
          receita: Number(r.receita || 0),
        })),
        performanceHeatmap: heat.map(r => ({
          companyId: r.companyId,
          nomeLoja: r.store_name || "(Loja sem nome)",
          mes: r.mes,
          receita: Number(r.receita || 0),
        })),
        canaisPedidos: canal.map(r => ({
          canal: r.canal || "—",
          concluido: Number(r.concluido || 0),
          cancelado: Number(r.cancelado || 0),
          outros: Number(r.outros || 0),
        })),
        ticketPorCanal: ticketCanal.map(r => ({
          canal: r.canal || "—",
          ticket_medio: Number(r.ticket_medio || 0),
        })),
        preparoPorLoja: prepLoja.map(r => ({
          companyId: r.companyId,
          nomeLoja: r.store_name || "(Loja sem nome)",
          tempo_medio_min: Number(r.tempo_medio_min || 0),
        })),
        recompraMes: recMes.map(r => ({
          mes: r.mes,
          taxa: Number(r.taxa || 0),
        })),
      },
      filtros: {
        mesesDisponiveis: meses.map(r => r.mes),
        lojas: lojas.map(r => ({
          id: r.id,
          nome: r.store_name || "(Loja sem nome)",
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao carregar dashboard de estabelecimentos (admin)." });
  }
}