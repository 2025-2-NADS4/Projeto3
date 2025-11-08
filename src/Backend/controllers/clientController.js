import db from "../config/db.js";

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
