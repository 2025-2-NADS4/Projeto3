import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import Sidebar from "../../components/Sidebar";
import "../customers/customers.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

const API_BASE = "http://localhost:3000";

export default function AdminOverview() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");
  const [companyId, setCompanyId] = useState("");

  const [kpi, setKpi] = useState({
    faturamento_total: 0,
    ticket_medio_geral: 0,
    lojas_ativas: 0,
    taxa_cancelamento: 0,
    tempo_preparo_medio_min: 0,
    taxa_recompra_media: 0,
  });

  const [g, setG] = useState({
    faturamentoMes: [],
    topLojas: [],
    performanceHeatmap: [],
    canaisPedidos: [],
    ticketPorCanal: [],
    preparoPorLoja: [],
    recompraMes: [],
  });

  const [filtros, setFiltros] = useState({
    mesesDisponiveis: [],
    lojas: [],
  });

  const accent = "#ff7a00";
  const rail = "#1f2835";
  const ink = "#cdd6e4";

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/admin/overview`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const { kpis, graficos, filtros } = res.data || {};

      setKpi({
        faturamento_total: Number(kpis?.faturamento_total || 0),
        ticket_medio_geral: Number(kpis?.ticket_medio_geral || 0),
        lojas_ativas: Number(kpis?.lojas_ativas || 0),
        taxa_cancelamento: Number(kpis?.taxa_cancelamento || 0),
        tempo_preparo_medio_min: Number(kpis?.tempo_preparo_medio_min || 0),
        taxa_recompra_media: Number(kpis?.taxa_recompra_media || 0),
      });

      setG({
        faturamentoMes: graficos?.faturamentoMes ?? [],
        topLojas: graficos?.topLojas ?? [],
        performanceHeatmap: graficos?.performanceHeatmap ?? [],
        canaisPedidos: graficos?.canaisPedidos ?? [],
        ticketPorCanal: graficos?.ticketPorCanal ?? [],
        preparoPorLoja: graficos?.preparoPorLoja ?? [],
        recompraMes: graficos?.recompraMes ?? [],
      });

      setFiltros({
        mesesDisponiveis: filtros?.mesesDisponiveis ?? [],
        lojas: filtros?.lojas ?? [],
      });

      const meses = filtros?.mesesDisponiveis ?? [];
      if (!mesInicio && meses.length) setMesInicio(meses[0]);
      if (!mesFim && meses.length) setMesFim(meses.at(-1));

      setErr("");
    } catch (e) {
      console.error(e);
      setErr(
        e?.response?.data?.erro ||
          "Erro ao carregar dashboard de estabelecimentos (admin)."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData({});
  }, []);

  useEffect(() => {
    if (mesInicio || mesFim || companyId) {
      fetchData({ mesInicio, mesFim, companyId });
    }
  }, [mesInicio, mesFim, companyId]);

  const fmtMoney = (v) =>
    (typeof v === "number" ? v : Number(v || 0)).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  // Gráficos
  // Faturamento por mês
  const fatLabels = useMemo(() => g.faturamentoMes.map((x) => x.mes), [g]);
  const fatValues = useMemo(
    () => g.faturamentoMes.map((x) => Number(x.receita) || 0),
    [g]
  );
  const dsFatMes = {
    labels: fatLabels,
    datasets: [
      {
        label: "Faturamento",
        data: fatValues,
        borderColor: accent,
        backgroundColor: "rgba(255,122,0,.18)",
        fill: true,
        tension: 0.35,
        pointRadius: 2,
      },
    ],
  };

  // Top 10 lojas por faturamento
  const topLabels = useMemo(
    () => g.topLojas.map((x) => x.nomeLoja || x.companyId),
    [g]
  );
  const topValues = useMemo(
    () => g.topLojas.map((x) => Number(x.receita) || 0),
    [g]
  );
  const dsTop = {
    labels: topLabels,
    datasets: [
      {
        label: "Faturamento",
        data: topValues,
        backgroundColor: accent,
        borderRadius: 10,
      },
    ],
  };

  // Distribuição por canal
  const canais = useMemo(
    () => g.canaisPedidos.map((x) => x.canal || "—"),
    [g]
  );
  const canaisConcl = useMemo(
    () => g.canaisPedidos.map((x) => Number(x.concluido) || 0),
    [g]
  );
  const canaisCanc = useMemo(
    () => g.canaisPedidos.map((x) => Number(x.cancelado) || 0),
    [g]
  );
  const canaisOutros = useMemo(
    () => g.canaisPedidos.map((x) => Number(x.outros) || 0),
    [g]
  );
  const dsCanaisStack = {
    labels: canais,
    datasets: [
      {
        label: "Concluídos",
        data: canaisConcl,
        backgroundColor: "#2ab27b",
        borderRadius: 6,
      },
      {
        label: "Cancelados",
        data: canaisCanc,
        backgroundColor: "#e74c3c",
        borderRadius: 6,
      },
      {
        label: "Outros",
        data: canaisOutros,
        backgroundColor: "#ff7a00",
        borderRadius: 6,
      },
    ],
  };

  // Ticket médio por canal
  const tCanalLabels = useMemo(
    () => g.ticketPorCanal.map((x) => x.canal),
    [g]
  );
  const tCanalValues = useMemo(
    () => g.ticketPorCanal.map((x) => Number(x.ticket_medio) || 0),
    [g]
  );
  const dsTicket = {
    labels: tCanalLabels,
    datasets: [
      {
        label: "Ticket médio",
        data: tCanalValues,
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  };

  // Tempo médio de preparo por loja – usa nomeLoja
  const prepLabels = useMemo(
    () => g.preparoPorLoja.map((x) => x.nomeLoja || x.companyId),
    [g]
  );
  const prepValues = useMemo(
    () => g.preparoPorLoja.map((x) => Number(x.tempo_medio_min) || 0),
    [g]
  );
  const dsPreparo = {
    labels: prepLabels,
    datasets: [
      {
        label: "Minutos",
        data: prepValues,
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  };

  // Taxa de recompra por mês
  const recLabels = useMemo(() => g.recompraMes.map((x) => x.mes), [g]);
  const recValues = useMemo(
    () => g.recompraMes.map((x) => Number(x.taxa) || 0),
    [g]
  );
  const dsRecompra = {
    labels: recLabels,
    datasets: [
      {
        label: "Taxa de recompra (%)",
        data: recValues,
        borderColor: "#20c997",
        backgroundColor: "rgba(32,201,151,.18)",
        fill: true,
        tension: 0.35,
        pointRadius: 2,
      },
    ],
  };

  // Heatmap (Lojas x Mes)
  const hmLojaOrder = useMemo(
    () =>
      Array.from(
        new Map(
          g.performanceHeatmap.map((r) => [
            r.companyId,
            r.nomeLoja || r.companyId,
          ])
        ).entries()
      ),
    [g]
  );

  const hmMesOrder = useMemo(
    () =>
      Array.from(new Set(g.performanceHeatmap.map((r) => r.mes))).sort(),
    [g]
  );

  const hmMatrix = useMemo(() => {
    const map = new Map(); 
    let max = 0;
    g.performanceHeatmap.forEach((r) => {
      const key = `${r.companyId}|${r.mes}`;
      const v = Number(r.receita || 0);
      map.set(key, v);
      if (v > max) max = v;
    });

    const matrix = hmLojaOrder.map(([companyId]) =>
      hmMesOrder.map((mes) => map.get(`${companyId}|${mes}`) || 0)
    );

    return { matrix, max };
  }, [g, hmLojaOrder, hmMesOrder]);

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: rail }, ticks: { color: ink } },
      y: { grid: { color: rail }, ticks: { color: ink }, beginAtZero: true },
    },
    plugins: { legend: { labels: { color: ink } } },
  };

  const optsHorizontal = { ...opts, indexAxis: "y" };
  const optsStacked = {
    ...opts,
    scales: {
      x: { stacked: true, grid: { color: rail }, ticks: { color: ink } },
      y: {
        stacked: true,
        grid: { color: rail },
        ticks: { color: ink },
        beginAtZero: true,
      },
    },
  };

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Visão geral dos estabelecimentos</h1>

            <div className="filters">
              <div className="field">
                <label>Estabelecimento</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  <option value="">Todos</option>
                  {filtros.lojas?.map((loja) => (
                    <option key={loja.id} value={loja.id}>
                      {loja.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Mês inicial</label>
                <select
                  value={mesInicio}
                  onChange={(e) => setMesInicio(e.target.value)}
                >
                  {filtros.mesesDisponiveis?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Mês final</label>
                <select
                  value={mesFim}
                  onChange={(e) => setMesFim(e.target.value)}
                >
                  {filtros.mesesDisponiveis?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {err && <div className="errorBox">{err}</div>}
          {loading && <div className="errorBox">Carregando…</div>}

          {/* KPIs */}
          <section className="kpis">
            <div className="kpi">
              <div className="kpi_title">Faturamento total</div>
              <div className="kpi_value">
                {fmtMoney(kpi.faturamento_total)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Ticket médio (geral)</div>
              <div className="kpi_value">
                {fmtMoney(kpi.ticket_medio_geral)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Lojas ativas</div>
              <div className="kpi_value">
                {kpi.lojas_ativas ?? "—"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Taxa de cancelamento</div>
              <div className="kpi_value">
                {Number(kpi.taxa_cancelamento || 0).toFixed(1)}%
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Tempo médio de preparo</div>
              <div className="kpi_value">
                {Number(kpi.tempo_preparo_medio_min || 0).toFixed(1)} min
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Taxa de recompra média</div>
              <div className="kpi_value">
                {Number(kpi.taxa_recompra_media || 0).toFixed(1)}%
              </div>
            </div>
          </section>

          {/* Faturamento do Mês */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Faturamento por mês</div>
              <div className="chartbox tall">
                <Line data={dsFatMes} options={opts} />
              </div>
            </div>

            {/* Top 10 lojas por faturamento */}
            <div className="panel">
              <div className="panel_title">Top 10 lojas por faturamento</div>
              <div className="chartbox">
                <Bar data={dsTop} options={optsHorizontal} />
              </div>
            </div>
          </div>

          {/* Distribuição de pedidos por canal */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Distribuição de pedidos por canal</div>
              <div className="chartbox">
                <Bar data={dsCanaisStack} options={optsStacked} />
              </div>
            </div>

            {/* Ticket médio por canal */}
            <div className="panel">
              <div className="panel_title">Ticket médio por canal</div>
              <div className="chartbox">
                <Bar data={dsTicket} options={opts} />
              </div>
            </div>
          </div>

          {/* Tempo médio de preparo por loja */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Tempo médio de preparo por loja</div>
              <div className="chartbox">
                <Bar data={dsPreparo} options={{ ...opts, indexAxis: "y" }} />
              </div>
            </div>

            {/* Taxa de recompra por mês */}
            <div className="panel">
              <div className="panel_title">Taxa de recompra por mês</div>
              <div className="chartbox tall">
                <Line data={dsRecompra} options={opts} />
              </div>
            </div>
          </div>

          {/* Heatmap */}
          {hmMesOrder.length > 0 && hmLojaOrder.length > 0 && (
            <div className="panel">
              <div className="panel_title">
                Mapa de performance por loja (receita)
              </div>
              <div className="heatmap-wrap">
                <div className="heatmap-legend">
                  <span />
                  {hmMesOrder.map((m) => (
                    <span key={m} className="hm-hour">
                      {m}
                    </span>
                  ))}
                </div>
                <div className="heatmap-grid">
                  {hmLojaOrder.map(([companyId, label], li) => (
                    <div className="hm-row" key={companyId}>
                      <div className="hm-day">{label}</div>
                      {hmMesOrder.map((mes, mi) => {
                        const v = hmMatrix.matrix[li][mi] || 0;
                        const a =
                          hmMatrix.max > 0
                            ? Math.min(
                                1,
                                0.12 + (v / hmMatrix.max) * 0.88
                              )
                            : 0.12;
                        return (
                          <div
                            key={`${companyId}-${mes}`}
                            className="hm-cell"
                            title={`${label} • ${mes}: ${fmtMoney(v)}`}
                            style={{
                              backgroundColor: `rgba(255,122,0,${a})`,
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}