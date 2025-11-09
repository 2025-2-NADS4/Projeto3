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
import "../customers/customers.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const API_BASE = "http://localhost:3000";

export default function CustomersRiskEstab() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [lojaNome, setLojaNome] = useState("Estabelecimento");

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
  const [filtroCategoria, setFiltroCategoria] = useState("todos");
  const [filtroMes, setFiltroMes] = useState("");
  const [mesesUltimaCompra, setMesesUltimaCompra] = useState([]);

  const [exporting, setExporting] = useState(false);

  const accent = "#ff7a00";
  const rail = "#1f2835";
  const ink = "#cdd6e4";

  async function fetchData() {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(
        `${API_BASE}/api/estabelecimento/clientes-risco`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = res.data || {};
      const k = data.kpis || {};
      const g = data.graficos || {};
      const meta = data.meta || {};

      setLojaNome(meta?.loja?.nome || "Estabelecimento");

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

      const lista = data.listaRisco || [];
      setListaRisco(lista);

      const mesesSet = new Set();
      lista.forEach((c) => {
        if (c.ultimaCompra) {
          const d = new Date(c.ultimaCompra);
          if (!Number.isNaN(d.getTime())) {
            const ym = d.toISOString().slice(0, 7);
            mesesSet.add(ym);
          }
        }
      });
      const mesesOrdenados = Array.from(mesesSet).sort();
      setMesesUltimaCompra(mesesOrdenados);

      setErr("");
    } catch (e) {
      console.error(e);
      setErr(
        e?.response?.data?.erro ||
        "Erro ao carregar clientes em risco (estabelecimento)."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const fmtPercent = (v) =>
    `${(typeof v === "number" ? v : Number(v || 0)).toFixed(1)}%`;

  const getDiasSemCompra = (c) =>
    Number(c.diasSemCompra ?? c.dias_sem_compra ?? 0);

  const getNome = (c) =>
    c.customerName || c.nome || c.name || c.customer_name || "—";

  const getMesUltimaCompra = (c) => {
    if (!c.ultimaCompra) return null;
    const d = new Date(c.ultimaCompra);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 7);
  };

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

  const listaFiltrada = useMemo(() => {
    let base = [...listaRisco];

    if (filtroCategoria !== "todos") {
      base = base.filter(
        (c) => categoriaPorDias(getDiasSemCompra(c)) === filtroCategoria
      );
    }

    if (filtroMes) {
      base = base.filter((c) => getMesUltimaCompra(c) === filtroMes);
    }

    base.sort((a, b) => {
      if (ordenacao === "dias_sem_compra") {
        return getDiasSemCompra(b) - getDiasSemCompra(a);
      }
      if (ordenacao === "nome") {
        return getNome(a).localeCompare(getNome(b), "pt-BR");
      }
      return 0;
    });

    return base;
  }, [listaRisco, ordenacao, filtroCategoria, filtroMes]);

  const distFromFiltro = useMemo(() => {
    const counts = {
      "Ativo (≤30d)": 0,
      "Em risco (31–60d)": 0,
      "Perdido (>60d)": 0,
    };

    listaFiltrada.forEach((c) => {
      const dias = getDiasSemCompra(c);
      const catCode = categoriaPorDias(dias);
      if (catCode === "ATIVO") counts["Ativo (≤30d)"]++;
      else if (catCode === "RISCO") counts["Em risco (31–60d)"]++;
      else counts["Perdido (>60d)"]++;
    });

    return counts;
  }, [listaFiltrada]);

  const distLabels = useMemo(
    () => Object.keys(distFromFiltro || {}),
    [distFromFiltro]
  );

  const distValues = useMemo(
    () => distLabels.map((k) => Number(distFromFiltro[k] || 0)),
    [distFromFiltro, distLabels]
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
  const topBase = useMemo(
    () => listaFiltrada.slice(0, 10),
    [listaFiltrada]
  );

  const topLabels = useMemo(
    () => topBase.map((c) => getNome(c)),
    [topBase]
  );
  const topValues = useMemo(
    () => topBase.map((c) => getDiasSemCompra(c)),
    [topBase]
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
  const histFromFiltro = useMemo(() => {
    const bins = { "≤30": 0, "31–60": 0, ">60": 0 };

    listaFiltrada.forEach((c) => {
      const d = getDiasSemCompra(c);
      if (d <= 30) bins["≤30"]++;
      else if (d <= 60) bins["31–60"]++;
      else bins[">60"]++;
    });

    return [
      { faixa: "≤30", qtd: bins["≤30"] },
      { faixa: "31–60", qtd: bins["31–60"] },
      { faixa: ">60", qtd: bins[">60"] },
    ];
  }, [listaFiltrada]);

  const histLabels = useMemo(
    () => (histFromFiltro || []).map((h) => h.faixa),
    [histFromFiltro]
  );
  const histValues = useMemo(
    () => (histFromFiltro || []).map((h) => Number(h.qtd || 0)),
    [histFromFiltro]
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

  async function handleExportPdf() {
    try {
      setExporting(true);
      const token = localStorage.getItem("userToken");

      const res = await axios.get(
        `${API_BASE}/api/estabelecimento/clientes-risco/export/pdf`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        }
      );

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeName = lojaNome.replace(/\s+/g, "_");
      link.download = `relatorio_clientes_risco_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Erro ao exportar PDF de clientes em risco.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Dashboard - Clientes em risco ({lojaNome})</h1>

            <div className="filters">
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
                </select>
              </div>

              <div className="field">
                <label>Categoria de risco</label>
                <select
                  value={filtroCategoria}
                  onChange={(e) => setFiltroCategoria(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  <option value="ATIVO">Ativo (≤30d)</option>
                  <option value="RISCO">Em risco (31–60d)</option>
                  <option value="PERDIDO">Perdido (&gt;60d)</option>
                </select>
              </div>

              <div className="field">
                <label>Última compra (mês)</label>
                <select
                  value={filtroMes}
                  onChange={(e) => setFiltroMes(e.target.value)}
                >
                  <option value="">Todos</option>
                  {mesesUltimaCompra.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botão de exportar PDF */}
              <div className="field">
                <label>&nbsp;</label>
                <button
                  type="button"
                  className="btn export-btn"
                  onClick={handleExportPdf}
                  disabled={exporting}
                >
                  {exporting ? "Gerando PDF..." : "Exportar PDF"}
                </button>
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
              <div className="kpi_hint">Clientes com pelo menos 1 pedido</div>
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
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Distribuição por categoria</div>
              <div className="panel_subtitle">
                Base considerada: {listaFiltrada.length} clientes (após filtros)
              </div>
              <div className="chartbox">
                <Bar data={dsDistribuicao} options={chartOpts} />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Top 10: mais tempo sem compra</div>
              <div className="panel_subtitle">
                Clientes filtrados com maior tempo sem comprar
              </div>
              <div className="chartbox">
                <Bar data={dsTop10} options={chartOpts} />
              </div>
            </div>
          </div>

          {/* Distribuição por dias sem compra (faixas) */}
          <div className="panel">
            <div className="panel_title">
              Distribuição de dias sem compra (faixas)
            </div>
            <div className="chartbox">
              <Bar data={dsHist} options={chartOpts} />
            </div>
          </div>

          {/* Tabela */}
          <div className="panel">
            <div className="panel_title">
              Lista de clientes em risco / perdidos
            </div>
            <div className="table-wrap">
              <table className="table risk-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Nível</th>
                    <th>Dias sem comprar</th>
                    <th>Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ textAlign: "center", opacity: 0.7 }}
                      >
                        Nenhum cliente encontrado para os filtros atuais.
                      </td>
                    </tr>
                  )}

                  {listaFiltrada.map((c, i) => {
                    const dias = getDiasSemCompra(c);
                    const cat = categoriaPorDias(dias);

                    return (
                      <tr key={c.customerId || i}>
                        <td>{getNome(c)}</td>
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