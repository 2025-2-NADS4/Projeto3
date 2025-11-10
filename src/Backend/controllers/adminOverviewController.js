import db from "../config/db.js";
import PDFDocument from "pdfkit";

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

    // Tempo de preparo x taxa de recompra por loja
    const [recLoja] = await db.execute(
      `
      SELECT
        x.companyId,
        e.store_name,
        SUM(CASE WHEN x.qtd > 1 THEN 1 ELSE 0 END) AS clientes_recompradores,
        COUNT(*) AS clientes_total
      FROM (
        SELECT o.customer, o.companyId, COUNT(*) AS qtd
        FROM \`order\` o
        ${where.sql}
        GROUP BY o.customer, o.companyId
      ) x
      LEFT JOIN estabelecimentos e
             ON e.establishment_id = x.companyId
      GROUP BY x.companyId, e.store_name
      ORDER BY e.store_name, x.companyId
      `,
      where.params
    );

    // Mapa auxiliar: tempo médio de preparo por loja
    const mapaTempoPorLoja = new Map(
      prepLoja.map(r => [
        String(r.companyId),
        Number(r.tempo_medio_min || 0),
      ])
    );

    // Base final para o gráfico 1 (tempo x recompra por loja)
    const relacaoPreparoRecompra = recLoja.map(r => {
      const empresaId = String(r.companyId);
      const tempoLoja = mapaTempoPorLoja.get(empresaId) ?? 0;
      const clientesTotalLoja = Number(r.clientes_total || 0);
      const clientesRecompradoresLoja = Number(r.clientes_recompradores || 0);
      const taxaLoja = clientesTotalLoja
        ? (clientesRecompradoresLoja / clientesTotalLoja) * 100
        : 0;

      return {
        companyId: r.companyId,
        nomeLoja: r.store_name || "(Loja sem nome)",
        tempo_preparo_medio_min: Number(tempoLoja.toFixed(2)),
        taxa_recompra: Number(taxaLoja.toFixed(2)),
      };
    });

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
        preparoVsRecompraLojas: relacaoPreparoRecompra,
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

