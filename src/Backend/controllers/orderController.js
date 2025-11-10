import db from "../config/db.js";
import PDFDocument from "pdfkit";

// GET /api/estabelecimento/pedidos
export async function getPedidosEstabelecimento(req, res) {
  try {
    const { establishment_id } = req.user;
    const { mesInicio, mesFim } = req.query;

    const where = ["companyId = ?"];
    const params = [establishment_id];
    if (mesInicio) { where.push("createdAt >= ?"); params.push(`${mesInicio}-01`); }
    if (mesFim) { where.push("createdAt < DATE_ADD(?, INTERVAL 1 MONTH)"); params.push(`${mesFim}-01`); }

    const whereConcluidos = [...where, "status = 'CONCLUDED'"];
    const paramsConcluidos = [...params];

    // KPIs 
    const [kpiGeralRows] = await db.execute(`
      SELECT
        COUNT(*) AS total_pedidos,
        SUM(CASE WHEN LOWER(status) LIKE '%cancel%' THEN 1 ELSE 0 END) AS cancelados
      FROM \`order\`
      WHERE ${where.join(" AND ")}
    `, params);

    const [kpiConcluidosRows] = await db.execute(`
      SELECT
        SUM(totalAmount) AS receita_total,
        AVG(totalAmount) AS ticket_medio_geral
      FROM \`order\`
      WHERE ${whereConcluidos.join(" AND ")}
    `, paramsConcluidos);

    const total_pedidos = Number(kpiGeralRows[0]?.total_pedidos || 0);
    const cancelados = Number(kpiGeralRows[0]?.cancelados || 0);
    const taxa_cancelamento = total_pedidos
      ? (cancelados / total_pedidos) * 100
      : 0;

    const kpis = {
      total_pedidos,
      receita_total: Number(kpiConcluidosRows[0]?.receita_total || 0),
      ticket_medio_geral: Number(kpiConcluidosRows[0]?.ticket_medio_geral || 0),
      taxa_cancelamento,
    };

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
      WHERE ${whereConcluidos.join(" AND ")}
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
      ORDER BY mes
    `, paramsConcluidos);

    // Ticket médio por canal
    const [ticketCanal] = await db.execute(`
      SELECT salesChannel AS canal, AVG(totalAmount) AS ticket_medio
      FROM \`order\`
      WHERE ${whereConcluidos.join(" AND ")}
      GROUP BY salesChannel
    `, paramsConcluidos);

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

    // Meses disponíveis 
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
    );
    const lojaNome = linhaLoja?.store_name || "(Loja sem nome)";

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

