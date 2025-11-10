import db from "../config/db.js";
import PDFDocument from "pdfkit";

// Função para calcular faixaEtaria
function faixaEtaria(idade) {
  if (idade < 18) return "<18";
  if (idade <= 24) return "18-24";
  if (idade <= 34) return "25-34";
  if (idade <= 44) return "35-44";
  return "45+";
}

// Função para calcular idade a partir da data de nascimento
function calcularIdade(dataNasc) {
  if (!dataNasc) return null;
  const nasc = new Date(dataNasc);
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

// Normaliza o dia da semana do MySQL (1=Dom, 2=Seg...7=Sáb)
function normalizarDiaSemana(mysqlDow) {
  return mysqlDow === 1 ? 7 : mysqlDow - 1;
}

const isAtivo = (s) => /\bativo\b/i.test(s || "");

// GET /api/estabelecimento/clientes
export async function getClientesEstabelecimento(req, res) {
  try {
    const { establishment_id } = req.user;
    const { mesInicio, mesFim, status: statusFiltro } = req.query;

    // Base de clientes
    const [clientes] = await db.execute(
      `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
       FROM customer
       WHERE companyId = ?`,
      [establishment_id]
    );

    // Pega o nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [establishment_id]
    );
    const lojaNome = linhaLoja?.store_name || "(Loja sem nome)";

    // Filtro de período
    const start = mesInicio ? new Date(`${mesInicio}-01`) : null;
    const end = mesFim ? new Date(`${mesFim}-01`) : null;

    // Filtro principal (período + status, caso seja informado)
    const filtered = clientes.filter((c) => {
      const d = new Date(c.createdAt);
      if (start && d < start) return false;
      if (end && d >= end) return false;

      // Filtro por status: "ativos" / "inativos" / (vazio = todos)
      if (statusFiltro === "ativos" && !isAtivo(c.status_desc)) return false;
      if (statusFiltro === "inativos" && isAtivo(c.status_desc)) return false;

      return true;
    });

    // KPIs
    const total = filtered.length;
    const ativos = filtered.filter((c) => isAtivo(c.status_desc)).length;
    const inativos = total - ativos;
    const pctAtivos = total ? Math.round((ativos / total) * 100) : 0;

    // Taxa de recompra (clientes com mais de 1 pedido)
    const [pedidos] = await db.execute(
      `SELECT customer, COUNT(*) AS qtd
       FROM \`order\`
       WHERE companyId = ?
       GROUP BY customer`,
      [establishment_id]
    );
    const clientesComMaisDe1Pedido = pedidos.filter((p) => p.qtd > 1).length;
    const taxaRecompra = total
      ? Math.round((clientesComMaisDe1Pedido / total) * 100)
      : 0;

    // Gráficos
    const status = {};
    const genero = {};
    const faixas = {};
    const aniversariantes = [];

    const mesAtual = new Date().getMonth();

    for (const c of filtered) {
      const s = c.status_desc || "Não informado";
      const g = c.gender_clean || "Não informado";
      const idade = calcularIdade(c.dateOfBirth);
      const f = faixaEtaria(idade);

      status[s] = (status[s] || 0) + 1;
      genero[g] = (genero[g] || 0) + 1;
      faixas[f] = (faixas[f] || 0) + 1;

      // Aniversariante do mês
      if (c.dateOfBirth) {
        const nasc = new Date(c.dateOfBirth);
        if (nasc.getMonth() === mesAtual) aniversariantes.push(c.name);
      }
    }

    // Heatmap de horários (7x24: dia x hora)
    const [heatRows] = await db.execute(
      `SELECT DAYOFWEEK(createdAt) AS dow, HOUR(createdAt) AS hora, COUNT(*) AS qtd
       FROM \`order\`
       WHERE companyId = ?
       GROUP BY dow, hora
       ORDER BY dow, hora`,
      [establishment_id]
    );

    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of heatRows) {
      const dia = normalizarDiaSemana(r.dow) - 1;
      heatmap[dia][r.hora] = Number(r.qtd);
    }

    // Meses disponíveis para o filtro
    const [mesesRows] = await db.execute(
      `SELECT DISTINCT DATE_FORMAT(createdAt,'%Y-%m') AS ym
         FROM customer
        WHERE companyId = ?
        ORDER BY ym`,
      [establishment_id]
    );
    const mesesDisponiveis = mesesRows.map((r) => r.ym);

    res.json({
      kpis: { total, ativos, inativos, pctAtivos, taxaRecompra },
      graficos: { status, genero, faixas },
      heatmap,
      aniversariantes: aniversariantes.slice(0, 10),
      meta: { loja: { id: establishment_id, nome: lojaNome } },
      filtros: { mesesDisponiveis },
    });
  } catch (err) {
    console.error("Erro em getClientesEstabelecimento:", err);
    res
      .status(500)
      .json({ erro: "Erro ao carregar dados de clientes (estab)." });
  }
}

