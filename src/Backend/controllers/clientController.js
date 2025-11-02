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


// GET /api/estabelecimento/clientes
export async function getClientesEstabelecimento(req, res) {
  try {
    const { establishment_id } = req.user;
    const { mesInicio, mesFim } = req.query;

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
    )
    const lojaNome = linhaLoja?.store_name || '(Loja sem nome)'

    // Filtro de período
    const start = mesInicio ? new Date(`${mesInicio}-01`) : null;
    const end = mesFim ? new Date(`${mesFim}-01`) : null;
    const filtered = clientes.filter((c) => {
      const d = new Date(c.createdAt);
      if (start && d < start) return false;
      if (end && d >= end) return false;
      return true;
    });

    // KPIs
    const total = filtered.length;
    const isAtivo = (s) => /\bativo\b/i.test(s || "");
    const ativos = filtered.filter(c => isAtivo(c.status_desc)).length;

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

    res.json({
      kpis: { total, ativos, inativos, pctAtivos, taxaRecompra },
      graficos: { status, genero, faixas },
      heatmap,
      aniversariantes: aniversariantes.slice(0, 10),
      meta: { loja: { id: establishment_id, nome: lojaNome } },
    });
  } catch (err) {
    console.error("Erro em getClientesEstabelecimento:", err);
    res.status(500).json({ erro: "Erro ao carregar dados de clientes (estab)." });
  }
}

// GET /api/admin/clientes
export async function getClientesAdmin(req, res) {
  try {
    const { mesInicio, mesFim, storeId } = req.query;

    // Base de clientes
    const [clientes] = storeId
      ? await db.execute(
          `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
           FROM customer
           WHERE companyId = ?`,
          [storeId]
        )
      : await db.execute(
          `SELECT id, name, status_desc, gender_clean, dateOfBirth, companyId, createdAt
           FROM customer`
        );

    // Filtros auxiliares para o Site
    const [distinctStores] = await db.execute(
      `SELECT DISTINCT companyId AS storeId FROM customer WHERE companyId IS NOT NULL ORDER BY companyId`
    );

    // Pega meses únicos da base
    const [distinctMonths] = await db.execute(`
      SELECT DISTINCT DATE_FORMAT(createdAt, '%Y-%m') AS mes
      FROM customer
      ORDER BY mes ASC
    `);

    // Filtro de período
    const start = mesInicio ? new Date(`${mesInicio}-01`) : null;
    const end = mesFim ? new Date(`${mesFim}-01`) : null;
    const filtered = clientes.filter((c) => {
      const d = new Date(c.createdAt);
      if (start && d < start) return false;
      if (end && d >= end) return false;
      return true;
    });

    // KPIs
    const total = filtered.length;
    const isAtivo = (s) => /\bativo\b/i.test(s || "");
    const ativos = filtered.filter(c => isAtivo(c.status_desc)).length;

    const inativos = total - ativos;
    const pctAtivos = total ? Math.round((ativos / total) * 100) : 0;

    // Taxa de recompra
    const [pedidos] = storeId
      ? await db.execute(
          `SELECT customer, COUNT(*) AS qtd
           FROM \`order\`
           WHERE companyId = ?
           GROUP BY customer`,
          [storeId]
        )
      : await db.execute(
          `SELECT customer, COUNT(*) AS qtd
           FROM \`order\`
           GROUP BY customer`
        );

    const clientesComMaisDe1Pedido = pedidos.filter((p) => p.qtd > 1).length;
    const taxaRecompra = total
      ? Math.round((clientesComMaisDe1Pedido / total) * 100)
      : 0;

    // Gráficos e análises
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

      if (c.dateOfBirth) {
        const nasc = new Date(c.dateOfBirth);
        if (nasc.getMonth() === mesAtual) aniversariantes.push(c.name);
      }
    }

    // Heatmap 7x24
    const [heatRows] = storeId
      ? await db.execute(
          `SELECT DAYOFWEEK(createdAt) AS dow, HOUR(createdAt) AS hora, COUNT(*) AS qtd
           FROM \`order\`
           WHERE companyId = ?
           GROUP BY dow, hora
           ORDER BY dow, hora`,
          [storeId]
        )
      : await db.execute(
          `SELECT DAYOFWEEK(createdAt) AS dow, HOUR(createdAt) AS hora, COUNT(*) AS qtd
           FROM \`order\`
           GROUP BY dow, hora
           ORDER BY dow, hora`
        );

    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of heatRows) {
      const dia = r.dow === 1 ? 6 : r.dow - 2;
      if (dia >= 0 && dia < 7 && r.hora >= 0 && r.hora < 24)
        heatmap[dia][r.hora] = Number(r.qtd);
    }

    res.json({
      kpis: { total, ativos, inativos, pctAtivos, taxaRecompra },
      graficos: { status, genero, faixas },
      heatmap,
      aniversariantes: aniversariantes.slice(0, 10),
      meta: {
        loja: storeId || "todas",
        lojas: distinctStores.map((s) => s.storeId),
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
