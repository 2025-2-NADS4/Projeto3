import db from "../config/db.js";
import PDFDocument from "pdfkit";

// Função para calcular a diferença em dias entre hoje e a data da última compra
function diasEntre(hoje, data) {
  const ms = hoje.getTime() - data.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

//Função para classificar em categoria
function categoriaPorDias(dias) {
  if (dias == null) return "Sem compra";
  if (dias <= 30) return "Ativo (≤30d)";
  if (dias <= 60) return "Em risco (31–60d)";
  return "Perdido (>60d)";
}

// GET /api/estabelecimento/clientes-risco
export async function getClientesRiscoEstabelecimento(req, res) {
  try {
    const { establishment_id } = req.user;
    const hoje = new Date();

    // Nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [establishment_id]
    );
    const lojaNome = linhaLoja?.store_name || "(Loja sem nome)";

    // Última compra por cliente
    const [rows] = await db.execute(
      `
      SELECT 
        c.id   AS customerId,
        c.name AS customerName,
        o.companyId,
        MAX(o.createdAt) AS lastPurchase
      FROM \`order\` o
      JOIN customer c ON c.id = o.customer
      WHERE o.isTest = 0
        AND o.companyId = ?
      GROUP BY c.id, c.name, o.companyId
      `,
      [establishment_id]
    );

    // Monta base com dias sem compra e categoria
    const baseRows = rows
      .filter((r) => r.lastPurchase)
      .map((r) => {
        const last = new Date(r.lastPurchase);
        const dias = diasEntre(hoje, last);
        const bucket = categoriaPorDias(dias);
        return {
          customerId: r.customerId,
          customerName: r.customerName || `(Cliente ${r.customerId})`,
          companyId: r.companyId,
          storeName: lojaNome,
          lastPurchase: last.toISOString(),
          diasSemCompra: dias,
          categoria: bucket,
        };
      });

    const base = baseRows.length;

    // Contadores por categoria
    const counts = {
      "Ativo (≤30d)": 0,
      "Em risco (31–60d)": 0,
      "Perdido (>60d)": 0,
    };

    baseRows.forEach((r) => {
      if (counts[r.categoria] !== undefined) counts[r.categoria]++;
    });

    const pct = (v) => (base ? Math.round((v / base) * 100) : 0);

    const qtdAtivos = counts["Ativo (≤30d)"];
    const qtdRisco = counts["Em risco (31–60d)"];
    const qtdPerdidos = counts["Perdido (>60d)"];

    // Top 10 que estão há mais tempo sem comprar (qualquer categoria)
    const topInativos = [...baseRows]
      .sort((a, b) => b.diasSemCompra - a.diasSemCompra)
      .slice(0, 10)
      .map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        diasSemCompra: r.diasSemCompra,
        ultimaCompra: r.lastPurchase,
        loja: {
          id: r.companyId,
          nome: r.storeName,
        },
      }));

    // Histograma simples de faixas
    const histBins = { "≤30": 0, "31–60": 0, ">60": 0 };
    baseRows.forEach((r) => {
      const d = r.diasSemCompra;
      if (d <= 30) histBins["≤30"]++;
      else if (d <= 60) histBins["31–60"]++;
      else histBins[">60"]++;
    });
    const histDias = [
      { faixa: "≤30", qtd: histBins["≤30"] },
      { faixa: "31–60", qtd: histBins["31–60"] },
      { faixa: ">60", qtd: histBins[">60"] },
    ];

    // Tabela com todos os clientes (ativos, risco, perdidos)
    const listaCompleta = [...baseRows]
      .sort((a, b) => b.diasSemCompra - a.diasSemCompra)
      .map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        diasSemCompra: r.diasSemCompra,
        ultimaCompra: r.lastPurchase,
        categoria: r.categoria,
        loja: {
          id: r.companyId,
          nome: r.storeName,
        },
      }));

    // Resposta em Json
    res.json({
      kpis: {
        base_clientes: base,
        qtd_ativos: qtdAtivos,
        pct_ativos: pct(qtdAtivos),
        qtd_em_risco: qtdRisco,
        pct_em_risco: pct(qtdRisco),
        qtd_perdidos: qtdPerdidos,
        pct_perdidos: pct(qtdPerdidos),
      },
      graficos: {
        distribuicaoCategorias: {
          "Ativo (≤30d)": qtdAtivos,
          "Em risco (31–60d)": qtdRisco,
          "Perdido (>60d)": qtdPerdidos,
        },
        histDias,
        topInativos,
      },
      listaRisco: listaCompleta,
      meta: {
        loja: {
          id: establishment_id,
          nome: lojaNome,
        },
      },
    });
  } catch (err) {
    console.error("Erro em getClientesRiscoEstabelecimento:", err);
    res
      .status(500)
      .json({ erro: "Erro ao carregar clientes em risco (estabelecimento)." });
  }
}