// GET /api/admin/clientes
export async function getClientesAdmin(req, res) {
  try {
    let { mesInicio, mesFim, companyId, storeName } = req.query;

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
        storeName = loja.store_name;
      }
    }

    // Base de clientes
    let clientes;
    if (companyId) {
      [clientes] = await db.execute(
        `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
           FROM customer
          WHERE companyId = ?`,
        [companyId]
      );
    } else {
      [clientes] = await db.execute(
        `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
           FROM customer`
      );
    }

    // Filtros auxiliares para o site
    const [distinctStores] = await db.execute(`
      SELECT DISTINCT c.companyId, e.store_name
        FROM customer c
        LEFT JOIN estabelecimentos e
               ON e.establishment_id = c.companyId
       WHERE c.companyId IS NOT NULL
       ORDER BY e.store_name, c.companyId
    `);

    const lojas = distinctStores.map((s) => ({
      id: s.companyId,
      nome: s.store_name || s.companyId,
    }));

    // Pega meses únicos da base
    const [distinctMonths] = await db.execute(`
      SELECT DISTINCT DATE_FORMAT(createdAt, '%Y-%m') AS mes
        FROM customer
       ORDER BY mes ASC
    `);

    // Filtro de período
    // Função para adicionar 1 mês a 'YYYY-MM'
    function proximoMes(yyyymm) {
      const [ano, mes] = (yyyymm || "").split("-").map(Number);
      if (!ano || !mes) return null;
      const d = new Date(ano, mes - 1, 1);
      d.setMonth(d.getMonth() + 1);
      return d;
    }

    const inicio = mesInicio ? new Date(`${mesInicio}-01`) : null;
    const fimExclusivo = mesFim ? proximoMes(mesFim) : null;

    // Filtro inclusivo pelo intervalo [inicio, fimExclusivo)
    const filtrados = clientes.filter((c) => {
      const d = new Date(c.createdAt);
      if (inicio && d < inicio) return false;
      if (fimExclusivo && d >= fimExclusivo) return false;
      return true;
    });

    // KPI
    const total = filtrados.length;
    const isAtivo = (s) => /\bativo\b/i.test(s || "");
    const ativos = filtrados.filter((c) => isAtivo(c.status_desc)).length;
    const inativos = total - ativos;
    const pctAtivos = total ? Math.round((ativos / total) * 100) : 0;

    // Taxa de recompra
    let pedidos;
    if (companyId) {
      [pedidos] = await db.execute(
        `SELECT customer, COUNT(*) AS qtd
           FROM \`order\`
          WHERE companyId = ?
          GROUP BY customer`,
        [companyId]
      );
    } else {
      [pedidos] = await db.execute(
        `SELECT customer, COUNT(*) AS qtd
           FROM \`order\`
          GROUP BY customer`
      );
    }

    const clientesComMaisDe1Pedido = pedidos.filter((p) => p.qtd > 1).length;
    const taxaRecompra = total
      ? Math.round((clientesComMaisDe1Pedido / total) * 100)
      : 0;

    // Gráficos
    const status = {};
    const genero = {};
    const faixas = {};
    const aniversariantes = [];
    const mesAtual = new Date().getMonth();

    for (const c of filtrados) {
      const s = c.status_desc || "Não informado";
      const g = c.gender_clean || "Não informado";
      const idade = calcularIdade(c.dateOfBirth);
      const f = faixaEtaria(idade);

      status[s] = (status[s] || 0) + 1;
      genero[g] = (genero[g] || 0) + 1;
      faixas[f] = (faixas[f] || 0) + 1;

      if (c.dateOfBirth) {
        const nasc = new Date(c.dateOfBirth);
        if (nasc.getMonth() === mesAtual) aniversariantes.push(c.name);
      }
    }

    // Heatmap 7x24 de pedidos (por dia da semana x hora)
    let heatRows;
    if (companyId) {
      [heatRows] = await db.execute(
        `SELECT DAYOFWEEK(createdAt) AS dow, HOUR(createdAt) AS hora, COUNT(*) AS qtd
           FROM \`order\`
          WHERE companyId = ?
          GROUP BY dow, hora
          ORDER BY dow, hora`,
        [companyId]
      );
    } else {
      [heatRows] = await db.execute(
        `SELECT DAYOFWEEK(createdAt) AS dow, HOUR(createdAt) AS hora, COUNT(*) AS qtd
           FROM \`order\`
          GROUP BY dow, hora
          ORDER BY dow, hora`
      );
    }

    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of heatRows) {
      const dia = r.dow === 1 ? 6 : r.dow - 2; // deixa Seg=0 ... Dom=6
      if (dia >= 0 && dia < 7 && r.hora >= 0 && r.hora < 24) {
        heatmap[dia][r.hora] = Number(r.qtd);
      }
    }

    // Loja atual (para meta)
    const lojaAtual =
      companyId &&
      (lojas.find((l) => String(l.id) === String(companyId)) || {
        id: companyId,
        nome: storeName || String(companyId),
      });

    // Resposta em Json
    res.json({
      kpis: { total, ativos, inativos, pctAtivos, taxaRecompra },
      graficos: { status, genero, faixas },
      heatmap,
      aniversariantes: aniversariantes.slice(0, 10),
      meta: {
        loja: lojaAtual || { id: null, nome: "Todas as lojas" },
        lojas,
      },
      filtros: {
        mesesDisponiveis: distinctMonths.map((m) => m.mes),
      },
    });
  } catch (err) {
    console.error("Erro em getClientesAdmin:", err);
    res.status(500).json({ erro: "Erro ao carregar dados de clientes (admin)." });
  }
}

