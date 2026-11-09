import { useState, useEffect } from 'react';
import {
  UploadCloud, FileText, Trash2, Eye, Folder, FolderPlus, Search,
  AlertCircle, Camera, Image as ImageIcon, ArrowLeft, Receipt, Briefcase, Mail, RefreshCw
} from 'lucide-react';
import { documentAPI, folderAPI, emailAPI } from '../services/api';
import DocumentViewer from './DocumentViewer';

export default function Repository({ folders, documents, fetchData }) {
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
      fetchData();
    } catch (e) {
      alert('Error al eliminar documento');
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

  const hasActiveFilters = Boolean(searchFilter || categoryFilter || statusFilter || dateFilter);

  const displayDocs = filteredDocs.filter(doc => {
    if (hasActiveFilters) return true;
    return currentFolder ? doc.folder_id === currentFolder.id : doc.folder_id === null;
  });

  const isImageFilename = (name = '') => /\.(jpg|jpeg|png|webp)$/i.test(name);

  const getFolderDocCount = (folderId) => documents.filter(d => d.folder_id === folderId).length;

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
          <div className="flex items-center gap-2">
            {currentFolder && (
              <button
                onClick={() => setCurrentFolder(null)}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                title="Volver a la raíz"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-3xl font-bold flex items-center tracking-tight">
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
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Arrastra y suelta documentos (`.pdf`, `.docx`, `.txt`) o fotografías de facturas (`.jpg`, `.png`, `.webp`) para su análisis automático.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSyncGmail}
            disabled={syncingGmail}
            className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-60 flex items-center shadow-sm transition-colors font-semibold text-sm cursor-pointer"
            title="Buscar ahora mismo correos con facturas o CVs adjuntos en Gmail (IMAP)"
          >
            {syncingGmail ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Mail className="w-4 h-4 mr-2" />
            )}
            {syncingGmail ? 'Sincronizando Gmail...' : '📥 Sincronizar Gmail'}
          </button>
          {!currentFolder && (
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

      {/* BARRA DE FILTROS */}
      <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 flex flex-wrap gap-3 items-center">
        <div className="flex-1 relative min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre de archivo..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="min-w-[180px]">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="w-full border border-slate-200 py-2 px-3 text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
          >
            <option value="">Todas las Categorías</option>
            <option value="Facturas y Cuentas de Cobro">Facturas y Cuentas de Cobro</option>
            <option value="Recibos y Comprobantes de Pago">Recibos y Comprobantes de Pago</option>
            <option value="Contratos y Acuerdos Legales">Contratos y Acuerdos Legales</option>
            <option value="Hojas de Vida / Perfiles Laborales">Hojas de Vida / Perfiles Laborales</option>
            <option value="Sin Clasificar">Sin Clasificar</option>
          </select>
        </div>
        <div className="min-w-[170px]">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full border border-slate-200 py-2 px-3 text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
          >
            <option value="">Todos los Estados</option>
            <option value="Pendiente">Pendiente</option>
            <option value="Procesando">Procesando</option>
            <option value="Procesado">Procesado</option>
            <option value="Requiere Revisión">Requiere Revisión (&lt;80%)</option>
            <option value="Error">Error</option>
          </select>
        </div>
        <div className="min-w-[150px]">
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="w-full border border-slate-200 py-2 px-3 text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer text-slate-600"
          />
        </div>
      </div>

      {/* TARJETAS DE CARPETAS INTELIGENTES (ESTILO GOOGLE DRIVE) */}
      {!currentFolder && !hasActiveFilters && folders.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Carpetas de Clasificación Automática ({folders.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {folders.map(folder => {
              const count = getFolderDocCount(folder.id);
              const styleClass = getFolderStyle(folder.name);
              return (
                <div
                  key={`card-folder-${folder.id}`}
                  onClick={() => setCurrentFolder(folder)}
                  className={`p-4 rounded-xl border shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group ${styleClass}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Folder className="w-7 h-7 shrink-0 fill-current opacity-85" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate group-hover:text-indigo-700">
                        {folder.name}
                      </p>
                      <p className="text-xs text-slate-500 font-medium">
                        {count} {count === 1 ? 'documento' : 'documentos'}
                      </p>
                    </div>
                  </div>
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TABLA DE DOCUMENTOS ENRIQUECIDA */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs uppercase font-bold tracking-wider">
            <tr>
              <th className="p-4">Documento / Autor</th>
              <th className="p-4">Categoría</th>
              <th className="p-4">Resumen Clave / Valor IA</th>
              <th className="p-4">Estado & Confianza</th>
              <th className="p-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayDocs.map(doc => {
              const confScore = doc.extracted_data?.confidence_score;
              return (
                <tr
                  key={`doc-${doc.id}`}
                  onClick={() => setSelectedDoc(doc)}
                  className="hover:bg-slate-50/90 transition-colors cursor-pointer"
                >
                  <td className="p-4 font-medium text-slate-800">
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
                        <div className="text-sm font-bold text-slate-800 truncate max-w-[240px]" title={doc.filename}>
                          {doc.filename}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {doc.uploaded_by ? `Por: ${doc.uploaded_by}` : 'Subida directa'}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="p-4">
                    <span className="inline-block text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                      {doc.category || 'Sin Clasificar'}
                    </span>
                  </td>

                  <td className="p-4">
                    {renderExtractedPreview(doc)}
                  </td>

                  <td className="p-4">
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

                  <td className="p-4 text-right" onClick={e => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        className="text-indigo-600 hover:text-indigo-800 transition-colors p-2 rounded-lg hover:bg-indigo-50 cursor-pointer"
                        title="Ver Detalles y Validación Humana"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="text-rose-500 hover:text-rose-700 transition-colors p-2 rounded-lg hover:bg-rose-50 cursor-pointer"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {displayDocs.length === 0 && (
              <tr>
                <td colSpan="5" className="p-10 text-center text-slate-400">
                  No hay documentos en esta vista. Usa los botones superiores o arrastra una factura aquí.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