// GET /api/admin/clientes-risco
export async function getClientesRiscoAdmin(req, res) {
  try {
    const { companyId } = req.query || {};
    const hoje = new Date();

    // Condição dinâmica no SQL
    const cond = ["o.isTest = 0"];
    const params = [];
    if (companyId) {
      cond.push("TRIM(o.companyId) = ?");
      params.push(companyId.trim());
    }
    const whereSql = `WHERE ${cond.join(" AND ")}`;

    // Última compra por cliente + nome da loja
    const [rows] = await db.execute(
      `
      SELECT 
        c.id AS customerId,
        c.name AS customerName,
        TRIM(o.companyId) AS companyId,
        TRIM(e.establishment_id) AS estId,
        e.store_name AS storeName,
        MAX(o.createdAt) AS lastPurchase
      FROM \`order\` o
      JOIN customer c ON c.id = o.customer
      LEFT JOIN estabelecimentos e ON TRIM(e.establishment_id) = TRIM(o.companyId)
      ${whereSql}
      GROUP BY c.id, c.name, o.companyId, e.store_name
      `,
      params
    );

    // Monta base
    let baseRows = rows
      .filter(r => r.lastPurchase)
      .map(r => {
        const last = new Date(r.lastPurchase);
        const dias = Math.floor((hoje - last) / (1000 * 60 * 60 * 24));
        const categoria =
          dias <= 30
            ? "Ativo (≤30d)"
            : dias <= 60
              ? "Em risco (31–60d)"
              : "Perdido (>60d)";
        return {
          customerId: r.customerId,
          customerName: r.customerName || `(Cliente ${r.customerId})`,
          companyId: (r.companyId || "").trim(),
          storeName: r.storeName || `(Loja ${r.companyId})`,
          lastPurchase: last.toISOString(),
          diasSemCompra: dias,
          categoria,
        };
      });

    if (companyId) {
      baseRows = baseRows.filter(
        r => (r.companyId || "").trim() === companyId.trim()
      );
    }

    const base = baseRows.length;

    // Contagem por categoria
    const counts = {
      "Ativo (≤30d)": 0,
      "Em risco (31–60d)": 0,
      "Perdido (>60d)": 0,
    };
    baseRows.forEach(r => {
      if (counts[r.categoria] !== undefined) counts[r.categoria]++;
    });

    const pct = v => (base ? Math.round((v / base) * 100) : 0);
    const qtdAtivos = counts["Ativo (≤30d)"];
    const qtdRisco = counts["Em risco (31–60d)"];
    const qtdPerdidos = counts["Perdido (>60d)"];

    // Top 10 de clientes em risco
    const topInativos = [...baseRows]
      .sort((a, b) => b.diasSemCompra - a.diasSemCompra)
      .slice(0, 10)
      .map(r => ({
        customerId: r.customerId,
        customerName: r.customerName,
        diasSemCompra: r.diasSemCompra,
        ultimaCompra: r.lastPurchase,
        loja: {
          id: r.companyId,
          nome: r.storeName,
        },
      }));

    // Lista de clientes em risco (31–60d)
    const clientesEmRisco = baseRows
      .filter(r => r.categoria === "Em risco (31–60d)")
      .sort((a, b) => b.diasSemCompra - a.diasSemCompra)
      .map(r => ({
        customerId: r.customerId,
        customerName: r.customerName,
        diasSemCompra: r.diasSemCompra,
        ultimaCompra: r.lastPurchase,
        loja: {
          id: r.companyId,
          nome: r.storeName,
        },
      }));

    // Histograma
    const histBins = { "≤30": 0, "31–60": 0, ">60": 0 };
    baseRows.forEach(r => {
      const d = r.diasSemCompra;
      if (d <= 30) histBins["≤30"]++;
      else if (d <= 60) histBins["31–60"]++;
      else histBins[">60"]++;
    });
    const histDias = [
      { faixa: "≤30", qtd: histBins["≤30"] },
      { faixa: "31–60", qtd: histBins["31–60"] },
      { faixa: ">60", qtd: histBins[">60"] },
    ];

    // Lojas disponíveis
    const [lojasRows] = await db.execute(`
      SELECT DISTINCT 
        TRIM(e.establishment_id) AS id,
        e.store_name AS nome
      FROM estabelecimentos e
      JOIN \`order\` o ON TRIM(o.companyId) = TRIM(e.establishment_id)
      WHERE o.isTest = 0
      ORDER BY e.store_name
    `);

    // Resposta em Json
    res.json({
      kpis: {
        base_clientes: base,
        qtd_ativos: qtdAtivos,
        pct_ativos: pct(qtdAtivos),
        qtd_em_risco: qtdRisco,
        pct_em_risco: pct(qtdRisco),
        qtd_perdidos: qtdPerdidos,
        pct_perdidos: pct(qtdPerdidos),
      },
      graficos: {
        distribuicaoCategorias: {
          "Ativo (≤30d)": qtdAtivos,
          "Em risco (31–60d)": qtdRisco,
          "Perdido (>60d)": qtdPerdidos,
        },
        histDias,
        topInativos,
      },
      listaRisco: clientesEmRisco,
      filtros: {
        lojas: lojasRows.map(l => ({
          id: l.id,
          nome: l.nome || `(Loja ${l.id})`,
        })),
      },
    });
  } catch (err) {
    console.error("Erro em getClientesRiscoAdmin:", err);
    res
      .status(500)
      .json({ erro: "Erro ao carregar clientes em risco (admin)." });
  }
}