// GET /api/estabelecimento/clientes/export/pdf
export async function exportClientesEstabPdf(req, res) {
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
    const { mesInicio, mesFim, status: statusFiltro } = req.query;

    // Carrega base de clientes
    const [clientes] = await db.execute(
      `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
         FROM customer
        WHERE companyId = ?`,
      [lojaId]
    );

    // Nome da loja
    const [[linhaLoja]] = await db.execute(
      `SELECT store_name
         FROM estabelecimentos
        WHERE establishment_id = ?
        LIMIT 1`,
      [lojaId]
    );
    const lojaNome = linhaLoja?.store_name || "(Loja sem nome)";

    // Filtros de período e status
    const start = mesInicio ? new Date(`${mesInicio}-01`) : null;
    const end = mesFim ? new Date(`${mesFim}-01`) : null;

    const filtrados = clientes.filter((c) => {
      const d = c.createdAt ? new Date(c.createdAt) : null;

      if (start && d && d < start) return false;
      if (end && d && d >= end) return false;

      if (statusFiltro === "ativos" && !isAtivo(c.status_desc)) return false;
      if (statusFiltro === "inativos" && isAtivo(c.status_desc)) return false;

      return true;
    });

    // KPIs
    const total = filtrados.length;
    const ativos = filtrados.filter((c) => isAtivo(c.status_desc)).length;
    const inativos = total - ativos;
    const pctAtivos = total ? Math.round((ativos / total) * 100) : 0;

    // Taxa de recompra (clientes com mais de 1 pedido)
    const [pedidos] = await db.execute(
      `SELECT customer, COUNT(*) AS qtd
         FROM \`order\`
        WHERE companyId = ?
        GROUP BY customer`,
      [lojaId]
    );
    const clientesComMaisDe1Pedido = pedidos.filter((p) => p.qtd > 1).length;
    const taxaRecompra = total
      ? Math.round((clientesComMaisDe1Pedido / total) * 100)
      : 0;

    // Detalhamento
    const detalhes = filtrados.map((c) => {
      const idade = calcularIdade(c.dateOfBirth);
      const faixa = faixaEtaria(idade);
      return { ...c, idade, faixa };
    });

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Clientes_${lojaNome.replace(
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
        "Relatório de Clientes",
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
    let legendaStatus = "todos os clientes";
    if (statusFiltro === "ativos") legendaStatus = "apenas clientes ativos";
    if (statusFiltro === "inativos") legendaStatus = "apenas clientes inativos";

    doc
      .fontSize(12)
      .fillColor("#000")
      .text(
        `Período analisado: ${mesInicio || "início"} até ${mesFim || "atual"} (filtro de status: ${legendaStatus})`,
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
      "Total de clientes",
      total,
      "#ff7a00"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Clientes ativos",
      `${ativos} (${pctAtivos}%)`,
      "#28a745"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Clientes inativos",
      inativos,
      "#6c757d"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Taxa de recompra",
      `${taxaRecompra}%`,
      "#007bff"
    );

    doc.y = boxY + boxHeight + 40;

    // Título da tabela
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text(
        "Detalhamento dos clientes",
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
      doc.page.margins.left + 60,  // Nome
      doc.page.margins.left + 240, // Status
      doc.page.margins.left + 360, // Gênero
      doc.page.margins.left + 440, // Cadastro em
    ];
    const colW = [50, 170, 110, 70, 110];
    const headers = ["ID", "Nome", "Status", "Gênero", "Cadastro em"];

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

    for (const c of detalhes) {
      const genero = c.gender_clean || "Não informado";
      const cadastro = c.createdAt
        ? new Date(c.createdAt).toLocaleString("pt-BR")
        : "—";

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
        .text(c.id, colX[0], y, { width: colW[0] })
        .text(c.name || "-", colX[1], y, { width: colW[1] })
        .text(c.status_desc || "-", colX[2], y, { width: colW[2] })
        .text(genero, colX[3], y, { width: colW[3] })
        .text(cadastro, colX[4], y, { width: colW[4] });

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
        `Relatório gerado automaticamente pelo módulo de Clientes — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportClientesEstabPdf:", err);
    res
      .status(500)
      .json({ erro: "Erro ao gerar PDF de clientes (estab)." });
  }
}

// GET /api/admin/clientes/export/pdf
export async function exportClientesAdminPdf(req, res) {
  try {
    const { mesInicio, mesFim, companyId: companyIdQuery, storeName } = req.query;

    let companyId = companyIdQuery;

    // Se vier apenas storeName, buscamos o establishment_id
    let lojaNome = storeName || "Todas as lojas";
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
        lojaNome = loja.store_name || lojaNome;
      }
    }

    const calcularIdade = (dateStr) => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return null;
      const hoje = new Date();
      let idade = hoje.getFullYear() - d.getFullYear();
      const m = hoje.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) idade--;
      return idade;
    };

    const faixaEtaria = (idade) => {
      if (idade == null || Number.isNaN(idade)) return "Não informado";
      if (idade < 18) return "<18";
      if (idade <= 24) return "18-24";
      if (idade <= 34) return "25-34";
      if (idade <= 44) return "35-44";
      if (idade <= 54) return "45-54";
      if (idade <= 64) return "55-64";
      return "65+";
    };

    // Base de clientes
    let clientes;
    if (companyId) {
      [clientes] = await db.execute(
        `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
           FROM customer
          WHERE companyId = ?`,
        [companyId]
      );
    } else {
      [clientes] = await db.execute(
        `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
           FROM customer`
      );
    }

    function proximoMes(yyyymm) {
      const [ano, mes] = (yyyymm || "").split("-").map(Number);
      if (!ano || !mes) return null;
      const d = new Date(ano, mes - 1, 1);
      d.setMonth(d.getMonth() + 1);
      return d;
    }

    const inicio = mesInicio ? new Date(`${mesInicio}-01`) : null;
    const fimExclusivo = mesFim ? proximoMes(mesFim) : null;

    const clientesFiltrados = clientes.filter((c) => {
      const d = new Date(c.createdAt);
      if (inicio && d < inicio) return false;
      if (fimExclusivo && d >= fimExclusivo) return false;
      return true;
    });

    // KPIs
    const total = clientesFiltrados.length;
    const isAtivo = (s) => /\bativo\b/i.test(s || "");
    const ativos = clientesFiltrados.filter((c) => isAtivo(c.status_desc)).length;
    const inativos = total - ativos;
    const pctAtivos = total ? Math.round((ativos / total) * 100) : 0;

    // Pedidos para taxa de recompra
    let pedidos;
    if (companyId) {
      [pedidos] = await db.execute(
        `SELECT customer, COUNT(*) AS qtd
           FROM \`order\`
          WHERE companyId = ?
          GROUP BY customer`,
        [companyId]
      );
    } else {
      [pedidos] = await db.execute(
        `SELECT customer, COUNT(*) AS qtd
           FROM \`order\`
          GROUP BY customer`
      );
    }

    const clientesComMaisDe1Pedido = pedidos.filter((p) => p.qtd > 1).length;
    const taxaRecompra = total
      ? Math.round((clientesComMaisDe1Pedido / total) * 100)
      : 0;

    // Montagem de agregados (status, gênero, faixa, aniversariantes)
    const statusAgg = {};
    const generoAgg = {};
    const faixasAgg = {};
    const aniversariantes = [];
    const mesAtual = new Date().getMonth();

    for (const c of clientesFiltrados) {
      const s = c.status_desc || "Não informado";
      const g = c.gender_clean || "Não informado";
      const idade = calcularIdade(c.dateOfBirth);
      const f = faixaEtaria(idade);

      statusAgg[s] = (statusAgg[s] || 0) + 1;
      generoAgg[g] = (generoAgg[g] || 0) + 1;
      faixasAgg[f] = (faixasAgg[f] || 0) + 1;

      if (c.dateOfBirth) {
        const nasc = new Date(c.dateOfBirth);
        if (nasc.getMonth() === mesAtual) aniversariantes.push(c.name);
      }
    }

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Clientes_Admin.pdf"`
    );
    doc.pipe(res);

    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Cabeçalho
    doc
      .fontSize(20)
      .fillColor("#ff7a00")
      .text("Relatório de Clientes (Admin)", doc.page.margins.left, undefined, {
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
        { align: "center", width: contentWidth }
      )
      .moveDown(0.6)
      .fontSize(11)
      .fillColor("#000")
      .text(
        `Período analisado: ${mesInicio || "início"} até ${
          mesFim || "atual"
        }`,
        doc.page.margins.left,
        undefined,
        { align: "center", width: contentWidth }
      )
      .moveDown(1);

    // Resumo geral (cards)
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text("Resumo geral", doc.page.margins.left, undefined, {
        width: contentWidth,
        underline: true,
      })
      .moveDown(0.5);

    const baseX = doc.page.margins.left;
    const boxGap = 10;
    const boxWidth = (contentWidth - boxGap * 3) / 4;
    const boxHeight = 60;
    const boxY = doc.y;

    const drawKpiBox = (x, titulo, valor, hint) => {
      doc
        .rect(x, boxY, boxWidth, boxHeight)
        .strokeColor("#ff7a00")
        .lineWidth(1.2)
        .stroke();

      doc
        .fontSize(10)
        .fillColor("gray")
        .text(titulo, x + 6, boxY + 6, {
          width: boxWidth - 12,
          align: "center",
        });

      doc
        .fontSize(18)
        .fillColor("#ff7a00")
        .text(String(valor), x + 6, boxY + 22, {
          width: boxWidth - 12,
          align: "center",
        });

      if (hint) {
        doc
          .fontSize(9)
          .fillColor("gray")
          .text(hint, x + 6, boxY + 42, {
            width: boxWidth - 12,
            align: "center",
          });
      }
    };

    drawKpiBox(baseX, "Total de clientes", total, "");
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Clientes ativos",
      ativos,
      `${pctAtivos}% da base`
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Clientes inativos",
      inativos,
      ""
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Taxa de recompra",
      `${taxaRecompra}%`,
      "Clientes com +1 pedido"
    );

    doc.y = boxY + boxHeight + 30;

    // Distribuição de clientes
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text("Distribuição de clientes", doc.page.margins.left, undefined, {
        align: "center",
        width: contentWidth,
        underline: true,
      })
      .moveDown(0.5);

    const colCount = 3;
    const colGap = 10;
    const colWidth = (contentWidth - colGap * (colCount - 1)) / colCount;
    const startY = doc.y;

    const drawTable = (x, titulo, rows) => {
      const headerHeight = 18;
      const rowHeight = 14;

      // Título da coluna
      doc
        .fontSize(11)
        .fillColor("#000")
        .text(titulo, x, startY, {
          width: colWidth,
          align: "center",
        });

      let y = startY + 22;

      // Cabeçalho
      doc
        .rect(x, y - 3, colWidth, headerHeight)
        .fill("#ff7a00");
      doc
        .fontSize(9)
        .fillColor("#fff")
        .text("Categoria", x + 4, y, {
          width: colWidth / 2 - 6,
        })
        .text("Qtde", x + colWidth / 2, y, {
          width: colWidth / 2 - 6,
        });

      y += headerHeight + 2;
      doc.fillColor("#000");

      rows.forEach((r, idx) => {
        const alt = idx % 2 === 0 ? "#ffffff" : "#f5f5f5";
        doc.rect(x, y - 2, colWidth, rowHeight).fill(alt);

        doc
          .fontSize(9)
          .fillColor("#000")
          .text(r.label, x + 4, y, { width: colWidth / 2 - 6 })
          .text(String(r.value), x + colWidth / 2, y, {
            width: colWidth / 2 - 6,
          });

        y += rowHeight;
      });

      return y;
    };

    const statusRows = Object.entries(statusAgg).map(([label, value]) => ({
      label,
      value,
    }));
    const generoRows = Object.entries(generoAgg).map(([label, value]) => ({
      label,
      value,
    }));
    const faixaRows = Object.entries(faixasAgg).map(([label, value]) => ({
      label,
      value,
    }));

    const col1X = doc.page.margins.left;
    const col2X = col1X + colWidth + colGap;
    const col3X = col2X + colWidth + colGap;

    const y1 = drawTable(col1X, "Por status", statusRows);
    const y2 = drawTable(col2X, "Por gênero", generoRows);
    const y3 = drawTable(col3X, "Por faixa etária", faixaRows);

    doc.y = Math.max(y1, y2, y3) + 20;

    // Aniversariantes
    doc
      .fontSize(12)
      .fillColor("#ff7a00")
      .text(
        "Aniversariantes do mês (amostra)",
        doc.page.margins.left,
        undefined,
        { width: contentWidth, align: "center", underline: false }
      )
      .moveDown(0.3);

    const listaBday =
      aniversariantes.length > 0
        ? aniversariantes.join(", ")
        : "Nenhum aniversariante encontrado.";

    doc
      .fontSize(10)
      .fillColor("#000")
      .text(listaBday, doc.page.margins.left, undefined, {
        width: contentWidth,
        align: "center",
      })
      .moveDown(1.2);

    // Detalhamento de clientes
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text("Detalhamento dos clientes (amostra)", doc.page.margins.left, undefined, {
        width: contentWidth,
        align: "center",
        underline: true,
      })
      .moveDown(0.5);

    // Ordena clientes por data de cadastro desc
    const clientesOrdenados = [...clientesFiltrados].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const tableWidth = contentWidth;

    // Largura das colunas 
    const colW = [40, 170, 90, 80, 60, 80]; // ID, Nome, Status, Gênero, Idade, Cadastro
    const colX = [];
    let accX = doc.page.margins.left;
    for (let i = 0; i < colW.length; i++) {
      colX.push(accX);
      accX += colW[i];
    }

    const headers = ["ID", "Nome", "Status", "Gênero", "Idade", "Cadastro"];

    const drawHeader = (y) => {
      doc.rect(doc.page.margins.left, y - 3, tableWidth, 18).fill("#ff7a00");
      headers.forEach((h, i) => {
        doc
          .fontSize(9)
          .fillColor("#fff")
          .text(h, colX[i] + 4, y, {
            width: colW[i] - 8,
          });
      });
    };

    let y = doc.y;
    drawHeader(y);
    y += 22;
    let altColor = false;

    for (const c of clientesOrdenados) {
      if (y > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += 22;
        altColor = false;
      }

      const idade = calcularIdade(c.dateOfBirth);
      const idadeTexto = idade != null ? `${idade} anos` : "—";
      const generoTexto = c.gender_clean || "Não informado";
      const cadastro = c.createdAt
        ? new Date(c.createdAt).toLocaleDateString("pt-BR")
        : "—";

      const rowHeight = 16;

      doc
        .rect(doc.page.margins.left, y - 2, tableWidth, rowHeight)
        .fill(altColor ? "#f8f8f8" : "#ffffff");
      altColor = !altColor;

      doc
        .fontSize(9)
        .fillColor("#000")
        .text(String(c.id), colX[0] + 4, y, { width: colW[0] - 8 })
        .text(c.name || "—", colX[1] + 4, y, { width: colW[1] - 8 })
        .text(c.status_desc || "—", colX[2] + 4, y, {
          width: colW[2] - 8,
        })
        .text(generoTexto, colX[3] + 4, y, { width: colW[3] - 8 })
        .text(idadeTexto, colX[4] + 4, y, { width: colW[4] - 8 })
        .text(cadastro, colX[5] + 4, y, { width: colW[5] - 8 });

      y += rowHeight;
    }

    // Rodapé
    doc
      .moveDown(1)
      .strokeColor("#dddddd")
      .lineWidth(0.5)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + contentWidth, doc.y)
      .stroke()
      .moveDown(0.4);

    doc
      .fontSize(10)
      .fillColor("gray")
      .text(
        `Relatório gerado automaticamente pelo módulo de clientes (admin) — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        { width: contentWidth, align: "center" }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportClientesAdminPdf:", err);
    res
      .status(500)
      .json({ erro: "Erro ao gerar PDF de clientes (admin)." });
  }
}