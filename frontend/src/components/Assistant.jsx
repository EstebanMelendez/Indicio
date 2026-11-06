import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, RotateCcw, Send, Bot, User, FileText, Image as ImageIcon,
  Filter, ChevronDown, ChevronUp, CheckCircle2, MessageSquarePlus, Zap
} from 'lucide-react';
import { ragAPI } from '../services/api';

const QUICK_PROMPTS = [
  {
    icon: '💼',
    title: 'Scouting de Candidatos',
    prompt: '¿Qué candidatos tenemos registrados, cuántos años de experiencia tienen y cuál tiene mejor puntaje?'
  },
  {
    icon: '🧾',
    title: 'Resumen de Cuentas por Pagar',
    prompt: '¿Cuáles son todas las facturas y recibos procesados, su proveedor, monto total y estado contable?'
  },
  {
    icon: '📸',
    title: 'Facturas por Visión IA',
    prompt: '¿Qué detalle de ítems, NIT y nivel de confianza tiene la factura de SERVICIOS CLOUD COLOMBIA?'
  },
  {
    icon: '🧠',
    title: 'Prueba de Memoria Conversacional',
    prompt: '¿Quién es Camila Rojas y qué tecnologías domina?'
  }
];

function formatMessageText(text = '') {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    const isBullet = trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ');
    const cleanLine = isBullet ? trimmed.replace(/^([•\-*]\s+)/, '') : line;

    // Renderizar negritas **texto**
    const parts = cleanLine.split(/(\*\*.*?\*\*)/g);
    const renderedParts = parts.map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={pIdx} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    if (isBullet) {
      return (
        <div key={idx} className="flex items-start gap-2 pl-2 my-1">
          <span className="text-indigo-500 font-bold mt-0.5">•</span>
          <span className="flex-1">{renderedParts}</span>
        </div>
      );
    }

    return (
      <p key={idx} className={trimmed === '' ? 'h-2' : 'my-1 leading-relaxed'}>
        {renderedParts}
      </p>
    );
  });
}