// GET /api/estabelecimento/clientes-risco/export/pdf
export async function exportClientesRiscoEstabPdf(req, res) {
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
    const hoje = new Date();

    // Nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [establishment_id]
    );
    const lojaNome = linhaLoja?.store_name || "(Loja sem nome)";

    // Última compra por cliente
    const [rows] = await db.execute(
      `
      SELECT 
        c.id   AS customerId,
        c.name AS customerName,
        o.companyId,
        MAX(o.createdAt) AS lastPurchase
      FROM \`order\` o
      JOIN customer c ON c.id = o.customer
      WHERE o.isTest = 0
        AND o.companyId = ?
      GROUP BY c.id, c.name, o.companyId
      `,
      [establishment_id]
    );

    // Monta base com dias sem compra e categoria
    const baseRows = rows
      .filter((r) => r.lastPurchase)
      .map((r) => {
        const last = new Date(r.lastPurchase);
        const dias = diasEntre(hoje, last);
        const bucket = categoriaPorDias(dias);
        return {
          customerId: r.customerId,
          customerName: r.customerName || `(Cliente ${r.customerId})`,
          companyId: r.companyId,
          storeName: lojaNome,
          lastPurchase: last,
          diasSemCompra: dias,
          categoria: bucket,
        };
      });

    const base = baseRows.length;

    // Contadores por categoria
    const counts = {
      "Ativo (≤30d)": 0,
      "Em risco (31–60d)": 0,
      "Perdido (>60d)": 0,
    };

    baseRows.forEach((r) => {
      if (counts[r.categoria] !== undefined) counts[r.categoria]++;
    });

    const qtdAtivos = counts["Ativo (≤30d)"];
    const qtdRisco = counts["Em risco (31–60d)"];
    const qtdPerdidos = counts["Perdido (>60d)"];

    // Lista de quem está mais tempo sem comprar ordenada
    const listaOrdenada = [...baseRows].sort(
      (a, b) => b.diasSemCompra - a.diasSemCompra
    );

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Clientes_Risco_${lojaNome.replace(
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
        "Relatório de Clientes em Risco",
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
        `Análise baseada na data da última compra até: ${hoje.toLocaleDateString(
          "pt-BR"
        )}`,
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
      "Base de clientes com compra",
      base,
      "#ff7a00"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Ativos (<= 30 dias)",
      qtdAtivos,
      "#28a745"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Em risco (31–60 dias)",
      qtdRisco,
      "#ffc107"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Perdidos (>60 dias)",
      qtdPerdidos,
      "#dc3545"
    );

    doc.y = boxY + boxHeight + 40;

    // Título da tabela
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text(
        "Lista de clientes por tempo sem compra",
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
      doc.page.margins.left, // ID
      doc.page.margins.left + 60, // Nome
      doc.page.margins.left + 260, // Categoria
      doc.page.margins.left + 380, // Dias sem compra
      doc.page.margins.left + 460, // Última compra
    ];
    const colW = [50, 190, 110, 70, 100];
    const headers = ["ID", "Nome", "Categoria", "Dias", "Última compra"];

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

    for (const r of listaOrdenada) {
      const ultima = r.lastPurchase
        ? r.lastPurchase.toLocaleString("pt-BR")
        : "—";
      const dias = r.diasSemCompra ?? "—";

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
        .text(r.customerId, colX[0], y, { width: colW[0] })
        .text(r.customerName || "-", colX[1], y, { width: colW[1] })
        .text(r.categoria || "-", colX[2], y, { width: colW[2] })
        .text(String(dias), colX[3], y, { width: colW[3] })
        .text(ultima, colX[4], y, { width: colW[4] });

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
        `Relatório gerado automaticamente pelo módulo de Clientes em Risco — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportClientesRiscoEstabPdf:", err);
    res.status(500).json({
      erro: "Erro ao gerar PDF de clientes em risco.",
    });
  }
}

// GET /api/admin/clientes-risco/export/pdf
export async function exportClientesRiscoAdminPdf(req, res) {
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

    const { companyId } = req.query || {};
    const hoje = new Date();

    const cond = ["o.isTest = 0"];
    const params = [];
    if (companyId) {
      cond.push("TRIM(o.companyId) = ?");
      params.push(companyId.trim());
    }
    const whereSql = `WHERE ${cond.join(" AND ")}`;

    const [rows] = await db.execute(
      `
      SELECT 
        c.id AS customerId,
        c.name AS customerName,
        TRIM(o.companyId) AS companyId,
        TRIM(e.establishment_id) AS estId,
        e.store_name AS storeName,
        MAX(o.createdAt) AS lastPurchase
      FROM \`order\` o
      JOIN customer c ON c.id = o.customer
      LEFT JOIN estabelecimentos e ON TRIM(e.establishment_id) = TRIM(o.companyId)
      ${whereSql}
      GROUP BY c.id, c.name, o.companyId, e.store_name
      `,
      params
    );

    let baseRows = rows
      .filter((r) => r.lastPurchase)
      .map((r) => {
        const last = new Date(r.lastPurchase);
        const dias = Math.floor((hoje - last) / (1000 * 60 * 60 * 24));
        const categoria =
          dias <= 30
            ? "Ativo (<=30d)"
            : dias <= 60
            ? "Em risco (31–60d)"
            : "Perdido (>60d)";

        return {
          customerId: r.customerId,
          customerName: r.customerName || `(Cliente ${r.customerId})`,
          companyId: (r.companyId || "").trim(),
          storeName: r.storeName || `(Loja ${r.companyId})`,
          lastPurchase: last,
          diasSemCompra: dias,
          categoria,
        };
      });

    if (companyId) {
      baseRows = baseRows.filter(
        (r) => (r.companyId || "").trim() === companyId.trim()
      );
    }

    const base = baseRows.length;

    const counts = {
      "Ativo (<=30d)": 0,
      "Em risco (31–60d)": 0,
      "Perdido (>60d)": 0,
    };
    baseRows.forEach((r) => {
      if (counts[r.categoria] !== undefined) counts[r.categoria]++;
    });

    const pct = (v) => (base ? Math.round((v / base) * 100) : 0);
    const qtdAtivos = counts["Ativo (<=30d)"];
    const qtdRisco = counts["Em risco (31–60d)"];
    const qtdPerdidos = counts["Perdido (>60d)"];

    // Histograma (faixas)
    const histBins = { "<=30": 0, "31–60": 0, ">60": 0 };
    baseRows.forEach((r) => {
      const d = r.diasSemCompra;
      if (d <= 30) histBins["<=30"]++;
      else if (d <= 60) histBins["31–60"]++;
      else histBins[">60"]++;
    });
    const histDias = [
      { faixa: "<=30 dias", qtd: histBins["<=30"] },
      { faixa: "31–60 dias", qtd: histBins["31–60"] },
      { faixa: ">60 dias", qtd: histBins[">60"] },
    ];

    // Top 10 mais tempo sem comprar
    const topInativos = [...baseRows]
      .sort((a, b) => b.diasSemCompra - a.diasSemCompra)
      .slice(0, 10);

    // Lista completa de clientes em risco (31–60d)
    const clientesEmRisco = baseRows
      .filter((r) => r.categoria === "Em risco (31–60d)")
      .sort((a, b) => b.diasSemCompra - a.diasSemCompra);

    // Nome da loja (se estiver filtrando)
    let lojaNome = "Todas as lojas";
    if (companyId) {
      const [[loja]] = await db.execute(
        `SELECT store_name
           FROM estabelecimentos
          WHERE TRIM(establishment_id) = ?
          LIMIT 1`,
        [companyId.trim()]
      );
      lojaNome = loja?.store_name || `Loja ${companyId}`;
    }

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Clientes_Risco_Admin.pdf"`
    );

    doc.pipe(res);

    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const fmtPercent = (v) =>
      `${Number(v || 0).toFixed(0)}%`;

    // Helper de quebra de página
    const ensureSpace = (needed = 60) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
    };

    function drawTable({ titulo, headers, rows }) {
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

      rows.forEach((row, index) => {
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

    // Cabeçalho principal
    doc
      .fontSize(20)
      .fillColor("#ff7a00")
      .text(
        "Relatório de Clientes em Risco (Admin)",
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
      .moveDown(0.2)
      .fontSize(10)
      .fillColor("gray")
      .text(
        "Dias sem compra calculados até a data de geração deste relatório.",
        doc.page.margins.left,
        undefined,
        {
          align: "center",
          width: contentWidth,
        }
      )
      .moveDown(1);

    // Cards
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
      "Base de clientes analisados",
      base,
      "",
      "#ff7a00"
    );
    drawKpi(
      baseX + (boxWidth + boxGap),
      "Ativos (<=30 dias)",
      qtdAtivos,
      fmtPercent(pct(qtdAtivos)),
      "#28a745"
    );
    drawKpi(
      baseX + (boxWidth + boxGap) * 2,
      "Em risco (31–60 dias)",
      qtdRisco,
      fmtPercent(pct(qtdRisco)),
      "#ffc107"
    );
    drawKpi(
      baseX + (boxWidth + boxGap) * 3,
      "Perdidos (>60 dias)",
      qtdPerdidos,
      fmtPercent(pct(qtdPerdidos)),
      "#dc3545"
    );

    doc.y = boxY + boxHeight + 35;

    // Tabelas 
    // Distribuição por categoria
    drawTable({
      titulo: "Distribuição de clientes por categoria",
      headers: ["Categoria", "Quantidade", "% da base"],
      rows: [
        [
          "Ativo (<=30d)",
          qtdAtivos,
          fmtPercent(pct(qtdAtivos)),
        ],
        [
          "Em risco (31–60d)",
          qtdRisco,
          fmtPercent(pct(qtdRisco)),
        ],
        [
          "Perdido (>60d)",
          qtdPerdidos,
          fmtPercent(pct(qtdPerdidos)),
        ],
      ],
    });

    // Resumo por faixa de dias sem compra (histograma)
    drawTable({
      titulo: "Resumo por faixa de dias sem compra",
      headers: ["Faixa", "Quantidade"],
      rows: histDias.map((h) => [h.faixa, h.qtd]),
    });

    // Top 10 mais tempo sem comprar
    drawTable({
      titulo: "Top 10 clientes com maior tempo sem comprar",
      headers: ["Cliente", "Loja", "Dias sem compra", "Última compra"],
      rows: topInativos.map((c) => [
        c.customerName,
        c.storeName,
        c.diasSemCompra,
        c.lastPurchase
          ? c.lastPurchase.toLocaleDateString("pt-BR")
          : "—",
      ]),
    });

    // Lista completa de clientes em risco (31–60d)
    drawTable({
      titulo: "Lista de clientes em risco (31–60 dias)",
      headers: ["Cliente", "Loja", "Dias sem compra", "Última compra"],
      rows: clientesEmRisco.map((c) => [
        c.customerName,
        c.storeName,
        c.diasSemCompra,
        c.lastPurchase
          ? c.lastPurchase.toLocaleDateString("pt-BR")
          : "—",
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
        `Relatório gerado automaticamente pelo módulo de clientes em risco (admin) — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportClientesRiscoAdmin:", err);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ erro: "Erro ao gerar PDF de clientes em risco (admin)." });
    }
    try {
      res.end();
    } catch (_) {}
  }
}
