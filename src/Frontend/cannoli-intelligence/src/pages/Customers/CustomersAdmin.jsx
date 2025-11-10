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

export default function CustomersAdmin() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");

  const [storeName, setStoreName] = useState("");
  const [lojas, setLojas] = useState([]);
  const [lojaAtual, setLojaAtual] = useState("Todas as lojas");

  const [kpis, setKpis] = useState({});
  const [graficos, setGraficos] = useState({
    status: {},
    genero: {},
    faixas: {},
  });
  const [heatmap, setHeatmap] = useState([]);
  const [aniversariantes, setAniversariantes] = useState([]);
  const [filtros, setFiltros] = useState({ mesesDisponiveis: [] });

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/admin/clientes`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const {
        meta,
        kpis: k,
        graficos: g,
        heatmap: hm,
        aniversariantes: bdays,
        filtros: filtrosResp,
      } = res.data || {};

      setKpis(k || {});
      setGraficos(g || {});
      setHeatmap(Array.isArray(hm) ? hm : []);
      setAniversariantes(Array.isArray(bdays) ? bdays : []);
      setFiltros(filtrosResp || { mesesDisponiveis: [] });

      if (meta?.lojas) setLojas(meta.lojas);
      if (meta?.loja?.nome) setLojaAtual(meta.loja.nome);
      else setLojaAtual("Todas as lojas");

      const meses = filtrosResp?.mesesDisponiveis || [];
      if (!mesInicio && meses.length) setMesInicio(meses[0]);
      if (!mesFim && meses.length) setMesFim(meses[meses.length - 1]);

      setErr("");
    } catch (e) {
      console.error(e);
      setErr(
        e?.response?.data?.erro ||
        "Erro ao carregar dados dos clientes (admin)."
      );
    } finally {
      setLoading(false);
    }
  }

  // Exportar PDF (Admin)
  async function handleExportPdf() {
    try {
      const token = localStorage.getItem("userToken");
      if (!token) {
        alert("Token não encontrado. Faça login novamente.");
        return;
      }

      const params = {
        storeName: storeName || undefined,
        mesInicio: mesInicio || undefined,
        mesFim: mesFim || undefined,
      };

      const res = await axios.get(
        `${API_BASE}/api/admin/clientes/export/pdf`,
        {
          params,
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        }
      );

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "Relatorio_Clientes_Admin.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Erro ao exportar PDF de clientes (admin).");
    }
  }

  useEffect(() => {
    fetchData({});
  }, []);

  useEffect(() => {
    fetchData({ mesInicio, mesFim, storeName });
  }, [mesInicio, mesFim, storeName]);

  const accent = "#ff7a00";
  const rail = "#1f2835";

  const toChartData = (obj) => ({
    labels: Object.keys(obj || {}),
    datasets: [
      {
        label: "Quantidade",
        data: Object.values(obj || {}),
        backgroundColor: accent,
        borderRadius: 8,
      },
    ],
  });

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: rail }, ticks: { color: "#cdd6e4" } },
      y: {
        grid: { color: rail },
        ticks: { color: "#cdd6e4" },
        beginAtZero: true,
      },
    },
    plugins: { legend: { labels: { color: "#cdd6e4" } } },
  };

  // Heatmap (7 x 24)
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const horas = Array.from({ length: 24 }, (_, h) => h);

  const { flatMax, scaleCell } = useMemo(() => {
    const values = heatmap.flat?.() || [];
    const max = values.length ? Math.max(...values) : 0;
    const scale = (v) =>
      max <= 0 ? 0.12 : Math.min(1, 0.12 + (v / max) * 0.88);
    return { flatMax: max, scaleCell: scale };
  }, [heatmap]);

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Dashboard - Clientes (Admin)</h1>

            <div className="filters">
              {/* Filtro de loja */}
              <div className="field">
                <label>Estabelecimento</label>
                <select
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                >
                  <option value="">Todos</option>
                  {lojas?.map((l) => (
                    <option key={l.id} value={l.nome}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtros de mês */}
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

              {/* Botão para Exportar em PDF */}
              <div className="field">
                <label style={{ visibility: "hidden" }}>.</label>
                <button
                  type="button"
                  className="btn export-btn"
                  onClick={handleExportPdf}
                  style={{
                    width: "auto",
                    paddingInline: 24,
                    whiteSpace: "nowrap",
                  }}
                >
                  Exportar PDF
                </button>
              </div>
            </div>
          </div>

          {err && <div className="errorBox">{err}</div>}
          {loading && <div className="errorBox">Carregando…</div>}

          {/* KPIs */}
          <section className="kpis">
            <div className="kpi">
              <div className="kpi_title">Total de clientes</div>
              <div className="kpi_value">{kpis.total ?? "—"}</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Clientes ativos</div>
              <div className="kpi_value">{kpis.ativos ?? "—"}</div>
              <div className="kpi_hint">{kpis.pctAtivos ?? 0}% do total</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Taxa de recompra</div>
              <div className="kpi_value">{kpis.taxaRecompra ?? 0}%</div>
              <div className="kpi_hint">Clientes com mais de 1 pedido</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Lojas monitoradas</div>
              <div className="kpi_value">{lojas?.length ?? 0}</div>
              <div className="kpi_hint">
                Escopo atual: {storeName || lojaAtual || "Todas as lojas"}
              </div>
            </div>
          </section>

          {/* Gráficos principais */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Clientes por status</div>
              <div className="chartbox">
                <Bar data={toChartData(graficos.status)} options={chartOpts} />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Clientes por faixa etária</div>
              <div className="chartbox">
                <Bar data={toChartData(graficos.faixas)} options={chartOpts} />
              </div>
            </div>
          </div>

          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Distribuição por gênero</div>
              <div className="chartbox">
                <Bar data={toChartData(graficos.genero)} options={chartOpts} />
              </div>
            </div>

            <div className="panel">
              <div className="panel_title">Horários de pico (mapa de calor)</div>
              <div className="heatmap-wrap">
                <div className="heatmap-legend">
                  <span />
                  {horas.map((h) => (
                    <span key={h} className="hm-hour">
                      {h}
                    </span>
                  ))}
                </div>

                <div className="heatmap-grid">
                  {dias.map((d, di) => (
                    <div className="hm-row" key={d}>
                      <div className="hm-day">{d}</div>
                      {horas.map((h) => {
                        const v = heatmap?.[di]?.[h] ?? 0;
                        const a = scaleCell(v);
                        return (
                          <div
                            key={`${di}-${h}`}
                            className="hm-cell"
                            title={`${d} ${h}:00 — ${v} pedidos`}
                            style={{
                              backgroundColor: `rgba(255,122,0,${a})`,
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className="heatmap-scale">
                  <span>Menor</span>
                  <div className="scale-bar">
                    <i style={{ background: "rgba(255,122,0,0.12)" }} />
                    <i style={{ background: "rgba(255,122,0,0.4)" }} />
                    <i style={{ background: "rgba(255,122,0,0.7)" }} />
                    <i style={{ background: "rgba(255,122,0,1.0)" }} />
                  </div>
                  <span>Maior{flatMax ? ` (${flatMax})` : ""}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Aniversariantes */}
          <div className="panel">
            <div className="panel_title">Aniversariantes do mês 🎂</div>
            <ul className="birthday-list">
              {aniversariantes?.length ? (
                aniversariantes.map((n, i) => <li key={i}>{n}</li>)
              ) : (
                <li>Nenhum aniversariante encontrado</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}