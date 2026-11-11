import { useState, useEffect, useMemo } from 'react';
import {
  UploadCloud, FileText, Trash2, Eye, Folder, FolderPlus, Search,
  AlertCircle, Camera, Image as ImageIcon, ArrowLeft, Receipt, Briefcase,
  Mail, RefreshCw, ShieldCheck, Calendar, Layers, ChevronDown, ChevronRight,
  ArrowUpDown, CheckSquare, FolderInput
} from 'lucide-react';
import { documentAPI, folderAPI, emailAPI } from '../services/api';
import { groupItemsByMonthAndWeek } from '../utils/dateGrouping';
import DocumentViewer from './DocumentViewer';

export default function Repository({ folders, documents, fetchData }) {
  const role = sessionStorage.getItem('role') || 'user';
  const isAdmin = role === 'admin';
  const canOperate = role === 'admin' || role === 'user';
  const [currentFolder, setCurrentFolder] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [gmailBanner, setGmailBanner] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Filtros pasados al backend
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  // Controles de organización para alto volumen de archivos
  const [viewMode, setViewMode] = useState('grouped'); // 'grouped' (Mes/Semana) | 'paginated' (Tabla paginada)
  const [sortBy, setSortBy] = useState('date_desc');
  const [folderGroupTab, setFolderGroupTab] = useState('all'); // 'all' | 'invoices' | 'hr' | 'other'
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Selección múltiple (acciones en lote)
  const [selectedIds, setSelectedIds] = useState([]);
  const [targetMoveFolderId, setTargetMoveFolderId] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  // Acordeones Mes -> Semana
  const [openMonths, setOpenMonths] = useState({});
  const [openWeeks, setOpenWeeks] = useState({});

  // Local state for documents fetched with filters
  const [filteredDocs, setFilteredDocs] = useState([]);

  useEffect(() => {
    const fetchFiltered = async () => {
      try {
        const params = {};
        if (searchFilter) params.filename = searchFilter;
        if (categoryFilter) params.category = categoryFilter;
        if (statusFilter) params.status = statusFilter;
        if (dateFilter) {
          params.start_date = dateFilter;
          params.end_date = dateFilter;
        }
        const res = await documentAPI.getAll(params);
        setFilteredDocs(res.data);
      } catch (e) {
        console.error(e);
      }
    };

    if (!searchFilter && !categoryFilter && !statusFilter && !dateFilter) {
      setFilteredDocs(documents);
    } else {
      const timer = setTimeout(() => {
        fetchFiltered();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchFilter, categoryFilter, statusFilter, dateFilter, documents]);

  // Limpiar selección y reiniciar paginación al cambiar de carpeta o filtros
  useEffect(() => {
    setSelectedIds([]);
    setCurrentPage(1);
  }, [currentFolder, searchFilter, categoryFilter, statusFilter, dateFilter, sortBy]);

  const uploadSingleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    if (currentFolder) {
      formData.append('folder_id', currentFolder.id);
    }
    try {
      await documentAPI.upload(formData);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Error al cargar el documento.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) await uploadSingleFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) await uploadSingleFile(file);
  };

  const handleCreateFolder = async () => {
    const name = prompt('Nombre de la nueva carpeta:');
    if (!name || !name.trim()) return;
    try {
      await folderAPI.create(name.trim());
      fetchData();
    } catch (error) {
      alert('Error creando carpeta');
    }
  };

  const handleSyncGmail = async () => {
    setSyncingGmail(true);
    setGmailBanner(null);
    try {
      const res = await emailAPI.syncInbox();
      const data = res.data || {};
      if (!data.checked) {
        setGmailBanner({
          type: 'error',
          text: `⚠️ No se pudo conectar a Gmail: ${data.reason || 'Verifica GMAIL_APP_PASSWORD en backend/.env'}`
        });
      } else if (data.downloaded > 0) {
        setGmailBanner({
          type: 'success',
          text: `✅ Se descargaron ${data.downloaded} adjunto(s) desde Gmail (${data.files.join(', ')}) en la carpeta "Bandeja Correo". Procesando con IA...`
        });
        fetchData();
        setTimeout(() => fetchData(), 3500);
      } else {
        setGmailBanner({
          type: 'info',
          text: '📬 Bandeja de Gmail sincronizada en vivo: no se encontraron correos nuevos con adjuntos pendientes.'
        });
      }
    } catch (error) {
      setGmailBanner({
        type: 'error',
        text: error.response?.data?.detail || 'Error al sincronizar bandeja de Gmail.'
      });
    } finally {
      setSyncingGmail(false);
    }
  };

  const handleDeleteFolder = async (id) => {
    if (!window.confirm('¿Eliminar esta carpeta?')) return;
    try {
      await folderAPI.delete(id);
      fetchData();
      if (currentFolder && currentFolder.id === id) {
        setCurrentFolder(null);
      }
    } catch (error) {
      alert('Error eliminando carpeta');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar documento de forma permanente?')) return;
    try {
      await documentAPI.delete(id);
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      fetchData();
    } catch (e) {
      alert('Error al eliminar documento');
    }
  };

  // Acciones en lote (Mover o Eliminar seleccionados)
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`¿Eliminar permanentemente los ${selectedIds.length} documentos seleccionados?`)) return;
    setBulkLoading(true);
    try {
      await Promise.all(selectedIds.map((id) => documentAPI.delete(id)));
      setSelectedIds([]);
      fetchData();
    } catch (e) {
      alert('No se pudieron eliminar todos los documentos seleccionados (verifica permisos de rol Admin).');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkMove = async () => {
    if (selectedIds.length === 0 || !targetMoveFolderId) return;
    setBulkLoading(true);
    try {
      const folderIdNum = Number(targetMoveFolderId);
      await Promise.all(
        selectedIds.map((id) => documentAPI.update(id, { folder_id: folderIdNum }))
      );
      setSelectedIds([]);
      setTargetMoveFolderId('');
      fetchData();
    } catch (e) {
      alert('Error moviendo los documentos seleccionados.');
    } finally {
      setBulkLoading(false);
    }
  };

  const hasActiveFilters = Boolean(searchFilter || categoryFilter || statusFilter || dateFilter);

  const getDocAmount = (doc) => {
    const ext = doc?.extracted_data || {};
    return Number(ext.monto_total ?? ext.total ?? 0) || 0;
  };

  const getDocScore = (doc) => {
    const ext = doc?.extracted_data || {};
    if (ext.confidence_score !== undefined && ext.confidence_score !== null) {
      return Number(ext.confidence_score);
    }
    if (ext.match_score !== undefined && ext.match_score !== null) {
      return Number(ext.match_score);
    }
    return -1;
  };

  // Filtrado por carpeta actual + Ordenamiento inteligente
  const sortedDisplayDocs = useMemo(() => {
    const base = filteredDocs.filter((doc) => {
      if (hasActiveFilters) return true;
      return currentFolder ? doc.folder_id === currentFolder.id : doc.folder_id === null;
    });

    const copy = [...base];
    copy.sort((a, b) => {
      if (sortBy === 'date_desc') {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0) || b.id - a.id;
      }
      if (sortBy === 'date_asc') {
        return new Date(a.created_at || 0) - new Date(b.created_at || 0) || a.id - b.id;
      }
      if (sortBy === 'amount_desc') {
        return getDocAmount(b) - getDocAmount(a);
      }
      if (sortBy === 'amount_asc') {
        return getDocAmount(a) - getDocAmount(b);
      }
      if (sortBy === 'confidence_asc') {
        const sa = getDocScore(a) < 0 ? 999 : getDocScore(a);
        const sb = getDocScore(b) < 0 ? 999 : getDocScore(b);
        return sa - sb;
      }
      if (sortBy === 'confidence_desc') {
        return getDocScore(b) - getDocScore(a);
      }
      if (sortBy === 'name_asc') {
        return (a.filename || '').localeCompare(b.filename || '');
      }
      return b.id - a.id;
    });
    return copy;
  }, [filteredDocs, hasActiveFilters, currentFolder, sortBy]);

  // Agrupación por Mes -> Semana (solo semanas con archivos subidos)
  const groupedDocs = useMemo(() => {
    return groupItemsByMonthAndWeek(sortedDisplayDocs, 'created_at');
  }, [sortedDisplayDocs]);

  // Abrir automáticamente el mes y semana más reciente al entrar
  useEffect(() => {
    if (groupedDocs.length > 0) {
      const latestM = groupedDocs[0];
      setOpenMonths((prev) => ({ ...prev, [latestM.monthKey]: prev[latestM.monthKey] ?? true }));
      if (latestM.weeks.length > 0) {
        const latestW = latestM.weeks[0];
        setOpenWeeks((prev) => ({ ...prev, [latestW.weekKey]: prev[latestW.weekKey] ?? true }));
      }
    }
  }, [groupedDocs]);

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
    groupedDocs.forEach((m) => {
      nextM[m.monthKey] = true;
      m.weeks.forEach((w) => {
        nextW[w.weekKey] = true;
      });
    });
    setOpenMonths(nextM);
    setOpenWeeks(nextW);
  };

  const toggleSelectDoc = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectGroup = (docsInGroup) => {
    const ids = docsInGroup.map((d) => d.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  if (selectedDoc) {
    return (
      <DocumentViewer
        doc={selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onDocUpdated={(updatedDoc) => {
          setSelectedDoc(updatedDoc);
          fetchData();
        }}
      />
    );
  }

  const isImageFilename = (name = '') => /\.(jpg|jpeg|png|webp)$/i.test(name);

  const getFolderMetrics = (folderId) => {
    const docsInFolder = documents.filter((d) => d.folder_id === folderId);
    const totalAmount = docsInFolder.reduce((acc, d) => acc + getDocAmount(d), 0);
    const reviewCount = docsInFolder.filter((d) => d.status === 'Requiere Revisión').length;
    return {
      count: docsInFolder.length,
      totalAmount,
      reviewCount
    };
  };

  const classifyFolderType = (name = '') => {
    const n = name.toLowerCase();
    if (n.includes('factura') || n.includes('aprobaci') || n.includes('revisión') || n.includes('cobro')) {
      return 'invoices';
    }
    if (n.includes('talento') || n.includes('candidato') || n.includes('vacante') || n.includes('rrhh')) {
      return 'hr';
    }
    return 'other';
  };

  const visibleFolders = folders.filter((f) => {
    if (folderGroupTab === 'all') return true;
    return classifyFolderType(f.name) === folderGroupTab;
  });

  const getFolderStyle = (name = '') => {
    if (name.includes('Aprobadas') || name.includes('Seleccionados')) return 'border-emerald-200 bg-emerald-50/40 text-emerald-700';
    if (name.includes('Duplicadas') || name.includes('Rechazadas')) return 'border-rose-200 bg-rose-50/40 text-rose-700';
    if (name.includes('Revisión') || name.includes('Pendientes')) return 'border-amber-200 bg-amber-50/40 text-amber-700';
    return 'border-slate-200 bg-white text-blue-600';
  };

  const renderExtractedPreview = (doc) => {
    const ext = doc.extracted_data || {};
    const cat = doc.category || '';

    // Caso 1: Facturas o Recibos
    if (cat.includes('Factura') || cat.includes('Recibo') || cat.includes('Cobro')) {
      const proveedor = ext.emisor_nombre || ext.proveedor || 'Proveedor no detectado';
      const total = Number(ext.monto_total ?? ext.total ?? 0);
      const moneda = ext.moneda || 'COP';
      const numFactura = ext.numero_factura ? `#${ext.numero_factura}` : '';
      const estadoContable = ext.estado_contable;

      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Receipt className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="truncate max-w-[200px]" title={proveedor}>{proveedor}</span>
            {numFactura && <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded">{numFactura}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {total > 0 && (
              <span className="text-xs font-black text-emerald-700">
                ${total.toLocaleString('es-CO')} {moneda}
              </span>
            )}
            {estadoContable && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                estadoContable.includes('APROBADA')
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : estadoContable.includes('DUPLICADA') || estadoContable.includes('RECHAZADA')
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {estadoContable}
              </span>
            )}
          </div>
        </div>
      );
    }

    // Caso 2: Hojas de Vida
    if (cat.includes('Vida') || cat.includes('Laboral') || cat.includes('CV')) {
      const postulante = ext.postulante || 'Candidato';
      const rol = ext.rol || 'Perfil Profesional';
      const score = ext.match_score;
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Briefcase className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate max-w-[180px]">{postulante}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 truncate max-w-[160px]">{rol}</span>
            {score !== undefined && score !== null && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                ⭐ {score}% Match
              </span>
            )}
          </div>
        </div>
      );
    }

    // Caso 3: Otros documentos
    return (
      <p className="text-xs text-slate-500 line-clamp-2 max-w-xs">
        {doc.summary || 'Sin resumen estructurado'}
      </p>
    );
  };

  const renderDocsTable = (docsSubset) => {
    const allInSubsetSelected =
      docsSubset.length > 0 && docsSubset.every((d) => selectedIds.includes(d.id));

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs uppercase font-bold tracking-wider">
            <tr>
              {isAdmin && (
                <th className="p-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allInSubsetSelected}
                    onChange={() => toggleSelectGroup(docsSubset)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    title="Seleccionar todos los documentos de esta sección"
                  />
                </th>
              )}
              <th className="p-3.5">Documento / Fecha & Autor</th>
              <th className="p-3.5">Categoría</th>
              <th className="p-3.5">Resumen Clave / Valor IA</th>
              <th className="p-3.5">Estado & Confianza</th>
              <th className="p-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docsSubset.map((doc) => {
              const confScore = doc.extracted_data?.confidence_score;
              const isSelected = selectedIds.includes(doc.id);
              const createdStr = doc.created_at
                ? new Date(doc.created_at).toLocaleDateString('es-CO', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  })
                : '';

              return (
                <tr
                  key={`doc-${doc.id}`}
                  onClick={() => setSelectedDoc(doc)}
                  className={`transition-colors cursor-pointer ${
                    isSelected ? 'bg-indigo-50/60' : 'hover:bg-slate-50/90'
                  }`}
                >
                  {isAdmin && (
                    <td
                      className="p-3.5 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectDoc(doc.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </td>
                  )}

                  <td className="p-3.5 font-medium text-slate-800">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg border ${
                        isImageFilename(doc.filename)
                          ? 'bg-indigo-50 border-indigo-100 text-indigo-600'
                          : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}>
                        {isImageFilename(doc.filename) ? (
                          <ImageIcon className="w-5 h-5" />
                        ) : (
                          <FileText className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate max-w-[230px]" title={doc.filename}>
                          {doc.filename}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                          {createdStr && <span>📅 {createdStr}</span>}
                          <span>· {doc.uploaded_by ? doc.uploaded_by : 'Subida directa'}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="p-3.5">
                    <span className="inline-block text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                      {doc.category || 'Sin Clasificar'}
                    </span>
                  </td>

                  <td className="p-3.5">
                    {renderExtractedPreview(doc)}
                  </td>

                  <td className="p-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                        doc.status === 'Procesado' ? 'bg-emerald-100 text-emerald-800' :
                        doc.status === 'Requiere Revisión' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                        doc.status === 'Error' ? 'bg-red-100 text-red-700' :
                        (doc.status === 'Procesando' || doc.status === 'Pendiente') ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {doc.status}
                      </span>
                      {confScore !== undefined && confScore !== null && (
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                            Number(confScore) >= 80
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-300'
                          }`}
                          title="Nivel de confianza de Visión Computacional"
                        >
                          🎯 {Number(confScore).toFixed(0)}%
                        </span>
                      )}
                      {doc.status === 'Error' && doc.error_log && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            alert(`Error Técnico:\n\n${doc.error_log}`);
                          }}
                          className="text-red-500 hover:text-red-700 transition-colors"
                          title="Ver detalle del error"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="p-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        className="text-indigo-600 hover:text-indigo-800 transition-colors p-2 rounded-lg hover:bg-indigo-50 cursor-pointer"
                        title="Ver Detalles y Validación Humana"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="text-rose-500 hover:text-rose-700 transition-colors p-2 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Eliminar (Supresión Ley 1581)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Paginación para vista de tabla continua
  const totalPages = Math.max(1, Math.ceil(sortedDisplayDocs.length / pageSize));
  const paginatedDocs = sortedDisplayDocs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Totales de la carpeta actual cuando se está dentro de una carpeta
  const currentFolderTotalAmount = sortedDisplayDocs.reduce((acc, d) => acc + getDocAmount(d), 0);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className="space-y-6 animate-in fade-in duration-300"
    >
      {/* CABECERA */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {currentFolder && (
              <button
                onClick={() => setCurrentFolder(null)}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                title="Volver a la raíz"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-3xl font-bold flex items-center tracking-tight flex-wrap">
              <span
                className="cursor-pointer hover:underline text-slate-900"
                onClick={() => setCurrentFolder(null)}
              >
                Repositorio Inteligente
              </span>
              {currentFolder && (
                <>
                  <span className="mx-2 text-slate-300">/</span>
                  <span className="text-indigo-600">{currentFolder.name}</span>
                </>
              )}
            </h2>
            {currentFolder && currentFolderTotalAmount > 0 && (
              <span className="text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
                💰 Acumulado en carpeta: ${currentFolderTotalAmount.toLocaleString('es-CO')} COP
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Arrastra y suelta documentos (`.pdf`, `.docx`, `.txt`) o fotografías de facturas (`.jpg`, `.png`, `.webp`) para su análisis automático.
          </p>
          <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Ley 1581 de 2012 Activa: Cifrado en reposo (AES-128 + RSA-2048), aislamiento multi-tenant y auditoría de autor.</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canOperate ? (
            <>
              <button
                onClick={handleSyncGmail}
                disabled={syncingGmail}
                className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-60 flex items-center shadow-sm transition-colors font-semibold text-sm cursor-pointer"
                title="Buscar ahora mismo correos con facturas o CVs adjuntos en el Gmail enlazado a tu empresa (IMAP)"
              >
                {syncingGmail ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4 mr-2" />
                )}
                {syncingGmail ? 'Sincronizando Gmail...' : '📥 Sincronizar Gmail'}
              </button>
              {!currentFolder && isAdmin && (
                <button
                  onClick={handleCreateFolder}
                  className="bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl hover:bg-slate-50 flex items-center shadow-xs transition-colors font-semibold text-sm cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 mr-2 text-slate-500" /> Nueva Carpeta
                </button>
              )}
              <label
                className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl cursor-pointer hover:bg-indigo-700 flex items-center shadow-sm transition-colors font-semibold text-sm"
                title="Usar cámara del celular o subir foto de factura"
              >
                <Camera className="w-4 h-4 mr-2" />
                {uploading ? 'Analizando...' : '📸 Capturar Factura'}
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,.jpg,.jpeg,.png,.webp"
                  capture="environment"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
              <label className="bg-blue-600 text-white px-4 py-2.5 rounded-xl cursor-pointer hover:bg-blue-700 flex items-center shadow-sm transition-colors font-semibold text-sm">
                <UploadCloud className="w-4 h-4 mr-2" />
                {uploading ? 'Procesando...' : 'Cargar Archivo / Foto'}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,image/*"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
            </>
          ) : (
            <span className="px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-center gap-1.5">
              👁️ Modo Auditoría Ley 1581 (Solo Lectura)
            </span>
          )}
        </div>
      </div>

      {/* BANNER RESULTADO SINCRONIZACIÓN GMAIL */}
      {gmailBanner && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between text-sm font-medium ${
            gmailBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : gmailBanner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <span>{gmailBanner.text}</span>
          <button
            onClick={() => setGmailBanner(null)}
            className="text-xs font-bold underline ml-4 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* BANNER DRAG & DROP ACTIVO */}
      {dragActive && (
        <div className="border-2 border-dashed border-indigo-500 bg-indigo-50/70 rounded-2xl p-8 text-center text-indigo-800 font-bold animate-pulse">
          📥 Suelta aquí tu archivo o fotografía de factura para procesarla con Gemini Vision + LangGraph
        </div>
      )}

      {/* TARJETAS DE CARPETAS INTELIGENTES CON TOTALES Y PESTAÑAS */}
      {!currentFolder && !hasActiveFilters && folders.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Carpetas de Clasificación Automática ({visibleFolders.length} de {folders.length})
              </h3>
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              {[
                { id: 'all', label: '📁 Todas' },
                { id: 'invoices', label: '🧾 Cuentas por Pagar' },
                { id: 'hr', label: '💼 Talento RRHH' },
                { id: 'other', label: '📥 Bandejas / Otras' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFolderGroupTab(tab.id)}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    folderGroupTab === tab.id
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {visibleFolders.map((folder) => {
              const { count, totalAmount, reviewCount } = getFolderMetrics(folder.id);
              const styleClass = getFolderStyle(folder.name);
              return (
                <div
                  key={`card-folder-${folder.id}`}
                  onClick={() => setCurrentFolder(folder)}
                  className={`p-4 rounded-xl border shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-start justify-between group ${styleClass}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Folder className="w-7 h-7 shrink-0 fill-current opacity-85 mt-0.5" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-bold text-slate-800 truncate group-hover:text-indigo-700" title={folder.name}>
                        {folder.name}
                      </p>
                      <p className="text-xs text-slate-500 font-semibold">
                        {count} {count === 1 ? 'documento' : 'documentos'}
                      </p>
                      {totalAmount > 0 && (
                        <p className="text-[11px] font-black text-emerald-700">
                          💰 ${totalAmount.toLocaleString('es-CO')} COP
                        </p>
                      )}
                      {reviewCount > 0 && (
                        <span className="inline-block text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                          ⚠️ {reviewCount} por revisar
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFolder(folder.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-all cursor-pointer"
                      title="Eliminar carpeta"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BARRA DE FILTROS + ORDENAMIENTO + SELECTOR DE VISTA (MES/SEMANA VS PAGINADA) */}
      <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 relative min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre de archivo..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="min-w-[175px]">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full border border-slate-200 py-1.5 px-3 text-xs font-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
            >
              <option value="">Todas las Categorías</option>
              <option value="Facturas y Cuentas de Cobro">Facturas y Cuentas de Cobro</option>
              <option value="Recibos y Comprobantes de Pago">Recibos y Comprobantes de Pago</option>
              <option value="Contratos y Acuerdos Legales">Contratos y Acuerdos Legales</option>
              <option value="Hojas de Vida / Perfiles Laborales">Hojas de Vida / Perfiles Laborales</option>
              <option value="Sin Clasificar">Sin Clasificar</option>
            </select>
          </div>

          <div className="min-w-[160px]">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-slate-200 py-1.5 px-3 text-xs font-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
            >
              <option value="">Todos los Estados</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Procesando">Procesando</option>
              <option value="Procesado">Procesado</option>
              <option value="Requiere Revisión">Requiere Revisión (&lt;80%)</option>
              <option value="Error">Error</option>
            </select>
          </div>

          <div className="min-w-[140px]">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full border border-slate-200 py-1.5 px-3 text-xs font-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer text-slate-600"
            />
          </div>
        </div>

        {/* SEGUNDA FILA DE CONTROLES: ORDENAR POR + MODO DE VISTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600" /> Ordenar archivos:
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="date_desc">🕒 Más recientes primero</option>
              <option value="date_asc">🕰️ Más antiguos primero</option>
              <option value="amount_desc">💰 Mayor monto ($) primero</option>
              <option value="amount_asc">💵 Menor monto ($) primero</option>
              <option value="confidence_asc">🎯 Menor confianza IA primero (Revisión)</option>
              <option value="confidence_desc">⭐ Mayor confianza / Match % primero</option>
              <option value="name_asc">🔤 Nombre de archivo (A - Z)</option>
            </select>

            <span className="text-xs text-slate-400 font-medium ml-2">
              Mostrando <strong>{sortedDisplayDocs.length}</strong> {sortedDisplayDocs.length === 1 ? 'archivo' : 'archivos'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {viewMode === 'grouped' && groupedDocs.length > 0 && (
              <div className="flex items-center gap-1.5 mr-2">
                <button
                  type="button"
                  onClick={() => expandOrCollapseAll(true)}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                >
                  Expandir todo
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => expandOrCollapseAll(false)}
                  className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer"
                >
                  Contraer todo
                </button>
              </div>
            )}

            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'grouped'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" /> Por Mes / Semana
              </button>
              <button
                type="button"
                onClick={() => setViewMode('paginated')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'paginated'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> Tabla Paginada
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* BARRA DE ACCIONES EN LOTE CUANDO HAY ARCHIVOS SELECCIONADOS (SOLO ADMIN) */}
      {isAdmin && selectedIds.length > 0 && (
        <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-md flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-xs font-bold">
            <CheckSquare className="w-4 h-4 text-indigo-400" />
            <span>{selectedIds.length} documento(s) seleccionado(s)</span>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-slate-400 hover:text-white underline ml-2 font-normal cursor-pointer"
            >
              Deseleccionar
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <FolderInput className="w-4 h-4 text-indigo-300" />
              <select
                value={targetMoveFolderId}
                onChange={(e) => setTargetMoveFolderId(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Mover seleccionados a carpeta...</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📁 {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!targetMoveFolderId || bulkLoading}
                onClick={handleBulkMove}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Mover
              </button>
            </div>

            <button
              type="button"
              disabled={bulkLoading}
              onClick={handleBulkDelete}
              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Eliminar ({selectedIds.length})
            </button>
          </div>
        </div>
      )}

      {/* LISTADO PRINCIPAL DE DOCUMENTOS: AGRUPADO POR MES -> SEMANA O TABLA PAGINADA */}
      {sortedDisplayDocs.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-10 text-center text-slate-400">
          No hay documentos en esta vista. Usa los botones superiores o arrastra una factura aquí.
        </div>
      ) : viewMode === 'grouped' ? (
        <div className="space-y-4">
          {groupedDocs.map((monthGroup) => {
            const isMonthOpen = !!openMonths[monthGroup.monthKey];
            const monthAmount = monthGroup.weeks.reduce(
              (sum, w) => sum + w.items.reduce((s2, d) => s2 + getDocAmount(d), 0),
              0
            );

            return (
              <div
                key={monthGroup.monthKey}
                className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden"
              >
                {/* CABECERA DEL MES */}
                <button
                  type="button"
                  onClick={() => toggleMonth(monthGroup.monthKey)}
                  className="w-full px-5 py-3.5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex flex-wrap items-center justify-between gap-2 hover:opacity-95 transition-opacity cursor-pointer"
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
                      {monthGroup.weeks.length} {monthGroup.weeks.length === 1 ? 'semana activa' : 'semanas activas'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {monthAmount > 0 && (
                      <span className="text-xs font-bold bg-emerald-500/25 border border-emerald-400/30 text-emerald-100 px-3 py-1 rounded-full">
                        💰 ${monthAmount.toLocaleString('es-CO')} COP
                      </span>
                    )}
                    <span className="text-xs font-bold bg-indigo-500/30 border border-indigo-400/30 px-3 py-1 rounded-full">
                      {monthGroup.totalItems} {monthGroup.totalItems === 1 ? 'archivo' : 'archivos'}
                    </span>
                  </div>
                </button>

                {/* SEMANAS DEL MES (SOLO LAS QUE TIENEN ARCHIVOS) */}
                {isMonthOpen && (
                  <div className="p-4 space-y-3 bg-slate-50/40">
                    {monthGroup.weeks.map((weekGroup) => {
                      const isWeekOpen = !!openWeeks[weekGroup.weekKey];
                      const weekAmount = weekGroup.items.reduce((acc, d) => acc + getDocAmount(d), 0);
                      const weekReviews = weekGroup.items.filter(
                        (d) => d.status === 'Requiere Revisión'
                      ).length;

                      return (
                        <div
                          key={weekGroup.weekKey}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs"
                        >
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
                              {weekAmount > 0 && (
                                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  💰 Subtotal: ${weekAmount.toLocaleString('es-CO')} COP
                                </span>
                              )}
                              {weekReviews > 0 && (
                                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                                  ⚠️ {weekReviews} por revisar
                                </span>
                              )}
                              <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-0.5 rounded-full">
                                {weekGroup.items.length} {weekGroup.items.length === 1 ? 'documento' : 'documentos'}
                              </span>
                            </div>
                          </button>

                          {isWeekOpen && renderDocsTable(weekGroup.items)}
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
        /* MODO TABLA PAGINADA */
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          {renderDocsTable(paginatedDocs)}

          {/* CONTROLES DE PAGINACIÓN */}
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>Filas por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="border border-slate-200 rounded-lg px-2 py-1 bg-white font-semibold"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span className="text-slate-400 ml-2">
                Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> ({sortedDisplayDocs.length} documentos)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold cursor-pointer"
              >
                ← Anterior
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold cursor-pointer"
              >
                Siguiente →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
