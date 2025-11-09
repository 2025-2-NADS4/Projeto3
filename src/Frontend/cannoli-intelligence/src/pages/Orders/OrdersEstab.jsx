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
import "../Customers/customers.css";

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

export default function OrdersEstab() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");
  const [lojaNome, setLojaNome] = useState("Estabelecimento");

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
  const [exporting, setExporting] = useState(false);

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/estabelecimento/pedidos`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const { meta, kpis, graficos, filtros } = res.data || {};
      setLojaNome(meta?.loja?.nome || "Estabelecimento");
      setKpis(kpis || {});
      setGraficos(graficos || {});
      setFiltros(filtros || {});

      if (!mesInicio && filtros?.mesesDisponiveis?.length) {
        setMesInicio(filtros.mesesDisponiveis[0]);
      }
      if (!mesFim && filtros?.mesesDisponiveis?.length) {
        setMesFim(filtros.mesesDisponiveis.at(-1));
      }
      setErr("");
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.erro || "Erro ao carregar dados dos pedidos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData({});
  }, []);

  useEffect(() => {
    if (mesInicio || mesFim) {
      fetchData({ mesInicio, mesFim });
    }
  }, [mesInicio, mesFim]);

  const accent = "#ff7a00";
  const rail = "#1f2835";
  const ink = "#cdd6e4";

  // Helpers de datasets
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

  // Memo dos gráficos
  const statusLabels = useMemo(
    () => graficos.status?.map((s) => s.status ?? "—") || [],
    [graficos]
  );
  const statusValues = useMemo(
    () => graficos.status?.map((s) => Number(s.qtde) || 0) || [],
    [graficos]
  );

  const canalLabels = useMemo(
    () => graficos.canal?.map((c) => c.canal ?? "—") || [],
    [graficos]
  );
  const canalValues = useMemo(
    () => graficos.canal?.map((c) => Number(c.qtde) || 0) || [],
    [graficos]
  );

  const receitaLabels = useMemo(
    () => graficos.receitaMes?.map((r) => r.mes) || [],
    [graficos]
  );
  const receitaValues = useMemo(
    () => graficos.receitaMes?.map((r) => Number(r.receita) || 0) || [],
    [graficos]
  );

  const ticketCanalLabels = useMemo(
    () => graficos.ticketCanal?.map((t) => t.canal ?? "—") || [],
    [graficos]
  );
  const ticketCanalValues = useMemo(
    () => graficos.ticketCanal?.map((t) => Number(t.ticket_medio) || 0) || [],
    [graficos]
  );

  const tempoLabels = useMemo(
    () => graficos.tempoMedio?.map((t) => t.tipo ?? "—") || [],
    [graficos]
  );
  const tempoValues = useMemo(
    () => graficos.tempoMedio?.map((t) => Number(t.tempo_medio) || 0) || [],
    [graficos]
  );

  const horaLabels = useMemo(
    () =>
      graficos.horarios?.length
        ? graficos.horarios.map((h) => String(h.hora).padStart(2, "0"))
        : [],
    [graficos]
  );
  const horaValues = useMemo(
    () =>
      graficos.horarios?.length
        ? graficos.horarios.map((h) => Number(h.qtde) || 0)
        : [],
    [graficos]
  );

  // Formata helpers
  const fmtMoney = (v) =>
    (typeof v === "number" ? v : Number(v || 0)).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  const kpi = kpis || {};

  // Exportar PDF
  async function handleExportPdf() {
    try {
      setExporting(true);
      const token = localStorage.getItem("userToken");

      const res = await axios.get(
        `${API_BASE}/api/estabelecimento/pedidos/export/pdf`,
        {
          params: {
            mesInicio: mesInicio || undefined,
            mesFim: mesFim || undefined,
          },
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        }
      );

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeName = lojaNome.replace(/\s+/g, "_");
      link.download = `relatorio_pedidos_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Erro ao exportar PDF de pedidos.");
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
            <h1>Dashboard - Pedidos ({lojaNome})</h1>

            {/* Filtros + botão */}
            <div className="filters">
              <div className="field">
                <label>Mês inicial</label>
                <select
                  value={mesInicio}
                  onChange={(e) => setMesInicio(e.target.value)}
                >
                  {filtros.mesesDisponiveis?.map((m, i) => (
                    <option key={i} value={m}>
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
                  {filtros.mesesDisponiveis?.map((m, i) => (
                    <option key={i} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botão de Exportar PDF */}
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
              <div className="kpi_title">Total de pedidos</div>
              <div className="kpi_value">{kpi.total_pedidos ?? "—"}</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Receita total</div>
              <div className="kpi_value">
                {fmtMoney(kpi.receita_total ?? 0)}
              </div>
              <div className="kpi_hint">Período selecionado</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Ticket médio (geral)</div>
              <div className="kpi_value">
                {fmtMoney(kpi.ticket_medio_geral ?? 0)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Taxa de cancelamento</div>
              <div className="kpi_value">
                {Number(kpi.taxa_cancelamento || 0).toFixed(1)}%
              </div>
              <div className="kpi_hint">Cancelados / Total</div>
            </div>
          </section>

          {/* Status x Canal */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Pedidos por status</div>
              <div className="chartbox">
                <Bar
                  data={toBar(statusLabels, statusValues, "Qtd")}
                  options={opts}
                />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Pedidos por canal de venda</div>
              <div className="chartbox">
                <Bar
                  data={toBar(canalLabels, canalValues, "Qtd")}
                  options={opts}
                />
              </div>
            </div>
          </div>

          {/* Receita por mês (linha) */}
          <div className="panel">
            <div className="panel_title">Receita por mês</div>
            <div className="chartbox tall">
              <Line
                data={toLine(receitaLabels, receitaValues, "Receita (R$)")}
                options={opts}
              />
            </div>
          </div>

          {/* Ticket por canal x Tempo médio */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Ticket médio por canal</div>
              <div className="chartbox">
                <Bar
                  data={toBar(ticketCanalLabels, ticketCanalValues, "R$")}
                  options={{
                    ...opts,
                    scales: {
                      ...opts.scales,
                      y: {
                        ...opts.scales.y,
                        ticks: {
                          color: ink,
                          callback: (v) =>
                            Number(v).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                              maximumFractionDigits: 0,
                            }),
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">
                Tempo médio de preparo por tipo
              </div>
              <div className="chartbox">
                <Bar
                  data={toBar(tempoLabels, tempoValues, "Minutos")}
                  options={{
                    ...opts,
                    scales: {
                      ...opts.scales,
                      y: {
                        ...opts.scales.y,
                        ticks: { color: ink, callback: (v) => `${v}m` },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          {/* Pedidos por hora */}
          <div className="panel">
            <div className="panel_title">Pedidos por hora do dia</div>
            <div className="chartbox">
              <Bar data={toBar(horaLabels, horaValues, "Qtd")} options={opts} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}