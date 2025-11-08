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
import "./campaigns.css";
import { buildMensagemEstab } from "../../utils/aiCampaignMessages";

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

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";
const MAX_SUG_POR_GRUPO = 3;
const MAX_IDADE_SUG_HORAS = 24; // Sugestões expíram após 24h

export default function CampaignsEstab() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");
  const [campanhaId, setCampanhaId] = useState("");
  const [lojaNome, setLojaNome] = useState("Estabelecimento");

  const [kpis, setKpis] = useState({});
  const [statusData, setStatusData] = useState([]);
  const [badgeData, setBadgeData] = useState([]);
  const [mesData, setMesData] = useState([]);
  const [filtros, setFiltros] = useState({
    campanhas: [],
    mesesDisponiveis: [],
  });

  // Sugestões da IA
  const [sugestoes, setSugestoes] = useState({
    priorizar: [],
    ajustar_ou_pausar: [],
    outros: [],
  });
  const [errSug, setErrSug] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/estabelecimento/campanhas`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const { meta, kpis, graficos, filtros } = res.data;

      setLojaNome(meta?.loja?.nome || "Estabelecimento");
      setKpis(kpis || {});
      setStatusData(graficos?.status || []);
      setBadgeData(graficos?.badges || []);
      setMesData(graficos?.meses || []);
      setFiltros(filtros || { campanhas: [], mesesDisponiveis: [] });

      if (!mesInicio && filtros?.mesesDisponiveis?.length) {
        setMesInicio(filtros.mesesDisponiveis[0]);
      }
      if (!mesFim && filtros?.mesesDisponiveis?.length) {
        setMesFim(filtros.mesesDisponiveis.at(-1));
      }

      setErr("");
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.erro || "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  // Função para verificar se as sugestões estão desatualizadas
  function sugestoesEstaoDesatualizadas(sug) {
    if (!sug) return true;
    const grupos = ["priorizar", "ajustar_ou_pausar", "outros"];
    let maisRecente = 0;
    let temAlgo = false;

    for (const g of grupos) {
      const arr = Array.isArray(sug[g]) ? sug[g] : [];
      if (arr.length) temAlgo = true;
      for (const item of arr) {
        const t = item.gerado_em ? new Date(item.gerado_em).getTime() : 0;
        if (!Number.isNaN(t) && t > maisRecente) {
          maisRecente = t;
        }
      }
    }

    if (!temAlgo || !maisRecente) return true;

    const diffMs = Date.now() - maisRecente;
    const diffHoras = diffMs / (1000 * 60 * 60);
    return diffHoras > MAX_IDADE_SUG_HORAS;
  }

  // Função para buscar sugestões e opcionalmente disparar o ML se estiver vazio/velho
  async function fetchSugestoesIA({ autoGenerateIfStale = false } = {}) {
    try {
      const token = localStorage.getItem("userToken");
      const headers = { Authorization: `Bearer ${token}` };

      async function doGet() {
        const res = await axios.get(
          `${API_BASE}/api/estabelecimento/campanhas/sugestoes`,
          { headers }
        );
        const data =
          res.data || { priorizar: [], ajustar_ou_pausar: [], outros: [] };
        setSugestoes(data);
        setErrSug("");
        return data;
      }

      let atual = await doGet();

      if (autoGenerateIfStale && sugestoesEstaoDesatualizadas(atual)) {
        try {
          setAiGenerating(true);
          await axios.post(`${API_BASE}/api/executar-ia`, {}, { headers });
          atual = await doGet();
        } finally {
          setAiGenerating(false);
        }
      }

      return atual;
    } catch (e) {
      console.error(e);
      setErrSug("Erro ao carregar sugestões da IA.");
      return {
        priorizar: [],
        ajustar_ou_pausar: [],
        outros: [],
      };
    }
  }

  // 1ª carga: dados + IA (com fallback para gerar se velho/vazio)
  useEffect(() => {
    (async () => {
      await fetchData({});
      await fetchSugestoesIA({ autoGenerateIfStale: true });
    })();
  }, []);

  // Recarrega dados ao mudar filtros
  useEffect(() => {
    if (mesInicio || mesFim || campanhaId) {
      fetchData({ mesInicio, mesFim, campanhaId });
    }
  }, [mesInicio, mesFim, campanhaId]);

  const priorizarTop = useMemo(
    () =>
      (sugestoes.priorizar || [])
        .slice()
        .sort((a, b) => (b.confianca || 0) - (a.confianca || 0))
        .slice(0, MAX_SUG_POR_GRUPO),
    [sugestoes.priorizar]
  );

  const ajustarTop = useMemo(
    () =>
      (sugestoes.ajustar_ou_pausar || [])
        .slice()
        .sort((a, b) => (b.confianca || 0) - (a.confianca || 0))
        .slice(0, MAX_SUG_POR_GRUPO),
    [sugestoes.ajustar_ou_pausar]
  );

  const outrosTop = useMemo(
    () =>
      (sugestoes.outros || [])
        .slice()
        .sort((a, b) => (b.confianca || 0) - (a.confianca || 0))
        .slice(0, MAX_SUG_POR_GRUPO),
    [sugestoes.outros]
  );

  const accent = "#ff7a00";
  const rail = "#1f2835";

  const chartStatus = useMemo(
    () => ({
      labels: statusData.map((s) => s.status_desc),
      datasets: [
        {
          label: "Qtd",
          data: statusData.map((s) => s.qtd),
          backgroundColor: accent,
          borderRadius: 8,
        },
      ],
    }),
    [statusData]
  );

  const chartBadge = useMemo(() => {
    const sorted = [...badgeData].sort((a, b) => b.qtd - a.qtd);
    const top8 = sorted.slice(0, 8);
    const others = sorted.slice(8).reduce((sum, r) => sum + r.qtd, 0);
    const labels = top8.map((b) => b.badge);
    const values = top8.map((b) => b.qtd);
    if (others > 0) {
      labels.push("Outros");
      values.push(others);
    }
    return {
      labels,
      datasets: [
        {
          label: "Qtd",
          data: values,
          backgroundColor: accent,
          borderRadius: 8,
        },
      ],
    };
  }, [badgeData]);

  const chartMes = useMemo(
    () => ({
      labels: mesData.map((m) => m.mes),
      datasets: [
        {
          label: "Qtd",
          data: mesData.map((m) => m.qtd),
          borderColor: accent,
          backgroundColor: "rgba(255,122,0,.2)",
          fill: true,
          tension: 0.35,
        },
      ],
    }),
    [mesData]
  );

  const opts = {
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

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Dashboard - Campanhas ({lojaNome})</h1>
            <div className="filters">
              <div className="field">
                <label>Campanha</label>
                <select
                  value={campanhaId}
                  onChange={(e) => setCampanhaId(e.target.value)}
                >
                  <option value="">Todas</option>
                  {filtros.campanhas?.map((c, i) => (
                    <option key={i} value={c}>
                      {c}
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
            </div>
          </div>

          {err && <div className="errorBox">{err}</div>}
          {loading && <div className="errorBox">Carregando…</div>}

          {/* KPIs */}
          <section className="kpis">
            <div className="kpi">
              <div className="kpi_title">Total de campanhas</div>
              <div className="kpi_value">{kpis.total ?? "—"}</div>
              <div className="kpi_hint">
                Período: {mesInicio || "—"} — {mesFim || "—"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">% Ativas</div>
              <div className="kpi_value">{kpis.ativasPct ?? 0}%</div>
              <div className="kpi_hint">
                Ativas: {kpis.ativas ?? 0} • Demais:{" "}
                {(kpis.total ?? 0) - (kpis.ativas ?? 0)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">% Concluídas</div>
              <div className="kpi_value">{kpis.concluidasPct ?? 0}%</div>
              <div className="kpi_hint">
                Base: {kpis.total ?? 0} campanhas
              </div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Novas no período</div>
              <div className="kpi_value">{kpis.novasPeriodo ?? 0}</div>
              <div className="kpi_hint">
                {mesInicio || mesFim ? "Com filtro de mês" : "Sem filtro de mês"}
              </div>
            </div>
          </section>

          {/* Gráficos */}
          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Campanhas por status</div>
              <div className="chartbox">
                <Bar data={chartStatus} options={opts} />
              </div>
            </div>
            <div className="panel">
              <div className="panel_title">
                Campanhas por badge (Top 8 + Outros)
              </div>
              <div className="chartbox">
                <Bar data={chartBadge} options={opts} />
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel_title">Campanhas por mês</div>
            <div className="chartbox tall">
              <Line data={chartMes} options={opts} />
            </div>
          </div>

          {/* Sugestões da IA */}
          <div className="panel">
            <div className="panel_title">Sugestões da IA para suas campanhas</div>

            {errSug && <div className="errorBox">{errSug}</div>}

            {aiGenerating && (
              <div className="ai-hint">
                Gerando novas sugestões com base nas campanhas mais recentes…
              </div>
            )}

            <div className="ai-hint">
              As sugestões abaixo são feitas automaticamente com base no
              histórico das suas campanhas. Para cada grupo, mostramos até{" "}
              {MAX_SUG_POR_GRUPO} campanhas mais relevantes. Use como apoio na
              decisão de manter, ajustar ou pausar — você continua no controle.
            </div>

            <div className="ai-grid">
              {/* Priorizar */}
              <div className="ai-column">
                <h3>🎯 Priorizar</h3>
                {priorizarTop.length ? (
                  <ul className="ai-list">
                    {priorizarTop.map((s, i) => (
                      <li key={s.campaignId || i} className="ai-card">
                        <div className="ai-card-header">
                          <strong className="ai-name">{s.nome}</strong>
                          <span className="ai-tag">
                            {s.status_previsto} ·{" "}
                            {Math.round((s.confianca || 0) * 100)}%
                          </span>
                        </div>
                        <p className="ai-text">
                          {buildMensagemEstab(s, "priorizar")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ai-empty">
                    Nenhuma campanha em destaque no momento.
                  </div>
                )}
              </div>

              {/* Ajustar / Pausar */}
              <div className="ai-column">
                <h3>⚙️ Ajustar ou pausar</h3>
                {ajustarTop.length ? (
                  <ul className="ai-list">
                    {ajustarTop.map((s, i) => (
                      <li key={s.campaignId || i} className="ai-card warn">
                        <div className="ai-card-header">
                          <strong className="ai-name">{s.nome}</strong>
                          <span className="ai-tag">
                            {s.status_previsto} ·{" "}
                            {Math.round((s.confianca || 0) * 100)}%
                          </span>
                        </div>
                        <p className="ai-text">
                          {buildMensagemEstab(s, "ajustar_ou_pausar")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ai-empty">
                    Nenhuma campanha crítica encontrada.
                  </div>
                )}
              </div>

              {/* Monitorar */}
              <div className="ai-column">
                <h3>👁️ Monitorar</h3>
                {outrosTop.length ? (
                  <ul className="ai-list">
                    {outrosTop.map((s, i) => (
                      <li key={s.campaignId || i} className="ai-card neutral">
                        <div className="ai-card-header">
                          <strong className="ai-name">{s.nome}</strong>
                          <span className="ai-tag">
                            {s.status_previsto} ·{" "}
                            {Math.round((s.confianca || 0) * 100)}%
                          </span>
                        </div>
                        <p className="ai-text">
                          {buildMensagemEstab(s, "outros")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ai-empty">
                    Nenhuma campanha em zona neutra listada.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}