// Função para transformar 'YYYY-MM' em limites de data [início, fim) */
function intervaloMes(yyyymm) {
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
    let { mesInicio, mesFim, companyId, storeName } = req.query;

    // Se veio storeName mas não veio companyId, converte nome -> id
    if (!companyId && storeName) {
      const [[loja]] = await db.execute(
        `SELECT establishment_id
           FROM estabelecimentos
          WHERE store_name = ?
          LIMIT 1`,
        [storeName]
      );

      if (loja) {
        companyId = loja.establishment_id;
      }
    }

    const { clausula, valores } = montarWhere({ mesInicio, mesFim, companyId });

    const clausulaConcluidos = clausula
      ? `${clausula} AND status = 'CONCLUDED'`
      : "WHERE status = 'CONCLUDED'";
    const valoresConcluidos = [...valores];

    // KPIs
    const [[tot]] = await db.execute(
      `SELECT COUNT(*) AS total_pedidos
         FROM \`order\` ${clausula}`,
      valores
    );

    const [[canc]] = await db.execute(
      `SELECT COUNT(*) AS cancelados
         FROM \`order\`
        ${clausula ? clausula + " AND" : "WHERE"} status = 'CANCELED'`,
      valores
    );

    const [[totConcl]] = await db.execute(
      `SELECT
          COALESCE(SUM(totalAmount),0) AS receita_total,
          COALESCE(AVG(totalAmount),0) AS ticket_medio_geral
         FROM \`order\` ${clausulaConcluidos}`,
      valoresConcluidos
    );

    const totalPedidos = Number(tot?.total_pedidos || 0);
    const cancelados = Number(canc?.cancelados || 0);
    const taxa_cancelamento = totalPedidos ? (cancelados / totalPedidos) * 100 : 0;

    const [status] = await db.execute(
      `SELECT status, COUNT(*) AS qtde
         FROM \`order\` ${clausula}
        GROUP BY status
        ORDER BY qtde DESC`,
      valores
    );

    const [canal] = await db.execute(
      `SELECT salesChannel AS canal, COUNT(*) AS qtde
         FROM \`order\` ${clausula}
        GROUP BY salesChannel
        ORDER BY qtde DESC`,
      valores
    );

    // Receita por mês 
    const [receitaMes] = await db.execute(
      `SELECT DATE_FORMAT(createdAt,'%Y-%m') AS mes,
              COALESCE(SUM(totalAmount),0) AS receita
         FROM \`order\` ${clausulaConcluidos}
        GROUP BY DATE_FORMAT(createdAt,'%Y-%m')
        ORDER BY mes`,
      valoresConcluidos
    );

    // Ticket médio por canal 
    const [ticketCanal] = await db.execute(
      `SELECT salesChannel AS canal,
              COALESCE(AVG(totalAmount),0) AS ticket_medio
         FROM \`order\` ${clausulaConcluidos}
        GROUP BY salesChannel
        ORDER BY canal`,
      valoresConcluidos
    );

    const [tempoMedio] = await db.execute(
      `SELECT orderType AS tipo,
              COALESCE(AVG(preparationTime),0) AS tempo_medio
         FROM \`order\` ${clausula}
        GROUP BY orderType
        ORDER BY tipo`,
      valores
    );

    const [horarios] = await db.execute(
      `SELECT HOUR(createdAt) AS hora, COUNT(*) AS qtde
         FROM \`order\` ${clausula}
        GROUP BY HOUR(createdAt)
        ORDER BY hora`,
      valores
    );

    // Meses disponíveis
    const [mesesTodos] = await db.execute(
      `SELECT DISTINCT DATE_FORMAT(createdAt,'%Y-%m') AS mes
         FROM \`order\`
        ORDER BY mes`
    );
    const mesesDisponiveis = mesesTodos.map((r) => r.mes);

    // Lista de lojas
    const [lojasRows] = await db.execute(
      `SELECT DISTINCT o.companyId AS id, e.store_name AS nome
         FROM \`order\` o
    LEFT JOIN estabelecimentos e
           ON e.establishment_id = o.companyId
        WHERE o.companyId IS NOT NULL
        ORDER BY nome`
    );

    const lojas = lojasRows.map((r) => ({
      id: r.id,
      nome: r.nome || String(r.id),
    }));

    res.json({
      kpis: {
        total_pedidos: totalPedidos,
        receita_total: Number(totConcl?.receita_total || 0),
        ticket_medio_geral: Number(totConcl?.ticket_medio_geral || 0),
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
      filtros: { mesesDisponiveis },
      lojas,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao carregar dados de pedidos (admin)." });
  }
}

// GET /api/estabelecimento/pedidos/export/pdf
export async function exportPedidosEstabPdf(req, res) {
  try {
    const usuario = req.user;
    if (!usuario) {
      return res.status(401).json({ erro: "Usuário não autenticado!" });
    }

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "estabelecimento") {
      return res
        .status(403)
        .json({ erro: "Acesso negado! Apenas estabelecimentos podem acessar." });
    }

    const establishment_id = usuario.establishment_id;
    const { mesInicio, mesFim } = req.query;

    const where = ["companyId = ?"];
    const params = [establishment_id];

    if (mesInicio) {
      where.push("createdAt >= ?");
      params.push(`${mesInicio}-01`);
    }
    if (mesFim) {
      where.push("createdAt < DATE_ADD(?, INTERVAL 1 MONTH)");
      params.push(`${mesFim}-01`);
    }

    const whereConcluidos = [...where, "status = 'CONCLUDED'"];
    const paramsConcluidos = [...params];

    // Nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [establishment_id]
    );
    const lojaNome = linhaLoja?.store_name || "Estabelecimento";

    // KPIs
    const [kpiGeralRows] = await db.execute(
      `
      SELECT
        COUNT(*) AS total_pedidos,
        SUM(CASE WHEN LOWER(status) LIKE '%cancel%' THEN 1 ELSE 0 END) AS cancelados
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      `,
      params
    );

    const [kpiConcluidosRows] = await db.execute(
      `
      SELECT
        SUM(totalAmount) AS receita_total,
        AVG(totalAmount) AS ticket_medio_geral
      FROM \`order\`
      WHERE ${whereConcluidos.join(" AND ")}
      `,
      paramsConcluidos
    );

    const total_pedidos = Number(kpiGeralRows[0]?.total_pedidos || 0);
    const cancelados = Number(kpiGeralRows[0]?.cancelados || 0);
    const taxa_cancelamento = total_pedidos
      ? Math.round((cancelados / total_pedidos) * 100)
      : 0;

    const receita_total = Number(kpiConcluidosRows[0]?.receita_total || 0);
    const ticket_medio_geral = Number(
      kpiConcluidosRows[0]?.ticket_medio_geral || 0
    );

    // Lista de pedidos
    const [rowsDetalhe] = await db.execute(
      `
      SELECT 
        id,
        status,
        salesChannel,
        totalAmount,
        createdAt
      FROM \`order\`
      WHERE ${where.join(" AND ")}
      ORDER BY createdAt DESC
      `,
      params
    );

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Pedidos_${lojaNome.replace(
        /\s+/g,
        "_"
      )}.pdf"`
    );

    doc.pipe(res);

    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const contentWidth = pageWidth;

    // Cabeçalho
    doc
      .fontSize(20)
      .fillColor("#ff7a00")
      .text(
        "Relatório de Pedidos",
        doc.page.margins.left,
        undefined,
        {
          align: "center",
          width: contentWidth,
          underline: true,
        }
      )
      .moveDown(0.3)
      .fontSize(13)
      .fillColor("#000")
      .text(lojaNome, doc.page.margins.left, undefined, {
        align: "center",
        width: contentWidth,
      })
      .moveDown(0.2)
      .fontSize(10)
      .fillColor("gray")
      .text(
        `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
        doc.page.margins.left,
        undefined,
        {
          align: "center",
          width: contentWidth,
        }
      )
      .moveDown(1);

    // Período
    doc
      .fontSize(12)
      .fillColor("#000")
      .text(
        `Período analisado: ${mesInicio || "início"} até ${mesFim || "atual"}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      )
      .moveDown(0.6);

    // Resumo geral (cards)
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
    const boxHeight = 55;
    const boxY = doc.y;

    const drawKpiBox = (x, titulo, valor, color) => {
      doc
        .rect(x, boxY, boxWidth, boxHeight)
        .strokeColor(color)
        .lineWidth(1.2)
        .stroke();

      doc
        .fontSize(10)
        .fillColor("gray")
        .text(titulo, x + 8, boxY + 8, {
          width: boxWidth - 16,
          align: "center",
        });

      doc
        .fontSize(18)
        .fillColor(color)
        .text(String(valor), x + 8, boxY + 30, {
          width: boxWidth - 16,
          align: "center",
        });
    };

    const formatCurrency = (v) =>
      v.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    drawKpiBox(
      baseX,
      "Total de pedidos",
      total_pedidos,
      "#ff7a00"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Receita total (R$)",
      `R$ ${formatCurrency(receita_total)}`,
      "#28a745"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Ticket médio (R$)",
      `R$ ${formatCurrency(ticket_medio_geral)}`,
      "#007bff"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Taxa de cancelamento",
      `${Math.round(taxa_cancelamento)}%`,
      "#dc3545"
    );

    doc.y = boxY + boxHeight + 40;

    // Título da tabela
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text(
        "Detalhamento dos pedidos",
        doc.page.margins.left,
        undefined,
        {
          underline: true,
          width: contentWidth,
          align: "center",
        }
      )
      .moveDown(0.6);

    // Tabela
    const tableWidth = contentWidth;
    const colX = [
      doc.page.margins.left,       // ID
      doc.page.margins.left + 60,  // Status
      doc.page.margins.left + 190, // Canal
      doc.page.margins.left + 320, // Valor
      doc.page.margins.left + 430, // Criado em
    ];
    const colW = [50, 120, 120, 100, 120];
    const headers = ["ID", "Status", "Canal", "Valor (R$)", "Criado em"];

    const drawHeader = (y) => {
      doc.rect(doc.page.margins.left, y - 3, tableWidth, 20).fill("#ff7a00");

      headers.forEach((h, i) => {
        doc
          .fillColor("#fff")
          .fontSize(10)
          .text(h, colX[i], y + 4, {
            width: colW[i],
            align: "left",
          });
      });
    };

    let y = doc.y;
    drawHeader(y);
    y += 24;
    let altColor = false;

    for (const r of rowsDetalhe) {
      const criadoEm = r.createdAt
        ? new Date(r.createdAt).toLocaleString("pt-BR")
        : "—";
      const valor = r.totalAmount
        ? `R$ ${formatCurrency(Number(r.totalAmount))}`
        : "R$ 0,00";

      // Quebra de página
      if (y > 740) {
        doc.addPage();
        y = 60;
        drawHeader(y);
        y += 24;
      }

      // Linha zebra
      doc
        .rect(doc.page.margins.left, y - 2, tableWidth, 18)
        .fill(altColor ? "#f8f8f8" : "#ffffff");
      altColor = !altColor;

      doc
        .fontSize(9.5)
        .fillColor("#000")
        .text(r.id, colX[0], y, { width: colW[0] })
        .text(r.status || "-", colX[1], y, { width: colW[1] })
        .text(r.salesChannel || "-", colX[2], y, { width: colW[2] })
        .text(valor, colX[3], y, { width: colW[3] })
        .text(criadoEm, colX[4], y, { width: colW[4] });

      y += 18;
    }

    // Rodapé
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
        `Relatório gerado automaticamente pelo módulo de Pedidos — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportPedidosEstabPdf:", err);
    return res.status(500).json({
      erro: "Erro ao gerar PDF de pedidos.",
    });
  }
}

// GET /api/admin/pedidos/export/pdf
export async function exportPedidosAdminPdf(req, res) {
  try {
    const usuario = req.user;
    if (!usuario) {
      return res
        .status(401)
        .json({ erro: "Usuário não autenticado!" });
    }

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "admin") {
      return res
        .status(403)
        .json({ erro: "Acesso negado! Apenas administradores podem acessar." });
    }

    let { mesInicio, mesFim, companyId, storeName } = req.query;

    // Nome da loja para o cabeçalho
    let lojaNome = "Todas as lojas";

    // Se veio storeName mas não companyId, converte nome -> id
    if (!companyId && storeName) {
      const [[loja]] = await db.execute(
        `SELECT establishment_id, store_name
           FROM estabelecimentos
          WHERE store_name = ?
          LIMIT 1`,
        [storeName]
      );

      if (loja) {
        companyId = loja.establishment_id;
        lojaNome = loja.store_name || storeName;
      } else {
        lojaNome = storeName;
      }
    } else if (companyId) {
      const [[loja]] = await db.execute(
        `SELECT store_name
           FROM estabelecimentos
          WHERE establishment_id = ?
          LIMIT 1`,
        [companyId]
      );
      if (loja) {
        lojaNome = loja.store_name || `Loja ${companyId}`;
      } else {
        lojaNome = `Loja ${companyId}`;
      }
    }

    // Monta WHERE
    const { clausula, valores } = montarWhere({ mesInicio, mesFim, companyId });

    const clausulaConcluidos = clausula
      ? `${clausula} AND status = 'CONCLUDED'`
      : "WHERE status = 'CONCLUDED'";
    const valoresConcluidos = [...valores];

    // KPIs
    const [[tot]] = await db.execute(
      `SELECT COUNT(*) AS total_pedidos
         FROM \`order\` ${clausula}`,
      valores
    );

    const [[canc]] = await db.execute(
      `SELECT COUNT(*) AS cancelados
         FROM \`order\`
        ${clausula ? clausula + " AND" : "WHERE"} status = 'CANCELED'`,
      valores
    );

    const [[totConcl]] = await db.execute(
      `SELECT
          COALESCE(SUM(totalAmount),0) AS receita_total,
          COALESCE(AVG(totalAmount),0) AS ticket_medio_geral
         FROM \`order\` ${clausulaConcluidos}`,
      valoresConcluidos
    );

    const totalPedidos = Number(tot?.total_pedidos || 0);
    const cancelados = Number(canc?.cancelados || 0);
    const receitaTotal = Number(totConcl?.receita_total || 0);
    const ticketMedioGeral = Number(totConcl?.ticket_medio_geral || 0);
    const taxaCancelamento = totalPedidos
      ? (cancelados / totalPedidos) * 100
      : 0;

    // Pedidos por status
    const [statusRows] = await db.execute(
      `SELECT status, COUNT(*) AS qtde
         FROM \`order\` ${clausula}
        GROUP BY status
        ORDER BY qtde DESC`,
      valores
    );

    const linhasStatus = (statusRows || []).map((r) => ({
      status: r.status || "—",
      qtde: Number(r.qtde || 0),
    }));

    // Pedidos por canal
    const [canalRows] = await db.execute(
      `SELECT salesChannel AS canal, COUNT(*) AS qtde
         FROM \`order\` ${clausula}
        GROUP BY salesChannel
        ORDER BY qtde DESC`,
      valores
    );

    const linhasCanal = (canalRows || []).map((r) => ({
      canal: r.canal || "—",
      qtde: Number(r.qtde || 0),
    }));

    // Receita por mês (apenas concluídos)
    const [receitaMesRows] = await db.execute(
      `SELECT DATE_FORMAT(createdAt,'%Y-%m') AS mes,
              COALESCE(SUM(totalAmount),0) AS receita
         FROM \`order\` ${clausulaConcluidos}
        GROUP BY DATE_FORMAT(createdAt,'%Y-%m')
        ORDER BY mes`,
      valoresConcluidos
    );

    const linhasReceitaMes = (receitaMesRows || []).map((r) => ({
      mes: r.mes || "—",
      receita: Number(r.receita || 0),
    }));

    // Ticket médio por canal (apenas concluídos)
    const [ticketCanalRows] = await db.execute(
      `SELECT salesChannel AS canal,
              COALESCE(AVG(totalAmount),0) AS ticket_medio
         FROM \`order\` ${clausulaConcluidos}
        GROUP BY salesChannel
        ORDER BY canal`,
      valoresConcluidos
    );

    const linhasTicketCanal = (ticketCanalRows || []).map((r) => ({
      canal: r.canal || "—",
      ticket_medio: Number(r.ticket_medio ?? 0),
    }));

    // Tempo médio de preparo por tipo
    const [tempoMedioRows] = await db.execute(
      `SELECT orderType AS tipo,
              COALESCE(AVG(preparationTime),0) AS tempo_medio
         FROM \`order\` ${clausula}
        GROUP BY orderType
        ORDER BY tipo`,
      valores
    );

    const linhasTempo = (tempoMedioRows || []).map((r) => ({
      tipo: r.tipo || "—",
      tempo_medio: Number(r.tempo_medio ?? 0),
    }));

    // Pedidos por hora do dia
    const [horariosRows] = await db.execute(
      `SELECT HOUR(createdAt) AS hora, COUNT(*) AS qtde
         FROM \`order\` ${clausula}
        GROUP BY HOUR(createdAt)
        ORDER BY hora`,
      valores
    );

    const linhasHorario = (horariosRows || []).map((r) => ({
      hora: Number(r.hora ?? 0),
      qtde: Number(r.qtde ?? 0),
    }));

    // Montagem do PDF
    const fmtMoney = (v) =>
      Number(v || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });

    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Pedidos_Admin.pdf"`
    );

    doc.pipe(res);

    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const periodoLabel = `Período analisado: ${
      mesInicio || "início"
    } até ${mesFim || "atual"}`;

    // Cabeçalho principal
    doc
      .fontSize(20)
      .fillColor("#ff7a00")
      .text("Relatório de Pedidos (Admin)", doc.page.margins.left, undefined, {
        align: "center",
        width: contentWidth,
        underline: true,
      })
      .moveDown(0.3)
      .fontSize(13)
      .fillColor("#000")
      .text(lojaNome, doc.page.margins.left, undefined, {
        align: "center",
        width: contentWidth,
      })
      .moveDown(0.2)
      .fontSize(10)
      .fillColor("gray")
      .text(
        `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
        doc.page.margins.left,
        undefined,
        {
          align: "center",
          width: contentWidth,
        }
      )
      .moveDown(0.6)
      .fontSize(11)
      .fillColor("#000")
      .text(periodoLabel, doc.page.margins.left, undefined, {
        align: "center",
        width: contentWidth,
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
    const boxHeight = 55;
    const boxY = doc.y;

    const drawKpiBox = (x, titulo, valor, color) => {
      doc
        .rect(x, boxY, boxWidth, boxHeight)
        .strokeColor(color)
        .lineWidth(1.2)
        .stroke();

      doc
        .fontSize(10)
        .fillColor("gray")
        .text(titulo, x + 8, boxY + 8, {
          width: boxWidth - 16,
          align: "center",
        });

      doc
        .fontSize(16)
        .fillColor(color)
        .text(String(valor), x + 8, boxY + 28, {
          width: boxWidth - 16,
          align: "center",
        });
    };

    drawKpiBox(baseX, "Total de pedidos", totalPedidos, "#ff7a00");
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Receita total",
      fmtMoney(receitaTotal),
      "#28a745"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Ticket médio (geral)",
      fmtMoney(ticketMedioGeral),
      "#007bff"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Taxa de cancelamento",
      `${taxaCancelamento.toFixed(1)}%`,
      "#dc3545"
    );

    doc.y = boxY + boxHeight + 35;

    // Helper para quebra de página
    const ensureSpace = (needed = 60) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
    };

    function drawSimpleTable({ titulo, headers, rows }) {
      if (!rows || !rows.length) return;

      ensureSpace(80);

      // Título da seção
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
      const colX = [];
      let accX = doc.page.margins.left;

      for (let i = 0; i < colCount; i++) {
        colX.push(accX);
        accX += colWidth;
      }

      const headerY = doc.y + 2;

      // Header
      doc
        .rect(doc.page.margins.left, headerY - 3, tableWidth, 20)
        .fill("#ff7a00");

      headers.forEach((h, i) => {
        doc
          .fillColor("#fff")
          .fontSize(10)
          .text(h, colX[i] + 4, headerY + 4, {
            width: colWidth - 8,
            align: "left",
          });
      });

      let y = headerY + 24;
      let altColor = false;

      rows.forEach((row) => {
        ensureSpace(30);
        if (doc.y !== y) {
          y = doc.y;
          doc
            .rect(doc.page.margins.left, y - 3, tableWidth, 20)
            .fill("#ff7a00");
          headers.forEach((h, i) => {
            doc
              .fillColor("#fff")
              .fontSize(10)
              .text(h, colX[i] + 4, y + 4, {
                width: colWidth - 8,
                align: "left",
              });
          });
          y += 24;
        }

        doc
          .rect(doc.page.margins.left, y - 2, tableWidth, 18)
          .fill(altColor ? "#f8f8f8" : "#ffffff");
        altColor = !altColor;

        row.forEach((cell, i) => {
          doc
            .fontSize(9.5)
            .fillColor("#000")
            .text(String(cell ?? "—"), colX[i] + 4, y, {
              width: colWidth - 8,
              align: "left",
            });
        });

        y += 18;
        doc.y = y;
      });
    }

    // Distribuição por status
    drawSimpleTable({
      titulo: "Distribuição de pedidos por status",
      headers: ["Status", "Quantidade"],
      rows: linhasStatus.map((r) => [r.status, r.qtde]),
    });

    // Pedidos por canal de venda
    drawSimpleTable({
      titulo: "Pedidos por canal de venda",
      headers: ["Canal", "Quantidade"],
      rows: linhasCanal.map((r) => [r.canal, r.qtde]),
    });

    // Receita por mês
    drawSimpleTable({
      titulo: "Receita por mês (pedidos concluídos)",
      headers: ["Mês", "Receita"],
      rows: linhasReceitaMes.map((r) => [r.mes, fmtMoney(r.receita)]),
    });

    // Ticket médio por canal
    drawSimpleTable({
      titulo: "Ticket médio por canal",
      headers: ["Canal", "Ticket médio"],
      rows: linhasTicketCanal.map((r) => [
        r.canal,
        fmtMoney(r.ticket_medio),
      ]),
    });

    // Tempo médio de preparo por tipo
    drawSimpleTable({
      titulo: "Tempo médio de preparo por tipo de pedido",
      headers: ["Tipo", "Tempo médio"],
      rows: linhasTempo.map((r) => {
        const valor = Number(r.tempo_medio ?? 0);
        const tempoFmt = Number.isFinite(valor)
          ? `${valor.toFixed(1)} min`
          : "—";
        return [r.tipo, tempoFmt];
      }),
    });

    // Pedidos por hora do dia
    drawSimpleTable({
      titulo: "Pedidos por hora do dia",
      headers: ["Hora", "Quantidade"],
      rows: linhasHorario.map((r) => [
        `${String(r.hora).padStart(2, "0")}:00`,
        r.qtde,
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
        `Relatório gerado automaticamente pelo módulo de pedidos (admin) — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportPedidosAdminPdf:", err);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ erro: "Erro ao gerar PDF de pedidos (admin)." });
    }
    try {
      res.end();
    } catch (_) {}
  }
}
