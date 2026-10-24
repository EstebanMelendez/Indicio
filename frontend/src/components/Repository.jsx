import { useState, useEffect } from 'react';
import { UploadCloud, FileText, Trash2, Eye, Folder, FolderPlus, Search, AlertCircle } from 'lucide-react';
import { documentAPI, folderAPI } from '../services/api';
import DocumentViewer from './DocumentViewer';

export default function Repository({ folders, documents, fetchData }) {
  const [currentFolder, setCurrentFolder] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  
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
    
    // Si no hay filtros activos, usamos la lista pre-cargada
    if (!searchFilter && !categoryFilter && !statusFilter && !dateFilter) {
      setFilteredDocs(documents);
    } else {
      // Debounce simple para no saturar al tipear
      const timer = setTimeout(() => {
        fetchFiltered();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchFilter, categoryFilter, statusFilter, dateFilter, documents]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    if (currentFolder) {
      formData.append('folder_id', currentFolder.id);
    }
    try {
      await documentAPI.upload(formData);
      fetchData(); // Refresca lista global
    } catch (error) {
      alert(error.response?.data?.detail || "Error al cargar el documento.");
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    const name = prompt("Nombre de la nueva carpeta:");
    if (!name || !name.trim()) return;
    try {
      await folderAPI.create(name.trim());
      fetchData();
    } catch (error) {
      alert("Error creando carpeta");
    }
  };

  const handleDeleteFolder = async (id) => {
    if(!window.confirm("¿Eliminar esta carpeta?")) return;
    try {
      await folderAPI.delete(id);
      fetchData();
      if (currentFolder && currentFolder.id === id) {
        setCurrentFolder(null);
      }
    } catch (error) {
      alert("Error eliminando carpeta");
    }
  };

  const handleDelete = async (id) => {
    if(!window.confirm("¿Eliminar documento de forma permanente?")) return;
    try {
      await documentAPI.delete(id);
      fetchData();
    } catch (e) {
      alert("Error al eliminar documento");
    }
  };

  if (selectedDoc) {
    return <DocumentViewer doc={selectedDoc} onClose={() => setSelectedDoc(null)} />;
  }

  // Filtrado final en memoria (solo para separar por carpeta)
  const hasActiveFilters = Boolean(searchFilter || categoryFilter || statusFilter || dateFilter);

  const displayDocs = filteredDocs.filter(doc => {
    if (hasActiveFilters) return true; // Búsqueda global a través de todas las carpetas si hay filtros activos
    const isFolderMatch = currentFolder ? doc.folder_id === currentFolder.id : doc.folder_id === null;
    return isFolderMatch;
  });

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
           <h2 className="text-3xl font-bold flex items-center">
              <span className="cursor-pointer hover:underline text-slate-800" onClick={() => setCurrentFolder(null)}>Repositorio</span>
              {currentFolder && (
                  <>
                      <span className="mx-2 text-slate-400">/</span>
                      <span className="text-blue-600">{currentFolder.name}</span>
                  </>
              )}
           </h2>
        </div>
        <div className="flex gap-2">
            {!currentFolder && (
              <button onClick={handleCreateFolder} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-300 flex items-center shadow-sm transition-colors font-medium">
                <FolderPlus className="w-5 h-5 mr-2" /> Nueva Carpeta
              </button>
            )}
            <label className="bg-blue-600 text-white px-4 py-2 rounded-lg cursor-pointer hover:bg-blue-700 flex items-center shadow-sm transition-colors font-medium">
              <UploadCloud className="w-5 h-5 mr-2" />
              {uploading ? 'Procesando...' : 'Cargar Archivo'}
              <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} disabled={uploading} />
            </label>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-wrap gap-4 items-center">
          <div className="flex-1 relative min-w-[200px]">
              <Search className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
              <input type="text" placeholder="Buscar por nombre..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow" />
          </div>
          <div className="min-w-[150px]">
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full border border-slate-200 py-2 px-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer">
                  <option value="">Todas las Categorías</option>
                  <option value="Facturas y Cuentas de Cobro">Facturas y Cuentas de Cobro</option>
                  <option value="Contratos y Acuerdos Legales">Contratos y Acuerdos Legales</option>
                  <option value="Hojas de Vida / Perfiles Laborales">Hojas de Vida / Perfiles Laborales</option>
                  <option value="Sin Clasificar">Sin Clasificar</option>
              </select>
          </div>
          <div className="min-w-[150px]">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full border border-slate-200 py-2 px-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer">
                  <option value="">Todos los Estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Procesando">Procesando</option>
                  <option value="Procesado">Procesado</option>
                  <option value="Error">Error</option>
              </select>
          </div>
          <div className="min-w-[150px]">
              <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="w-full border border-slate-200 py-2 px-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer text-slate-600" />
          </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-4 font-semibold">Nombre</th>
              <th className="p-4 font-semibold">Categoría</th>
              <th className="p-4 font-semibold">Estado</th>
              <th className="p-4 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* Folders (only show if currentFolder is null and no filters) */}
            {!currentFolder && searchFilter === '' && categoryFilter === '' && statusFilter === '' && dateFilter === '' && folders.map(folder => (
              <tr key={`folder-${folder.id}`} className="hover:bg-slate-50 transition-colors cursor-pointer group" onClick={() => setCurrentFolder(folder)}>
                  <td className="p-4 font-medium text-slate-800 flex items-center">
                      <Folder className="w-6 h-6 mr-3 text-blue-400 group-hover:text-blue-600 transition-colors" />
                      {folder.name}
                  </td>
                  <td className="p-4 text-slate-400">-</td>
                  <td className="p-4 text-slate-400">-</td>
                  <td className="p-4 flex items-center" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDeleteFolder(folder.id)} className="text-red-500 hover:text-red-700 transition-colors p-1 rounded hover:bg-red-50" title="Eliminar Carpeta">
                      <Trash2 className="w-5 h-5"/>
                    </button>
                  </td>
              </tr>
            ))}
            
            {/* Documents */}
            {displayDocs.map(doc => (
              <tr key={`doc-${doc.id}`} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 font-medium text-slate-800 flex items-center">
                    <FileText className="w-5 h-5 mr-3 text-slate-400" />
                    {doc.filename}
                </td>
                <td className="p-4 text-slate-600">{doc.category}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold ${
                      doc.status === 'Procesado' ? 'bg-emerald-100 text-emerald-700' : 
                      doc.status === 'Error' ? 'bg-red-100 text-red-700' : 
                      (doc.status === 'Procesando' || doc.status === 'Pendiente') ? 'bg-blue-100 text-blue-700' : 
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {doc.status}
                    </span>
                    {doc.status === 'Error' && doc.error_log && (
                      <button onClick={() => alert(`Error Técnico:\n\n${doc.error_log}`)} className="text-red-500 hover:text-red-700 transition-colors" title="Ver detalle del error">
                          <AlertCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
                <td className="p-4 flex items-center">
                  <button onClick={() => setSelectedDoc(doc)} className="text-blue-500 hover:text-blue-700 mr-3 transition-colors p-1 rounded hover:bg-blue-50" title="Ver Detalles">
                    <Eye className="w-5 h-5"/>
                  </button>
                  <button onClick={() => handleDelete(doc.id)} className="text-red-500 hover:text-red-700 transition-colors p-1 rounded hover:bg-red-50" title="Eliminar">
                    <Trash2 className="w-5 h-5"/>
                  </button>
                </td>
              </tr>
            ))}
            {displayDocs.length === 0 && (!folders.length || currentFolder) && (
                <tr>
                    <td colSpan="4" className="p-8 text-center text-slate-500">
                        No hay documentos para mostrar.
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
