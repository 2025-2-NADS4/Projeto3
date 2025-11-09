import db from '../config/db.js'
import PDFDocument from "pdfkit";

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

export async function exportCampanhasEstabPdf(req, res) {
  try {
    const { establishment_id } = req.user;
    const { mesInicio, mesFim, campanhaId } = req.query;

    // Nome da loja
    const [[lojaRow]] = await db.execute(
      `SELECT store_name 
         FROM estabelecimentos 
        WHERE establishment_id = ?
        LIMIT 1`,
      [establishment_id]
    );
    const lojaNome = lojaRow?.store_name || "Estabelecimento";

    // Filtros da query
    let where = `WHERE c.storeId = ?`;
    const params = [establishment_id];

    if (campanhaId) {
      where += ` AND c.id = ?`;
      params.push(campanhaId);
    }

    if (mesInicio) {
      where += ` AND c._mes >= ?`;
      params.push(mesInicio);
    }

    if (mesFim) {
      where += ` AND c._mes <= ?`;
      params.push(mesFim);
    }

    const [rows] = await db.execute(
      `
      SELECT 
        c.id           AS campaignId,
        c.name         AS nome,
        c.status_desc  AS status_desc,
        c.badge        AS badge,
        c.createdAt    AS data_criacao
      FROM campaign c
      ${where}
      ORDER BY c.createdAt DESC
      `,
      params
    );

    // KPIs
    const total = rows.length;

    let ativas = 0;
    let concluidas = 0;
    let rascunhos = 0;
    let agendadas = 0;

    rows.forEach((c) => {
      const s = (c.status_desc || "").toLowerCase();

      if (s.includes("ativa")) ativas++;
      else if (s.includes("conclu")) concluidas++;
      else if (s.includes("rascun")) rascunhos++;
      else if (s.includes("agend")) agendadas++;
    });

    // Montagem do PDF
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Relatorio_Campanhas_${lojaNome.replace(
        /\s+/g,
        "_"
      )}.pdf"`
    );

    doc.pipe(res);

    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Cabeçalho
    doc
      .fontSize(20)
      .fillColor("#ff7a00")
      .text(
        "Relatório de Campanhas",
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

    // Período analisado
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
      "Total de campanhas",
      total,
      "#ff7a00"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap),
      "Campanhas ativas",
      ativas,
      "#28a745"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 2,
      "Campanhas concluídas",
      concluidas,
      "#007bff"
    );
    drawKpiBox(
      baseX + (boxWidth + boxGap) * 3,
      "Rascunhos",
      rascunhos,
      "#6c757d"
    );

    doc.y = boxY + boxHeight + 40;

    // Título da tabela
    doc
      .fontSize(14)
      .fillColor("#ff7a00")
      .text(
        "Detalhamento das campanhas",
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

    // Larguras das colunas
    const colW = [50, 200, 110, 80, 100];
    const colX = [];
    let accX = doc.page.margins.left;

    for (let i = 0; i < colW.length; i++) {
      colX.push(accX);
      accX += colW[i];
    }

    const headers = ["ID", "Nome", "Status", "Badge", "Criação"];

    const drawHeader = (y) => {
      doc
        .rect(doc.page.margins.left, y - 3, tableWidth, 20)
        .fill("#ff7a00");

      headers.forEach((h, i) => {
        doc
          .fillColor("#fff")
          .fontSize(10)
          .text(h, colX[i] + 4, y + 4, {
            width: colW[i] - 8,
            align: "left",
          });
      });
    };

    let y = doc.y;
    drawHeader(y);
    y += 24;
    let altColor = false;

    for (const c of rows) {
      const criacao = c.data_criacao || "—";

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
        .text(c.campaignId, colX[0] + 4, y, { width: colW[0] - 8 })
        .text(c.nome || "—", colX[1] + 4, y, { width: colW[1] - 8 })
        .text(c.status_desc || "—", colX[2] + 4, y, { width: colW[2] - 8 })
        .text(c.badge || "—", colX[3] + 4, y, { width: colW[3] - 8 })
        .text(criacao, colX[4] + 4, y, { width: colW[4] - 8 });

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
        `Relatório gerado automaticamente pelo módulo de campanhas — ${lojaNome}`,
        doc.page.margins.left,
        undefined,
        {
          width: contentWidth,
          align: "center",
        }
      );

    doc.end();
  } catch (err) {
    console.error("Erro em exportCampanhasEstabPdf:", err);
    res
      .status(500)
      .json({ erro: "Erro ao gerar PDF de campanhas do estabelecimento." });
  }
}