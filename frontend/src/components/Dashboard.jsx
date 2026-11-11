import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, ShieldCheck, Clock, Cpu, FileText, CheckCircle2,
  AlertTriangle, Zap, Eye, X, Camera, Receipt, Briefcase, FileCheck,
  Mail, Calendar, ChevronDown, ChevronRight, Search, Layers, ListFilter
} from 'lucide-react';
import { auditAPI, emailAPI } from '../services/api';
import { groupItemsByMonthAndWeek } from '../utils/dateGrouping';

export default function Dashboard({ stats }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grouped'); // 'grouped' | 'flat'
  const [selectedLog, setSelectedLog] = useState(null);

  // Control de acordeones abiertos (Meses y Semanas)
  const [openMonths, setOpenMonths] = useState({});
  const [openWeeks, setOpenWeeks] = useState({});

  const handleSyncGmailDashboard = async () => {
    setSyncingGmail(true);
    setSyncMsg(null);
    try {
      const res = await emailAPI.syncInbox();
      const d = res.data || {};
      if (!d.checked) {
        setSyncMsg(`⚠️ Error IMAP: ${d.reason || 'Verifica GMAIL_APP_PASSWORD'}`);
      } else if (d.downloaded > 0) {
        setSyncMsg(`✅ ${d.downloaded} adjunto(s) descargado(s) desde Gmail (${d.files.join(', ')})`);
        fetchAuditLogs();
        setTimeout(() => fetchAuditLogs(), 3000);
      } else {
        setSyncMsg('📬 Bandeja de Gmail al día (0 adjuntos nuevos pendientes).');
      }
    } catch (e) {
      setSyncMsg('⚠️ No se pudo sincronizar Gmail en este momento.');
    } finally {
      setSyncingGmail(false);
    }
  };

  const fetchAuditLogs = async (filterVal = workflowFilter) => {
    setLoadingLogs(true);
    try {
      const params = { limit: 200 };
      if (filterVal) params.workflow_name = filterVal;
      const res = await auditAPI.getLogs(params);
      setAuditLogs(res.data || []);
    } catch (e) {
      console.error('No se pudieron cargar los logs de auditoría:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [workflowFilter]);

  const formatLogDecision = (log) => {
    const out = log.output_result || {};
    return (
      out.decision ||
      out.action ||
      out.answer_preview ||
      (out.sent ? `Correo enviado a ${out.recipient}` : null) ||
      (out.requires_review === true ? 'REQUIERE_REVISION_HUMANA' : null) ||
      (out.proveedor ? `${out.proveedor} ($${Number(out.monto_total || 0).toLocaleString('es-CO')})` : null) ||
      out.numero_factura ||
      JSON.stringify(out)
    );
  };

  // Filtrado combinado en memoria (búsqueda por texto + estado)
  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const decisionStr = formatLogDecision(log);
      if (statusFilter) {
        if (statusFilter === 'REVIEW') {
          if (log.status !== 'REQUIRES_REVIEW' && !decisionStr.includes('REVISION')) return false;
        } else if (statusFilter === 'SUCCESS') {
          if (log.status !== 'SUCCESS' || decisionStr.includes('REVISION')) return false;
        } else if (statusFilter === 'ERROR') {
          if (log.status !== 'ERROR' && !decisionStr.includes('ERROR')) return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          log.workflow_name,
          log.trigger_source,
          log.ai_provider,
          log.user_email,
          log.input_summary,
          decisionStr
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, statusFilter, searchQuery]);

  // Agrupación jerárquica por Mes -> Semana (excluyendo semanas sin actividad)
  const groupedAudit = useMemo(() => {
    return groupItemsByMonthAndWeek(filteredLogs, 'created_at');
  }, [filteredLogs]);

  // Abrir automáticamente el mes y la semana más reciente cuando cargan los datos
  useEffect(() => {
    if (groupedAudit.length > 0) {
      const latestMonth = groupedAudit[0];
      setOpenMonths((prev) => (Object.keys(prev).length === 0 ? { [latestMonth.monthKey]: true } : prev));
      if (latestMonth.weeks.length > 0) {
        const latestWeekKey = latestMonth.weeks[0].weekKey;
        setOpenWeeks((prev) => (Object.keys(prev).length === 0 ? { [latestWeekKey]: true } : prev));
      }
    }
  }, [groupedAudit]);

  const toggleMonth = (monthKey) => {
    setOpenMonths((prev) => ({ ...prev, [monthKey]: !prev[monthKey] }));
  };

  const toggleWeek = (weekKey) => {
    setOpenWeeks((prev) => ({ ...prev, [weekKey]: !prev[weekKey] }));
  };

  const expandOrCollapseAll = (expand) => {
    if (!expand) {
      setOpenMonths({});
      setOpenWeeks({});
      return;
    }
    const nextM = {};
    const nextW = {};
    groupedAudit.forEach((m) => {
      nextM[m.monthKey] = true;
      m.weeks.forEach((w) => {
        nextW[w.weekKey] = true;
      });
    });
    setOpenMonths(nextM);
    setOpenWeeks(nextW);
  };

  const safeStats = stats || {};
  const totalDocs = safeStats.total || 0;
  const processedDocs = safeStats.processed || 0;
  const needsReviewDocs = safeStats.needs_review || 0;
  const visionDocs = safeStats.vision_count || 0;
  const errorDocs = safeStats.errors || 0;
  const successRate = totalDocs > 0 ? Math.round(((processedDocs + needsReviewDocs) / totalDocs) * 100) : 100;

  const validTimes = auditLogs.map((l) => l.execution_time_ms).filter((t) => t && t > 0);
  const avgLatencyMs =
    validTimes.length > 0 ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length) : 0;

  const getTriggerBadge = (source = '') => {
    if (source.includes('Telegram')) {
      return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">✈️ TelegramBot</span>;
    }
    if (source.includes('Vision')) {
      return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">📸 VisionIA</span>;
    }
    if (source.includes('Human')) {
      return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">👤 HumanLoop</span>;
    }
    if (source.includes('Gmail') || source.includes('SMTP')) {
      return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">📧 GmailPython</span>;
    }
    if (source.includes('WebRAG')) {
      return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">💬 WebRAG</span>;
    }
    if (source.includes('AdminDelete')) {
      return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">🛡️ Ley1581</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">{source || 'Sistema'}</span>;
  };

  const getCategoryIcon = (cat = '') => {
    if (cat.includes('Factura') || cat.includes('Recibo')) return <Receipt className="w-4 h-4 text-indigo-600" />;
    if (cat.includes('Vida') || cat.includes('Laboral')) return <Briefcase className="w-4 h-4 text-emerald-600" />;
    return <FileCheck className="w-4 h-4 text-blue-600" />;
  };

  const renderAuditTableRows = (logsList) =>
    logsList.map((log) => {
      const decision = formatLogDecision(log);
      const badgeStyle =
        log.status === 'SUCCESS' && !decision.includes('REVISION')
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : log.status === 'REQUIRES_REVIEW' || decision.includes('REVISION')
          ? 'bg-amber-50 text-amber-800 border border-amber-200'
          : 'bg-rose-50 text-rose-700 border border-rose-200';

      return (
        <tr
          key={log.id}
          onClick={() => setSelectedLog(log)}
          className="hover:bg-indigo-50/40 transition-colors cursor-pointer"
        >
          <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
            {log.created_at ? new Date(log.created_at).toLocaleString('es-CO') : '-'}
          </td>
          <td className="p-3 font-semibold text-slate-800 whitespace-nowrap text-xs">
            {log.workflow_name}
          </td>
          <td className="p-3 whitespace-nowrap">
            <div>{getTriggerBadge(log.trigger_source)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{log.user_email || 'sistema'}</div>
          </td>
          <td className="p-3 text-xs text-slate-600 whitespace-nowrap">
            <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md font-mono text-[11px]">
              <Cpu className="w-3 h-3 text-indigo-500" />
              {log.ai_provider}
            </span>
          </td>
          <td className="p-3 text-xs text-slate-700 max-w-[210px] truncate" title={log.input_summary}>
            {log.input_summary}
          </td>
          <td className="p-3 text-xs max-w-[220px] truncate" title={decision}>
            <span className={`px-2 py-0.5 rounded-md font-semibold ${badgeStyle}`}>
              {decision}
            </span>
          </td>
          <td className="p-3 text-xs font-bold">
            {log.confidence_score !== null && log.confidence_score !== undefined ? (
              <span className={Number(log.confidence_score) >= 80 ? 'text-indigo-700' : 'text-amber-600'}>
                🎯 {Number(log.confidence_score).toFixed(0)}%
              </span>
            ) : (
              <span className="text-slate-300">-</span>
            )}
          </td>
          <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              {log.execution_time_ms ? `${log.execution_time_ms} ms` : '-'}
            </span>
          </td>
          <td className="p-3 text-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLog(log);
              }}
              className="text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-100 transition-colors cursor-pointer"
              title="Inspeccionar trazabilidad JSON"
            >
              <Eye className="w-4 h-4" />
            </button>
          </td>
        </tr>
      );
    });

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Centro de Control & Auditoría IA</h2>
          <p className="text-sm text-slate-500 mt-1">
            Monitoreo en tiempo real de procesamiento documental, Visión por Computador y flujos en código (LangGraph / LangChain).
          </p>
        </div>
      </div>

      {/* 4 TARJETAS KPI EJECUTIVAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Documentos</p>
            <p className="text-3xl font-black text-slate-900 mt-2">{totalDocs}</p>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-indigo-500" />
              <span><strong>{visionDocs}</strong> por Visión IA · <strong>{Math.max(0, totalDocs - visionDocs)}</strong> PDF/Docx</span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
            <FileText className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Procesados con Éxito</p>
            <p className="text-3xl font-black text-emerald-600 mt-2">{processedDocs}</p>
            <p className="text-xs text-slate-500 mt-2">
              Tasa de efectividad global: <strong className="text-emerald-700">{successRate}%</strong>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Revisión Humana / Alertas</p>
            <div className="flex items-baseline gap-2 mt-2">
              <p className="text-3xl font-black text-amber-600">{needsReviewDocs}</p>
              {errorDocs > 0 && (
                <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  {errorDocs} error(es)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Umbral de confianza Visión IA: <strong>80%</strong>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Velocidad Motor IA</p>
            <p className="text-3xl font-black text-indigo-600 mt-2">
              {avgLatencyMs > 0 ? `${(avgLatencyMs / 1000).toFixed(1)}s` : '1.3s'}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              <strong>{auditLogs.length}</strong> ejecuciones auditadas en PostgreSQL
            </p>
          </div>
          <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <Zap className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* DISTRIBUCIÓN POR CATEGORÍA CON BARRAS DE PROGRESO */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">Distribución Documental por Categoría</h3>
          <span className="text-xs text-slate-400 font-medium">Clasificación automática con Gemini Flash</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(safeStats.categories || {}).map(([cat, count]) => {
            const pct = totalDocs > 0 ? Math.round((count / totalDocs) * 100) : 0;
            return (
              <div key={cat} className="p-4 border border-slate-200/80 rounded-xl bg-slate-50/60 hover:bg-white hover:shadow-xs transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getCategoryIcon(cat)}
                    <span className="text-xs font-bold text-slate-700 line-clamp-1" title={cat}>{cat}</span>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    {pct}%
                  </span>
                </div>
                <p className="text-2xl font-black text-slate-900 mb-2">{count} <span className="text-xs font-normal text-slate-400">docs</span></p>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(8, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PANEL DE AUDITORÍA DE FLUJOS EN CÓDIGO ORGANIZADO POR MES Y SEMANA */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              Historial de Auditoría de Flujos e IA (`workflow_audit_logs`)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Organizado cronológicamente por <strong>Mes y Semana activa</strong> (las semanas sin actividad se omiten automáticamente).
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Selector de Modo de Vista */}
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'grouped'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" /> Por Mes / Semana
              </button>
              <button
                type="button"
                onClick={() => setViewMode('flat')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'flat'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> Lista Continua
              </button>
            </div>

            <button
              onClick={handleSyncGmailDashboard}
              disabled={syncingGmail}
              className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-100 disabled:opacity-60 transition-colors cursor-pointer"
              title="Revisar bandeja de entrada de Gmail por IMAP ahora mismo"
            >
              {syncingGmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              {syncingGmail ? 'Sincronizando...' : '📥 Sincronizar Gmail'}
            </button>
            <button
              onClick={() => fetchAuditLogs()}
              className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {/* BARRA DE BÚSQUEDA Y FILTROS DE AUDITORÍA */}
        <div className="flex flex-wrap items-center gap-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por factura, proveedor, usuario, flujo o decisión..."
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <ListFilter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="">Todos los Flujos ({auditLogs.length})</option>
              <option value="CuentasPorPagar-LangGraph">⚙️ Cuentas por Pagar (LangGraph)</option>
              <option value="VisionPorComputador-Facturas">📸 Visión Computacional (Facturas)</option>
              <option value="ChatbotRAG-LangChain">🧠 Chatbot RAG con Memoria (LangChain)</option>
              <option value="NotificacionCorreo-AprobacionFactura">📧 Correo Aprobación Facturas (SMTP)</option>
              <option value="DecisionGerencial-CorreoInteractivo">✅ Decisión Gerencial desde Correo</option>
              <option value="HeadhunterRRHH-Python">🌟 Headhunter & Scouting RRHH</option>
              <option value="IngestaCorreo-IMAP">📥 Ingesta de Correo (IMAP)</option>
              <option value="HabeasData-SupresionLey1581">🛡️ Supresión Habeas Data (Ley 1581)</option>
            </select>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="">Todos los Resultados</option>
            <option value="SUCCESS">✅ Ejecución Exitosa</option>
            <option value="REVIEW">⚠️ Requiere Revisión Humana</option>
            <option value="ERROR">❌ Con Error</option>
          </select>

          {viewMode === 'grouped' && groupedAudit.length > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={() => expandOrCollapseAll(true)}
                className="text-[11px] font-semibold text-indigo-600 hover:underline px-2 py-1 cursor-pointer"
              >
                Expandir todo
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => expandOrCollapseAll(false)}
                className="text-[11px] font-semibold text-slate-500 hover:underline px-2 py-1 cursor-pointer"
              >
                Contraer todo
              </button>
            </div>
          )}
        </div>

        {syncMsg && (
          <div className="px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
            <span>{syncMsg}</span>
            <button onClick={() => setSyncMsg(null)} className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer">✕</button>
          </div>
        )}

        {/* CONTENIDO PRINCIPAL: VISTA AGRUPADA POR MES -> SEMANA O LISTA CONTINUA */}
        {filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-slate-400 italic border border-dashed border-slate-200 rounded-xl">
            No se encontraron registros de auditoría para los filtros seleccionados.
          </div>
        ) : viewMode === 'grouped' ? (
          <div className="space-y-4">
            {groupedAudit.map((monthGroup) => {
              const isMonthOpen = !!openMonths[monthGroup.monthKey];
              return (
                <div
                  key={monthGroup.monthKey}
                  className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/40"
                >
                  {/* CABECERA DEL MES */}
                  <button
                    type="button"
                    onClick={() => toggleMonth(monthGroup.monthKey)}
                    className="w-full px-5 py-3.5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between hover:opacity-95 transition-opacity cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      {isMonthOpen ? (
                        <ChevronDown className="w-4 h-4 text-indigo-300" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-indigo-300" />
                      )}
                      <Calendar className="w-4 h-4 text-indigo-300" />
                      <span className="text-sm font-bold tracking-wide">{monthGroup.monthLabel}</span>
                      <span className="text-[11px] bg-white/15 text-indigo-100 px-2.5 py-0.5 rounded-full font-semibold">
                        {monthGroup.weeks.length} {monthGroup.weeks.length === 1 ? 'semana con actividad' : 'semanas con actividad'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold bg-indigo-500/30 border border-indigo-400/30 px-3 py-1 rounded-full">
                        {monthGroup.totalItems} {monthGroup.totalItems === 1 ? 'registro' : 'registros'}
                      </span>
                    </div>
                  </button>

                  {/* SEMANAS DENTRO DEL MES */}
                  {isMonthOpen && (
                    <div className="p-4 space-y-3">
                      {monthGroup.weeks.map((weekGroup) => {
                        const isWeekOpen = !!openWeeks[weekGroup.weekKey];
                        const reviewCount = weekGroup.items.filter(
                          (l) => l.status === 'REQUIRES_REVIEW' || formatLogDecision(l).includes('REVISION')
                        ).length;
                        const successCount = weekGroup.items.length - reviewCount;

                        return (
                          <div
                            key={weekGroup.weekKey}
                            className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs"
                          >
                            {/* CABECERA DE LA SEMANA */}
                            <button
                              type="button"
                              onClick={() => toggleWeek(weekGroup.weekKey)}
                              className="w-full px-4 py-3 bg-slate-50 hover:bg-indigo-50/40 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 transition-colors cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5">
                                {isWeekOpen ? (
                                  <ChevronDown className="w-4 h-4 text-indigo-600" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-slate-400" />
                                )}
                                <span className="text-xs font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-md">
                                  {weekGroup.weekTitle}
                                </span>
                                <span className="text-xs font-semibold text-slate-700">
                                  {weekGroup.weekRange}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  ✅ {successCount} exitosos
                                </span>
                                {reviewCount > 0 && (
                                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                                    ⚠️ {reviewCount} en revisión
                                  </span>
                                )}
                                <span className="text-xs font-bold text-slate-500 ml-1">
                                  Total: {weekGroup.items.length}
                                </span>
                              </div>
                            </button>

                            {/* TABLA DE EVENTOS DE ESA SEMANA */}
                            {isWeekOpen && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                  <thead className="bg-slate-50/60 text-slate-500 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider">
                                    <tr>
                                      <th className="p-3">Fecha / Hora</th>
                                      <th className="p-3">Flujo en Código</th>
                                      <th className="p-3">Canal</th>
                                      <th className="p-3">Motor IA</th>
                                      <th className="p-3">Entrada</th>
                                      <th className="p-3">Decisión / Resultado</th>
                                      <th className="p-3">Confianza</th>
                                      <th className="p-3">Tiempo</th>
                                      <th className="p-3 text-center">Detalle</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {renderAuditTableRows(weekGroup.items)}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* MODO LISTA CONTINUA */
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3">Fecha / Hora</th>
                  <th className="p-3">Flujo en Código</th>
                  <th className="p-3">Canal</th>
                  <th className="p-3">Motor IA</th>
                  <th className="p-3">Entrada</th>
                  <th className="p-3">Decisión / Resultado</th>
                  <th className="p-3">Confianza</th>
                  <th className="p-3">Tiempo</th>
                  <th className="p-3 text-center">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {renderAuditTableRows(filteredLogs)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL INSPECTOR DE TRAZABILIDAD JSON */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-indigo-300 font-bold">
                  Registro de Auditoría #{selectedLog.id}
                </span>
                <h4 className="text-base font-bold">{selectedLog.workflow_name}</h4>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block">Motor IA</span>
                  <strong className="text-slate-800 font-mono">{selectedLog.ai_provider}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Canal / Origen</span>
                  <strong className="text-slate-800">{selectedLog.trigger_source}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Usuario</span>
                  <strong className="text-slate-800">{selectedLog.user_email || 'sistema'}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Latencia</span>
                  <strong className="text-indigo-700">{selectedLog.execution_time_ms} ms</strong>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-600 uppercase block mb-1">Resumen de Entrada (`input_summary`)</span>
                <div className="bg-slate-100 p-3 rounded-lg border border-slate-200 text-slate-800 font-medium">
                  {selectedLog.input_summary}
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-600 uppercase block mb-1">Resultado / Decisión Estructurada (`output_result`)</span>
                <pre className="bg-slate-950 text-emerald-400 p-4 rounded-xl overflow-x-auto font-mono text-xs leading-relaxed">
                  {JSON.stringify(selectedLog.output_result, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
