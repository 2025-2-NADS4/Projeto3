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
  Legend
);

const API_BASE = "http://localhost:3000";

export default function OrdersAdmin() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");
  const [storeId, setStoreId] = useState("");
  const [lojas, setLojas] = useState([]);
  const [storeName, setStoreName] = useState("");

  const [todosMeses, setTodosMeses] = useState([]);

  const [kpis, setKpis] = useState({
    total_pedidos: 0,
    receita_total: 0,
    ticket_medio_geral: 0,
    taxa_cancelamento: 0,
  });

  const [graficos, setGraficos] = useState({
    status: [],
    canal: [],
    receitaMes: [],
    ticketCanal: [],
    tempoMedio: [],
    horarios: [],
  });

  const [filtros, setFiltros] = useState({ mesesDisponiveis: [] });

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/admin/pedidos`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const {
        kpis: k,
        graficos: g,
        filtros: filtrosResp,
        lojas: lojasResp,
      } = res.data || {};

      // Atualiza KPIs e gráficos
      setKpis({
        total_pedidos: Number(k?.total_pedidos) || 0,
        receita_total: Number(k?.receita_total) || 0,
        ticket_medio_geral: Number(k?.ticket_medio_geral) || 0,
        taxa_cancelamento: Number(k?.taxa_cancelamento) || 0,
      });

      setGraficos({
        status: g?.status ?? [],
        canal: g?.canal ?? [],
        receitaMes: g?.receitaMes ?? [],
        ticketCanal: g?.ticketCanal ?? [],
        tempoMedio: g?.tempoMedio ?? [],
        horarios: g?.horarios ?? [],
      });

      const novosMeses = filtrosResp?.mesesDisponiveis ?? [];
      if (novosMeses.length) {
        setTodosMeses((prev) => Array.from(new Set([...prev, ...novosMeses])));
        setFiltros({ mesesDisponiveis: novosMeses });
      }

      if (Array.isArray(lojasResp)) setLojas(lojasResp);

      setErr("");
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.erro || "Erro ao carregar dados dos pedidos (admin).");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData({});
  }, []);

  // Recarrega sempre que mudar filtro
  useEffect(() => {
    fetchData({
      mesInicio,
      mesFim,
      storeName: storeName || undefined,
    });
  }, [mesInicio, mesFim, storeName]);

  // Gráficos
  const accent = "#ff7a00";
  const rail = "#1f2835";
  const ink = "#cdd6e4";

  const toBar = (labels, values, label = "Quantidade") => ({
    labels,
    datasets: [
      {
        label,
        data: values,
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  });

  const toLine = (labels, values, label = "Valor") => ({
    labels,
    datasets: [
      {
        label,
        data: values,
        borderColor: accent,
        backgroundColor: "rgba(255,122,0,.2)",
        tension: 0.35,
        fill: true,
        pointRadius: 2,
      },
    ],
  });

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: rail }, ticks: { color: ink } },
      y: { grid: { color: rail }, ticks: { color: ink }, beginAtZero: true },
    },
    plugins: { legend: { labels: { color: ink } } },
  };

  const fmtMoney = (v) =>
    (typeof v === "number" ? v : Number(v || 0)).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  const statusLabels = useMemo(() => (graficos.status || []).map((s) => s.status ?? "—"), [graficos.status]);
  const statusValues = useMemo(() => (graficos.status || []).map((s) => Number(s.qtde) || 0), [graficos.status]);

  const canalLabels = useMemo(() => (graficos.canal || []).map((c) => c.canal ?? "—"), [graficos.canal]);
  const canalValues = useMemo(() => (graficos.canal || []).map((c) => Number(c.qtde) || 0), [graficos.canal]);

  const receitaLabels = useMemo(() => (graficos.receitaMes || []).map((r) => r.mes), [graficos.receitaMes]);
  const receitaValues = useMemo(() => (graficos.receitaMes || []).map((r) => Number(r.receita) || 0), [graficos.receitaMes]);

  const ticketCanalLabels = useMemo(() => (graficos.ticketCanal || []).map((t) => t.canal ?? "—"), [graficos.ticketCanal]);
  const ticketCanalValues = useMemo(() => (graficos.ticketCanal || []).map((t) => Number(t.ticket_medio) || 0), [graficos.ticketCanal]);

  const tempoLabels = useMemo(() => (graficos.tempoMedio || []).map((t) => t.tipo ?? "—"), [graficos.tempoMedio]);
  const tempoValues = useMemo(() => (graficos.tempoMedio || []).map((t) => Number(t.tempo_medio) || 0), [graficos.tempoMedio]);

  const horaLabels = useMemo(() => (graficos.horarios || []).map((h) => String(h.hora).padStart(2, "0")), [graficos.horarios]);
  const horaValues = useMemo(() => (graficos.horarios || []).map((h) => Number(h.qtde) || 0), [graficos.horarios]);

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Dashboard - Pedidos (Admin)</h1>

            <div className="filters">
              {/* Filtro por Estabelecimento */}
              <div className="field">
                <label>Estabelecimento</label>
                <select value={storeName} onChange={(e) => setStoreName(e.target.value)}>
                  <option value="">Todos</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.nome}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtro por Meses */}
              <div className="field">
                <label>Mês inicial</label>
                <select value={mesInicio} onChange={(e) => setMesInicio(e.target.value)}>
                  {todosMeses.map((m, i) => (
                    <option key={i} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Mês final</label>
                <select value={mesFim} onChange={(e) => setMesFim(e.target.value)}>
                  {todosMeses.map((m, i) => (
                    <option key={i} value={m}>
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
              <div className="kpi_title">Total de pedidos</div>
              <div className="kpi_value">{kpis.total_pedidos ?? "—"}</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Receita total</div>
              <div className="kpi_value">{fmtMoney(kpis.receita_total ?? 0)}</div>
              <div className="kpi_hint">Período selecionado</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Ticket médio (geral)</div>
              <div className="kpi_value">{fmtMoney(kpis.ticket_medio_geral ?? 0)}</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Taxa de cancelamento</div>
              <div className="kpi_value">{Number(kpis.taxa_cancelamento || 0).toFixed(1)}%</div>
              <div className="kpi_hint">Cancelados / Total</div>
            </div>
          </section>

          {/* Gráficos */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Pedidos por status</div>
              <div className="chartbox">
                <Bar data={toBar(statusLabels, statusValues)} options={opts} />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Pedidos por canal de venda</div>
              <div className="chartbox">
                <Bar data={toBar(canalLabels, canalValues)} options={opts} />
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel_title">Receita por mês</div>
            <div className="chartbox tall">
              <Line data={toLine(receitaLabels, receitaValues)} options={opts} />
            </div>
          </div>

          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Ticket médio por canal</div>
              <div className="chartbox">
                <Bar data={toBar(ticketCanalLabels, ticketCanalValues)} options={opts} />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Tempo médio de preparo por tipo</div>
              <div className="chartbox">
                <Bar data={toBar(tempoLabels, tempoValues)} options={opts} />
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel_title">Pedidos por hora do dia</div>
            <div className="chartbox">
              <Bar data={toBar(horaLabels, horaValues)} options={opts} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}