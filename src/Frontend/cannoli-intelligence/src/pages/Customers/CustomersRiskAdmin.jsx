import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

import Sidebar from "../../components/Sidebar";
import "./customers.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const API_BASE = "http://localhost:3000";

export default function CustomersRiskAdmin() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [lojaSelecionadaId, setLojaSelecionadaId] = useState(""); 
  const [lojaSelecionadaNome, setLojaSelecionadaNome] = useState(""); 
  const [lojas, setLojas] = useState([]);

  const [kpis, setKpis] = useState({
    base_clientes: 0,
    qtd_ativos: 0,
    pct_ativos: 0,
    qtd_em_risco: 0,
    pct_em_risco: 0,
    qtd_perdidos: 0,
    pct_perdidos: 0,
  });

  const [distCategorias, setDistCategorias] = useState({});
  const [histDias, setHistDias] = useState([]);
  const [topInativos, setTopInativos] = useState([]);
  const [listaRisco, setListaRisco] = useState([]);

  const [ordenacao, setOrdenacao] = useState("dias_sem_compra");

  const accent = "#ff7a00";
  const rail = "#1f2835";
  const ink = "#cdd6e4";

  async function fetchData(params = {}) {
    setLoading(true);
    setListaRisco([]);
    setTopInativos([]);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/admin/clientes-risco`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data || {};
      const k = data.kpis || {};
      const g = data.graficos || {};

      setKpis({
        base_clientes: Number(k.base_clientes || 0),
        qtd_ativos: Number(k.qtd_ativos || 0),
        pct_ativos: Number(k.pct_ativos || 0),
        qtd_em_risco: Number(k.qtd_em_risco || 0),
        pct_em_risco: Number(k.pct_em_risco || 0),
        qtd_perdidos: Number(k.qtd_perdidos || 0),
        pct_perdidos: Number(k.pct_perdidos || 0),
      });

      setDistCategorias(g.distribuicaoCategorias || {});
      setHistDias(g.histDias || []);
      setTopInativos(g.topInativos || []);
      setListaRisco(data.listaRisco || []);

      const f = data.filtros || {};
      const lojasResp = f.lojas || [];
      const normalizado = lojasResp.map((l) =>
        typeof l === "string" ? { id: l, nome: l } : l
      );
      setLojas(normalizado);

      setErr("");
    } catch (e) {
      console.error(e);
      setErr(
        e?.response?.data?.erro ||
          "Erro ao carregar clientes em risco (admin)."
      );
    } finally {
      setLoading(false);
    }
  }

  // Ao alterar o id do estabelecimento, o valor de lojaSelecionadaId será atualizando, fazendo com que o backend seja recarregado
  useEffect(() => {
    if (lojaSelecionadaId) {
      fetchData({ companyId: lojaSelecionadaId });
    } else {
      fetchData({});
    }
  }, [lojaSelecionadaId]);

  const fmtPercent = (v) =>
    `${(typeof v === "number" ? v : Number(v || 0)).toFixed(1)}%`;

  const getDiasSemCompra = (c) =>
    Number(c.diasSemCompra ?? c.dias_sem_compra ?? 0);

  const getNome = (c) =>
    c.customerName || c.nome || c.name || c.customer_name || "—";

  const getLojaNome = (c) =>
    c.loja?.nome || c.store_name || c.loja_nome || "—";

  function categoriaPorDias(dias) {
    if (dias <= 30) return "ATIVO";
    if (dias <= 60) return "RISCO";
    return "PERDIDO";
  }

  function labelCategoria(cat) {
    if (cat === "ATIVO") return "Ativo (≤30d)";
    if (cat === "RISCO") return "Em risco (31–60d)";
    return "Perdido (>60d)";
  }

  function handleChangeLoja(e) {
    const id = e.target.value; 
    setLojaSelecionadaId(id);

    const lojaObj = lojas.find((l) => l.id === id);
    setLojaSelecionadaNome(lojaObj?.nome || "");
  }

  // Funções de ordenação
  const normalizeStr = (s) =>
    (s || "").toString().toLowerCase().trim();

  const compareByDias = (a, b) =>
    getDiasSemCompra(b) - getDiasSemCompra(a);

  const compareByNome = (a, b) =>
    normalizeStr(getNome(a)).localeCompare(
      normalizeStr(getNome(b)),
      "pt-BR"
    );

  const compareByLoja = (a, b) =>
    normalizeStr(getLojaNome(a)).localeCompare(
      normalizeStr(getLojaNome(b)),
      "pt-BR"
    );

  const listaFiltrada = useMemo(() => {
    if (!Array.isArray(listaRisco)) return [];

    const base = [...listaRisco];

    base.sort((a, b) => {
      switch (ordenacao) {
        case "dias_sem_compra":
          return compareByDias(a, b);
        case "nome":
          return compareByNome(a, b);
        case "loja":
          return compareByLoja(a, b);
        default:
          return 0;
      }
    });

    return base;
  }, [listaRisco, ordenacao]);

  // Gráficos 
  // Distribuição por categoria
  const distLabels = useMemo(
    () => Object.keys(distCategorias || {}),
    [distCategorias]
  );
  const distValues = useMemo(
    () => distLabels.map((k) => Number(distCategorias[k] || 0)),
    [distCategorias, distLabels]
  );

  const dsDistribuicao = {
    labels: distLabels,
    datasets: [
      {
        label: "Qtd",
        data: distValues,
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  };

  // Top 10: mais tempo sem compra
  const topLabels = useMemo(
    () => topInativos.map((c) => getNome(c)),
    [topInativos]
  );
  const topValues = useMemo(
    () => topInativos.map((c) => getDiasSemCompra(c)),
    [topInativos]
  );

  const dsTop10 = {
    labels: topLabels,
    datasets: [
      {
        label: "Dias sem compra",
        data: topValues,
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  };

  // Distribuição de dias sem compra (faixas)
  const histLabels = useMemo(
    () => (histDias || []).map((h) => h.faixa),
    [histDias]
  );
  const histValues = useMemo(
    () => (histDias || []).map((h) => Number(h.qtd || 0)),
    [histDias]
  );

  const dsHist = {
    labels: histLabels,
    datasets: [
      {
        label: "Qtd",
        data: histValues,
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: rail }, ticks: { color: ink } },
      y: { grid: { color: rail }, ticks: { color: ink }, beginAtZero: true },
    },
    plugins: { legend: { labels: { color: ink } } },
  };

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Dashboard - Clientes em risco (Admin)</h1>

            <div className="filters">
              <div className="field">
                <label>Estabelecimento</label>
                <select
                  value={lojaSelecionadaId}
                  onChange={handleChangeLoja}
                >
                  <option value="">Todos</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Ordenar por</label>
                <select
                  value={ordenacao}
                  onChange={(e) => setOrdenacao(e.target.value)}
                >
                  <option value="dias_sem_compra">
                    Mais tempo sem comprar
                  </option>
                  <option value="nome">Nome do cliente</option>
                  <option value="loja">Nome da loja</option>
                </select>
              </div>
            </div>
          </div>

          {err && <div className="errorBox">{err}</div>}
          {loading && <div className="errorBox">Carregando…</div>}

          {/* KPIs */}
          <section className="kpis">
            <div className="kpi">
              <div className="kpi_title">Base de clientes</div>
              <div className="kpi_value">{kpis.base_clientes}</div>
              <div className="kpi_hint">
                Escopo: {lojaSelecionadaNome || "todas as lojas"}
              </div>
            </div>

            <div className="kpi">
              <div className="kpi_title">Ativos (≤30 dias)</div>
              <div className="kpi_value">{kpis.qtd_ativos}</div>
              <div className="kpi_hint">
                {fmtPercent(kpis.pct_ativos)} da base
              </div>
            </div>

            <div className="kpi">
              <div className="kpi_title">Em risco (31–60 dias)</div>
              <div className="kpi_value">{kpis.qtd_em_risco}</div>
              <div className="kpi_hint">
                {fmtPercent(kpis.pct_em_risco)} da base
              </div>
            </div>

            <div className="kpi">
              <div className="kpi_title">Perdidos (&gt;60 dias)</div>
              <div className="kpi_value">{kpis.qtd_perdidos}</div>
              <div className="kpi_hint">
                {fmtPercent(kpis.pct_perdidos)} da base
              </div>
            </div>
          </section>

          {/* Distribuição + Top 10 */}
          <div
            className="grid2"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "24px",
              alignItems: "stretch",
            }}
          >
            <div className="panel">
              <div className="panel_title">Distribuição por categoria</div>
              <div className="panel_subtitle">
                Base considerada: {kpis.base_clientes} clientes
              </div>
              <div className="chartbox">
                <Bar data={dsDistribuicao} options={chartOpts} />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Top 10: mais tempo sem compra</div>
              <div className="panel_subtitle">
                Clientes com maior tempo sem comprar (escopo atual)
              </div>
              <div className="chartbox">
                <Bar data={dsTop10} options={chartOpts} />
              </div>
            </div>
          </div>

          {/* Tabela de Lista de clientes em risco (31–60 dias) */}
          <div className="panel">
            <div className="panel_title">
              Lista de clientes em risco (31–60 dias)
            </div>
            <div className="table-wrap">
              <table className="table risk-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Loja</th>
                    <th>Nível</th>
                    <th>Dias sem comprar</th>
                    <th>Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ textAlign: "center", opacity: 0.7 }}
                      >
                        Nenhum cliente em risco encontrado.
                      </td>
                    </tr>
                  )}

                  {listaFiltrada.map((c, i) => {
                    const dias = getDiasSemCompra(c);
                    const cat = categoriaPorDias(dias);

                    return (
                      <tr key={c.customerId || i}>
                        <td>{getNome(c)}</td>
                        <td>{getLojaNome(c)}</td>
                        <td>{labelCategoria(cat)}</td>
                        <td>{dias}</td>
                        <td>
                          {c.ultimaCompra
                            ? new Date(c.ultimaCompra).toLocaleDateString(
                                "pt-BR"
                              )
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}