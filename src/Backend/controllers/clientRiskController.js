import db from "../config/db.js";

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