export default function Assistant({ documents = [] }) {
  const [query, setQuery] = useState('');
  const [chatLog, setChatLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [showDocFilter, setShowDocFilter] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [sessionId, setSessionId] = useState(() => `web_${Math.random().toString(36).substring(2, 10)}`);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog, loading]);

  const toggleDocSelection = (id) => {
    if (selectedDocs.includes(id)) {
      setSelectedDocs(selectedDocs.filter(d => d !== id));
    } else {
      setSelectedDocs([...selectedDocs, id]);
    }
  };

  const handleResetSession = () => {
    setChatLog([]);
    setSessionId(`web_${Math.random().toString(36).substring(2, 10)}`);
  };

  const sendQuery = async (textToSend) => {
    const cleanQuery = (textToSend ?? query).trim();
    if (!cleanQuery || loading) return;

    const newLog = [...chatLog, { role: 'user', text: cleanQuery, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
    setChatLog(newLog);
    setQuery('');
    setLoading(true);
    try {
      const res = await ragAPI.query(cleanQuery, selectedDocs, sessionId);
      setChatLog([
        ...newLog,
        {
          role: 'ai',
          text: res.data.answer,
          sources: res.data.sources || [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (error) {
      setChatLog([
        ...newLog,
        {
          role: 'ai',
          text: '⚠️ Ocurrió un error al consultar el motor RAG en FastAPI. Verifica la conexión e intenta nuevamente.',
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    sendQuery(query);
  };

  const isImageFile = (name = '') => /\.(jpg|jpeg|png|webp)$/i.test(name);

  const filteredDocuments = documents.filter(d =>
    (d.filename || '').toLowerCase().includes(docSearch.toLowerCase()) ||
    (d.category || '').toLowerCase().includes(docSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] max-h-[860px] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* HEADER EJECUTIVO */}
      <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shadow-inner">
              <Bot className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-bold tracking-tight">Asistente Híbrido RAG + SQL</h2>
                <span className="inline-flex items-center gap-1 bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3 text-indigo-300" />
                  LangChain Memory ({sessionId})
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Combina búsqueda semántica vectorial (`pgvector` 768d) + catálogo estructurado SQL + Visión Computacional
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDocFilter(!showDocFilter)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border font-medium transition-colors cursor-pointer ${
                selectedDocs.length > 0
                  ? 'bg-indigo-600 border-indigo-400 text-white'
                  : 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              {selectedDocs.length === 0
                ? `Todos los documentos (${documents.length})`
                : `${selectedDocs.length} doc(s) filtrados`}
              {showDocFilter ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleResetSession}
              className="inline-flex items-center gap-1.5 text-xs bg-slate-800/80 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer font-medium"
              title="Reiniciar hilo de memoria conversacional"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Nueva Sesión
            </button>
          </div>
        </div>

        {/* PANEL DESPLEGABLE DE FILTRO DE DOCUMENTOS */}
        {showDocFilter && (
          <div className="mt-4 pt-3 border-t border-slate-700/80 animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-2 mb-2">
              <input
                type="text"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Filtrar documentos por nombre o categoría..."
                className="bg-slate-800/90 border border-slate-700 text-xs text-white rounded-lg px-3 py-1.5 w-full max-w-xs focus:outline-none focus:border-indigo-400"
              />
              {selectedDocs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedDocs([])}
                  className="text-xs text-indigo-300 hover:text-white underline cursor-pointer"
                >
                  Limpiar selección ({selectedDocs.length})
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
              {filteredDocuments.map(doc => {
                const isSelected = selectedDocs.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() => toggleDocSelection(doc.id)}
                    type="button"
                    className={`px-2.5 py-1 text-xs rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-400 text-white font-semibold shadow-sm'
                        : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                    title={`${doc.filename} (${doc.category || 'Sin categoría'})`}
                  >
                    {isImageFile(doc.filename) ? (
                      <ImageIcon className="w-3 h-3 text-indigo-300" />
                    ) : (
                      <FileText className="w-3 h-3 text-slate-400" />
                    )}
                    <span className="truncate max-w-[180px]">{doc.filename}</span>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-emerald-300" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ÁREA DE CONVERSACIÓN */}
      <div className="flex-1 p-6 overflow-y-auto bg-slate-50/60 space-y-5">
        {chatLog.length === 0 ? (
          <div className="max-w-3xl mx-auto my-6 space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mb-1 shadow-sm">
                <Sparkles className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-slate-800">
                ¿Qué deseas consultar hoy en el repositorio empresarial?
              </h3>
              <p className="text-sm text-slate-500 max-w-xl mx-auto">
                Pregunta por facturas escaneadas con Visión IA, montos contables, contratos o candidatos.
                El agente recuerda el contexto de tus preguntas anteriores en esta sesión.
              </p>
            </div>

            {/* TARJETAS DE PREGUNTAS SUGERIDAS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QUICK_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendQuery(item.prompt)}
                  className="text-left p-4 rounded-xl bg-white border border-slate-200/90 hover:border-indigo-400 hover:shadow-md transition-all group cursor-pointer flex items-start gap-3"
                >
                  <span className="text-2xl bg-slate-50 group-hover:bg-indigo-50 p-2.5 rounded-lg border border-slate-100 transition-colors">
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-indigo-950 group-hover:text-indigo-600 flex items-center justify-between">
                      <span>{item.title}</span>
                      <Zap className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-indigo-500 transition-opacity" />
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                      "{item.prompt}"
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          chatLog.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <div key={i} className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-1 shadow-sm">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[82%] rounded-2xl px-5 py-3.5 shadow-sm ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-br-xs'
                      : msg.isError
                      ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-bl-xs'
                      : 'bg-white border border-slate-200/90 text-slate-800 rounded-bl-xs'
                  }`}
                >
                  <div className={`text-sm ${isUser ? 'text-white' : 'text-slate-700'}`}>
                    {isUser ? <p className="whitespace-pre-wrap">{msg.text}</p> : formatMessageText(msg.text)}
                  </div>

                  {/* CHIPS INTERACTIVOS DE FUENTES CONSULTADAS */}
                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        📚 Fuentes Verificadas ({msg.sources.length}):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.sources.map((src, sIdx) => (
                          <span
                            key={sIdx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
                          >
                            {isImageFile(src) ? (
                              <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-blue-600" />
                            )}
                            {src}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.timestamp && (
                    <div className={`text-[10px] mt-1.5 text-right ${isUser ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {msg.timestamp}
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center shrink-0 mt-1 shadow-sm">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-xs px-5 py-3.5 shadow-sm flex items-center gap-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.15s]" />
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
              <span className="text-xs font-medium text-slate-500">
                Consultando vectores `pgvector` + catálogo SQL con memoria LangChain...
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* BARRA INFERIOR DE ENTRADA */}
      <form onSubmit={handleChatSubmit} className="p-4 border-t border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Escribe tu pregunta... (ej: ¿Cuáles son las facturas aprobadas? o ¿Y cuál es el NIT de la primera?)"
              className="w-full border border-slate-300 rounded-xl pl-4 pr-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" />
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}