// GET /api/admin/estabelecimentos/dashboard/export/pdf
export async function exportAdminOverviewPdf(req, res) {
  try {
    const usuario = req.user;
    if (!usuario) {
      return res.status(401).json({ erro: "Usuário não autenticado!" });
    }

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "admin") {
      return res
        .status(403)
        .json({ erro: "Apenas administradores podem exportar este relatório." });
    }

    const { mesInicio, mesFim, companyId } = req.query || {};
    const where = montarWherePedidos({ mesInicio, mesFim, companyId });

    // Nome da loja
    let contextoLoja = "Todas as lojas";
    if (companyId) {
      const [[loja]] = await db.execute(
        `SELECT store_name
           FROM estabelecimentos
          WHERE establishment_id = ?
          LIMIT 1`,
        [companyId]
      );
      contextoLoja = loja?.store_name || `Loja ${companyId}`;
    }

    const periodoLabel = `Período analisado: ${mesInicio || "início"
      } até ${mesFim || "atual"}`;

    // KPIs
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

    const [totPed] = await db.execute(
      `SELECT COUNT(*) AS n FROM \`order\` o ${where.sql}`,
      where.params
    );
    const total_pedidos = Number(totPed[0]?.n || 0);

    const [totCanc] = await db.execute(
      `SELECT COUNT(*) AS n FROM \`order\` o ${where.sql} AND o.status = 'CANCELED'`,
      where.params
    );
    const cancelados = Number(totCanc[0]?.n || 0);

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

    const [lojAt] = await db.execute(
      `SELECT COUNT(DISTINCT o.companyId) AS n FROM \`order\` o ${where.sql}`,
      where.params
    );
    const lojas_ativas = Number(lojAt[0]?.n || 0);

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

    const taxa_cancelamento = total_pedidos
      ? (cancelados / total_pedidos) * 100
      : 0;

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
    const clientes_recompradores = Number(
      rep[0]?.clientes_recompradores || 0
    );
    const taxa_recompra_media = clientes_com_pedido
      ? (clientes_recompradores / clientes_com_pedido) * 100
      : 0;

    //  Dados para tabelas
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

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Admin_Overview.pdf"`
    );

    doc.pipe(res);

    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const fmtMoney = (v) =>
      Number(v || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });

    const fmtPercent = (v) =>
      `${Number(v || 0).toFixed(1)}%`;

    const ensureSpace = (needed = 60) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
    };

    function drawTable({ titulo, headers, rows }) {
      if (!rows || !rows.length) return;

      ensureSpace(80);

      // Título
      doc
        .moveDown(0.8)
        .fontSize(13)
        .fillColor("#ff7a00")
        .text(titulo, doc.page.margins.left, undefined, {
          width: contentWidth,
          align: "left",
          underline: true,
        })
        .moveDown(0.3);

      const tableWidth = contentWidth;
      const colCount = headers.length;
      const colWidth = tableWidth / colCount;

      const drawHeader = () => {
        const yHeader = doc.y;
        doc
          .rect(doc.page.margins.left, yHeader, tableWidth, 20)
          .fill("#ff7a00");

        headers.forEach((h, i) => {
          const x = doc.page.margins.left + i * colWidth;
          doc
            .fillColor("#fff")
            .fontSize(10)
            .text(h, x + 4, yHeader + 4, {
              width: colWidth - 8,
              align: "left",
            });
        });

        doc.y = yHeader + 22;
      };

      drawHeader();

      const rowHeight = 18;
      let altColor = false;

      rows.forEach((row) => {
        if (
          doc.y + rowHeight >
          doc.page.height - doc.page.margins.bottom
        ) {
          doc.addPage();
          doc.y = doc.page.margins.top;
          drawHeader();
        }

        const yRow = doc.y;

        doc
          .rect(doc.page.margins.left, yRow - 1, tableWidth, rowHeight)
          .fill(altColor ? "#f8f8f8" : "#ffffff");
        altColor = !altColor;

        row.forEach((cell, i) => {
          const x = doc.page.margins.left + i * colWidth;
          doc
            .fontSize(9.5)
            .fillColor("#000")
            .text(String(cell ?? "—"), x + 4, yRow + 2, {
              width: colWidth - 8,
              align: "left",
            });
        });

        doc.y = yRow + rowHeight;
      });
    }

    // Cabeçalho
    doc
      .fontSize(20)
      .fillColor("#ff7a00")
      .text(
        "Relatório Geral de Estabelecimentos (Admin)",
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
          underline: true,
        }
      )
      .moveDown(0.3)
      .fontSize(13)
      .fillColor("#000")
      .text(contextoLoja, doc.page.margins.left, undefined, {
        width: contentWidth,
        align: "center",
      })
      .moveDown(0.2)
      .fontSize(10)
      .fillColor("gray")
      .text(
        `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      )
      .moveDown(0.2)
      .fontSize(10)
      .fillColor("gray")
      .text(periodoLabel, doc.page.margins.left, undefined, {
        width: contentWidth,
        align: "center",
      })
      .moveDown(1);

    // KPIs (cards)
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text("Resumo geral", doc.page.margins.left, undefined, {
        width: contentWidth,
        align: "left",
        underline: true,
      })
      .moveDown(0.5);

    const baseX = doc.page.margins.left;
    const boxGap = 10;
    const boxWidth = (contentWidth - boxGap * 3) / 4;
    const boxHeight = 60;
    const boxY = doc.y;

    const drawKpi = (x, titulo, valor, subtitulo, color) => {
      doc
        .rect(x, boxY, boxWidth, boxHeight)
        .strokeColor(color)
        .lineWidth(1.2)
        .stroke();

      doc
        .fontSize(9)
        .fillColor("gray")
        .text(titulo, x + 8, boxY + 6, {
          width: boxWidth - 16,
          align: "center",
        });

      doc
        .fontSize(16)
        .fillColor(color)
        .text(String(valor), x + 8, boxY + 22, {
          width: boxWidth - 16,
          align: "center",
        });

      if (subtitulo) {
        doc
          .fontSize(9)
          .fillColor("gray")
          .text(subtitulo, x + 8, boxY + 40, {
            width: boxWidth - 16,
            align: "center",
          });
      }
    };

    drawKpi(
      baseX,
      "Faturamento total",
      fmtMoney(faturamento_total),
      "Pedidos concluídos",
      "#28a745"
    );
    drawKpi(
      baseX + (boxWidth + boxGap),
      "Total de pedidos",
      total_pedidos,
      "",
      "#ff7a00"
    );
    drawKpi(
      baseX + (boxWidth + boxGap) * 2,
      "Ticket médio (geral)",
      fmtMoney(ticket_medio_geral),
      "",
      "#007bff"
    );
    drawKpi(
      baseX + (boxWidth + boxGap) * 3,
      "Taxa de cancelamento",
      fmtPercent(taxa_cancelamento),
      `Cancelados: ${cancelados}`,
      "#dc3545"
    );

    doc.y = boxY + boxHeight + 35;

    ensureSpace(60);
    doc
      .fontSize(11)
      .fillColor("#000")
      .text(
        `Lojas ativas no período: ${lojas_ativas}`,
        doc.page.margins.left,
        undefined,
        { width: contentWidth }
      )
      .moveDown(0.2)
      .text(
        `Tempo médio de preparo: ${tempo_preparo_medio_min.toFixed(
          1
        )} min`,
        doc.page.margins.left,
        undefined,
        { width: contentWidth }
      )
      .moveDown(0.2)
      .text(
        `Taxa média de recompra: ${fmtPercent(taxa_recompra_media)}`,
        doc.page.margins.left,
        undefined,
        { width: contentWidth }
      )
      .moveDown(0.8);

    // Tabelas
    // Faturamento por mês
    drawTable({
      titulo: "Faturamento por mês (pedidos concluídos)",
      headers: ["Mês", "Receita"],
      rows: fatMes.map((r) => [r.mes, fmtMoney(r.receita)]),
    });

    // Top 10 lojas por faturamento
    drawTable({
      titulo: "Top 10 lojas por faturamento",
      headers: ["Loja", "CompanyId", "Receita"],
      rows: top.map((r) => [
        r.store_name || "(Loja sem nome)",
        r.companyId || "—",
        fmtMoney(r.receita),
      ]),
    });

    // Performance por loja/mês
    drawTable({
      titulo: "Performance por loja e mês (receita concluída)",
      headers: ["Loja", "CompanyId", "Mês", "Receita"],
      rows: heat.map((r) => [
        r.store_name || "(Loja sem nome)",
        r.companyId || "—",
        r.mes,
        fmtMoney(r.receita),
      ]),
    });

    // Distribuição de pedidos por canal
    drawTable({
      titulo: "Distribuição de pedidos por canal",
      headers: ["Canal", "Concluídos", "Cancelados", "Outros"],
      rows: canal.map((r) => [
        r.canal || "—",
        r.concluido,
        r.cancelado,
        r.outros,
      ]),
    });

    // Ticket médio por canal
    drawTable({
      titulo: "Ticket médio por canal (pedidos concluídos)",
      headers: ["Canal", "Ticket médio"],
      rows: ticketCanal.map((r) => [
        r.canal || "—",
        fmtMoney(r.ticket_medio),
      ]),
    });

    // Tempo médio de preparo por loja
    drawTable({
      titulo: "Tempo médio de preparo por loja",
      headers: ["Loja", "CompanyId", "Tempo médio (min)"],
      rows: prepLoja.map((r) => [
        r.store_name || "(Loja sem nome)",
        r.companyId || "—",
        Number(r.tempo_medio_min || 0).toFixed(1),
      ]),
    });

    // Taxa de recompra por mês
    drawTable({
      titulo: "Taxa de recompra por mês",
      headers: ["Mês", "Taxa de recompra"],
      rows: recMes.map((r) => [
        r.mes,
        fmtPercent(r.taxa),
      ]),
    });

    // Rodapé
    ensureSpace(40);
    doc
      .moveDown(1)
      .strokeColor("#dddddd")
      .lineWidth(0.5)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + contentWidth, doc.y)
      .stroke()
      .moveDown(0.5);

    doc
      .fontSize(10)
      .fillColor("gray")
      .text(
        `Relatório gerado automaticamente pelo dashboard de estabelecimentos (admin) — ${contextoLoja}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportAdminOverviewPdf:", err);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ erro: "Erro ao gerar PDF do overview (admin)." });
    }
    try {
      res.end();
    } catch (_) { }
  }
}