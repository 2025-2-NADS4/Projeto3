import db from "../config/db.js";
import PDFDocument from "pdfkit";

function montarWhere({ lojaId, mesInicio, mesFim, somenteEnviadas = false }) {
  const condicoes = [];
  const parametros = [];

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

  if (somenteEnviadas) {
    condicoes.push("sendAt IS NOT NULL AND TRIM(sendAt) <> '' AND sendAt <> '0000-00-00 00:00:00' ");
  }

  const clausula =
    condicoes.length > 0 ? `WHERE (${condicoes.join(") AND (")})` : "";

  return { clausula, parametros };
}

// GET /api/estabelecimento/campaignqueue
export const getCampaignQueueEstabelecimento = async (req, res) => {
  try {
    const usuario = req.user;
    if (!usuario)
      return res.status(401).json({ erro: "Usuário não autenticado!" });

    const perfil = String(usuario.perfil || "").toLowerCase();
    if (perfil !== "estabelecimento") {
      return res.status(403).json({
        erro: "Acesso negado! Apenas estabelecimentos podem acessar.",
      });
    }

    const lojaId = usuario.establishment_id;
    const { mesInicio, mesFim } = req.query;

    const { clausula, parametros } = montarWhere({
      lojaId,
      mesInicio,
      mesFim,
      somenteEnviadas: true,
    });

    // KPI total
    const [[kpiTotal]] = await db.execute(
      `SELECT COUNT(*) AS total 
         FROM campaign_queue 
        ${clausula}`,
      parametros
    );

    // Contagem por status
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
    const bucket = { lida: 0, enviada: 0, pendente: 0, erro: 0, outros: 0 };

    rowsStatus.forEach((r) => {
      const s = (r.status_desc || "").toLowerCase();

      if (s.includes("lida") || s.includes("read") || s.includes("visualizad")) {
        bucket.lida += r.qtd;
      } else if (s.includes("env") || s.includes("sent") || s.includes("dispar")) {
        bucket.enviada += r.qtd;
      } else if (s.includes("erro") || s.includes("fail") || s.includes("falha")) {
        bucket.erro += r.qtd;
      } else if (s.includes("pend") || s.includes("queue") || s.includes("aguard")) {
        bucket.pendente += r.qtd;
      } else {
        bucket.outros += r.qtd;
      }
    });

    const baseLeitura = bucket.lida + bucket.enviada + bucket.pendente;
    const taxaLeitura = baseLeitura
      ? Math.round((bucket.lida / baseLeitura) * 100)
      : 0;

    // Gráfico por mês (somente enviadas)
    const [rowsMes] = await db.execute(
      `SELECT _mes AS mes, COUNT(*) AS qtd
         FROM campaign_queue
        ${clausula}
        GROUP BY mes
        ORDER BY mes ASC`,
      parametros
    );

    // Meses disponíveis
    const [mesesTodos] = await db.execute(
      `SELECT DISTINCT _mes AS mes
         FROM campaign_queue
        WHERE storeId = ?
          AND sendAt IS NOT NULL
        ORDER BY mes ASC`,
      [lojaId]
    );

    const [rowsStores] = await db.execute(
      `SELECT storeId,
              SUM(CASE WHEN LOWER(status_desc) LIKE '%lida%' 
                         OR LOWER(status_desc) LIKE '%read%' THEN 1 ELSE 0 END) AS lidas,
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

    // Nome da loja
    const [[lojaNome]] = await db.execute(
      `SELECT store_name 
         FROM estabelecimentos 
        WHERE establishment_id = ? 
        LIMIT 1`,
      [lojaId]
    );

    return res.json({
      meta: { lojaId, lojaNome: lojaNome?.store_name || "Estabelecimento" },
      kpis: {
        total: Number(kpiTotal.total || 0),
        taxaLeitura,
        lidas: bucket.lida,
        enviadas: bucket.enviada,
        erros: bucket.erro,
        pendentes: bucket.pendente,
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
        mesesDisponiveis: mesesTodos.map((r) => r.mes),
      },
    });
  } catch (erro) {
    console.error("Erro em getCampaignQueueEstabelecimento:", erro);
    return res
      .status(500)
      .json({ erro: "Erro interno ao carregar CampaignQueue." });
  }
};

// GET /api/admin/campaignqueue
export const getCampaignQueueAdmin = async (req, res) => {
  try {
    const usuario = req.user;
    if (!usuario)
      return res.status(401).json({ erro: "Usuário não autenticado!" });

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

    const { clausula, parametros } = montarWhere({
      lojaId,
      mesInicio,
      mesFim,
      somenteEnviadas: true,
    });

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

    const bucket = { lida: 0, enviada: 0, pendente: 0, erro: 0, outros: 0 };

    rowsStatus.forEach((r) => {
      const s = (r.status_desc || "").toLowerCase();

      if (s.includes("lida") || s.includes("read") || s.includes("visualizad")) {
        bucket.lida += r.qtd;
      } else if (s.includes("env") || s.includes("sent") || s.includes("dispar")) {
        bucket.enviada += r.qtd;
      } else if (s.includes("erro") || s.includes("fail") || s.includes("falha")) {
        bucket.erro += r.qtd;
      } else if (s.includes("pend") || s.includes("queue") || s.includes("aguard")) {
        bucket.pendente += r.qtd;
      } else {
        bucket.outros += r.qtd;
      }
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

    // Meses disponíveis
    const [mesesTodos] = await db.execute(
      `SELECT DISTINCT _mes AS mes
         FROM campaign_queue
        WHERE sendAt IS NOT NULL
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

    const [lojas] = await db.execute(
      `SELECT DISTINCT e.store_name
         FROM campaign_queue c
         JOIN estabelecimentos e ON e.establishment_id = c.storeId
        WHERE c.sendAt IS NOT NULL
        ORDER BY e.store_name`
    );

    return res.json({
      meta: { lojaId: lojaId || null, storeName: storeName || null },
      kpis: {
        total: Number(kpiTotal.total || 0),
        taxaLeitura,
        lidas: bucket.lida,
        enviadas: bucket.enviada,
        erros: bucket.erro,
        pendentes: bucket.pendente,
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
    return res
      .status(500)
      .json({ erro: "Erro interno ao carregar CampaignQueue (admin)." });
  }
};

// GET /api/estabelecimento/campaignqueue/export/pdf
export async function exportCampaignQueueEstabPdf(req, res) {
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

    const lojaId = usuario.establishment_id;
    const { mesInicio, mesFim } = req.query;

    const { clausula, parametros } = montarWhere({
      lojaId,
      mesInicio,
      mesFim,
      somenteEnviadas: true,
    });

    // Nome da loja
    const [[lojaRow]] = await db.execute(
      `SELECT store_name 
         FROM estabelecimentos 
        WHERE establishment_id = ? 
        LIMIT 1`,
      [lojaId]
    );
    const lojaNome = lojaRow?.store_name || "Estabelecimento";

    // KPIs
    const [[kpiTotal]] = await db.execute(
      `SELECT COUNT(*) AS total 
         FROM campaign_queue 
        ${clausula}`,
      parametros
    );
    const total = Number(kpiTotal.total || 0);

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

    // Buckets: lidas, enviadas, erro
    const bucket = { lida: 0, enviada: 0, erro: 0, outros: 0 };
    rowsStatus.forEach((r) => {
      const s = (r.status_desc || "").toLowerCase();

      if (
        s.includes("erro") ||
        s.includes("error") ||
        s.includes("falha") ||
        s.includes("fail")
      ) {
        bucket.erro += r.qtd;
      } else if (
        s.includes("lida") ||
        s.includes("read") ||
        s.includes("visualizad")
      ) {
        bucket.lida += r.qtd;
      } else if (
        s.includes("env") ||
        s.includes("sent") ||
        s.includes("dispar")
      ) {
        bucket.enviada += r.qtd;
      } else {
        bucket.outros += r.qtd;
      }
    });

    const baseLeitura = bucket.lida + bucket.enviada;
    const taxaLeitura = baseLeitura
      ? Math.round((bucket.lida / baseLeitura) * 100)
      : 0;

    const [rowsDetalhe] = await db.execute(
      `SELECT 
          id,
          campaignId,
          phoneNumber,
          status_desc,
          sendAt AS enviado_em
       FROM campaign_queue
       ${clausula}
       ORDER BY id DESC`,
      parametros
    );

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Engajamento_${lojaNome.replace(
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
        "Relatório de Engajamento das Mensagens",
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

    drawKpiBox(
      baseX,
      "Total de mensagens enviadas",
      total,
      "#ff7a00"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Mensagens lidas",
      bucket.lida,
      "#28a745"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Mensagens com erro",
      bucket.erro,
      "#dc3545"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Taxa de leitura",
      `${taxaLeitura}%`,
      "#007bff"
    );

    doc.y = boxY + boxHeight + 40;

    // Título da tabela
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text(
        "Detalhamento das mensagens enviadas",
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
      doc.page.margins.left,
      doc.page.margins.left + 60,
      doc.page.margins.left + 140,
      doc.page.margins.left + 280,
      doc.page.margins.left + 430,
    ];
    const colW = [50, 70, 120, 130, 120];
    const headers = ["ID", "Campanha", "Telefone", "Status", "Enviado em"];

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
      const envio = r.enviado_em || "—";

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
        .text(r.campaignId || "-", colX[1], y, { width: colW[1] })
        .text(r.phoneNumber || "-", colX[2], y, { width: colW[2] })
        .text(r.status_desc || "-", colX[3], y, { width: colW[3] })
        .text(envio, colX[4], y, { width: colW[4] });

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
        `Relatório gerado automaticamente pelo módulo de Engajamento — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (erro) {
    console.error("Erro em exportCampaignQueueEstabPdf:", erro);
    return res.status(500).json({
      erro: "Erro ao gerar PDF de engajamento de mensagens.",
    });
  }
}