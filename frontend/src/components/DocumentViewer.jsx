import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Download, CheckCircle2, XCircle, Sparkles,
  Eye, AlertTriangle, Edit3, Save, Plus, Trash2, Receipt, ShieldCheck
} from 'lucide-react';
import { documentAPI } from '../services/api';

export default function DocumentViewer({ doc, onClose, onDocUpdated }) {
  const isCV = doc.category && (
    doc.category.includes('Vida') ||
    doc.category.includes('Laboral') ||
    doc.category.includes('Curriculum') ||
    doc.category.includes('CV')
  );
  const isInvoice = doc.category && (
    doc.category.includes('Factura') ||
    doc.category.includes('Recibo') ||
    doc.category.includes('Cobro')
  );
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(doc.filename || '') || (doc.mime_type && doc.mime_type.startsWith('image/'));

  const ext = doc.extracted_data || {};
  const role = sessionStorage.getItem('role') || 'user';
  const canEditVision = role === 'admin' || role === 'user';
  const hasMatchScore = ext.match_score !== undefined && ext.match_score !== null;
  const confScore = ext.confidence_score !== undefined && ext.confidence_score !== null ? Number(ext.confidence_score) : null;
  const needsHumanReview = doc.status === 'Requiere Revisión' || (confScore !== null && confScore < 80);

  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [isEditingVision, setIsEditingVision] = useState(needsHumanReview && canEditVision);
  const [savingVision, setSavingVision] = useState(false);
  const [workflowFeedback, setWorkflowFeedback] = useState(null);

  const [visionForm, setVisionForm] = useState({
    emisor_nombre: ext.emisor_nombre || ext.proveedor || '',
    emisor_nit: ext.emisor_nit || '',
    numero_factura: ext.numero_factura || '',
    fecha_emision: ext.fecha_emision || '',
    moneda: ext.moneda || 'COP',
    monto_total: ext.monto_total ?? ext.total ?? 0,
    concepto_principal: ext.concepto_principal || '',
    items: Array.isArray(ext.items) && ext.items.length > 0
      ? ext.items
      : [{ descripcion: ext.concepto_principal || 'Servicio / Producto facturado', cantidad: 1, precio_unitario: ext.monto_total || 0, subtotal: ext.monto_total || 0 }]
  });

  useEffect(() => {
    let objectUrl = null;
    if (isImage) {
      documentAPI.download(doc.id)
        .then(res => {
          objectUrl = window.URL.createObjectURL(new Blob([res.data], { type: doc.mime_type || 'image/jpeg' }));
          setImagePreviewUrl(objectUrl);
        })
        .catch(err => console.error('No se pudo cargar vista previa de imagen:', err));
    }
    return () => {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id, isImage, doc.mime_type]);

  const handleItemChange = (idx, field, val) => {
    const updatedItems = [...visionForm.items];
    updatedItems[idx] = {
      ...updatedItems[idx],
      [field]: field === 'descripcion' ? val : Number(val) || 0
    };
    if (field === 'cantidad' || field === 'precio_unitario') {
      updatedItems[idx].subtotal = Number(updatedItems[idx].cantidad || 1) * Number(updatedItems[idx].precio_unitario || 0);
    }
    setVisionForm({ ...visionForm, items: updatedItems });
  };

  const handleAddItem = () => {
    setVisionForm({
      ...visionForm,
      items: [...visionForm.items, { descripcion: '', cantidad: 1, precio_unitario: 0, subtotal: 0 }]
    });
  };

  const handleRemoveItem = (idx) => {
    setVisionForm({
      ...visionForm,
      items: visionForm.items.filter((_, i) => i !== idx)
    });
  };

  const handleConfirmVision = async (e) => {
    e.preventDefault();
    setSavingVision(true);
    setWorkflowFeedback(null);
    try {
      const res = await documentAPI.confirmVision(doc.id, {
        ...visionForm,
        action: 'confirm',
        monto_total: Number(visionForm.monto_total) || 0
      });
      setWorkflowFeedback(res.data.workflow_result);
      setIsEditingVision(false);
      if (onDocUpdated && res.data.document) {
        onDocUpdated(res.data.document);
      }
    } catch (err) {
      alert(err.response?.data?.detail || 'Error al confirmar los datos de la factura.');
    } finally {
      setSavingVision(false);
    }
  };

  const handleRejectVision = async () => {
    if (!window.confirm('¿Rechazar esta factura por ser ilegible o inválida? Se moverá a la carpeta "Facturas Rechazadas".')) {
      return;
    }
    setSavingVision(true);
    setWorkflowFeedback(null);
    try {
      const res = await documentAPI.confirmVision(doc.id, {
        ...visionForm,
        action: 'reject',
        monto_total: Number(visionForm.monto_total) || 0
      });
      setWorkflowFeedback(res.data.workflow_result);
      setIsEditingVision(false);
      if (onDocUpdated && res.data.document) {
        onDocUpdated(res.data.document);
      }
    } catch (err) {
      alert(err.response?.data?.detail || 'Error al rechazar la factura.');
    } finally {
      setSavingVision(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center">
          <button onClick={onClose} className="text-blue-600 hover:text-blue-800 mr-4 flex items-center transition-colors cursor-pointer font-medium">
            <ArrowLeft className="w-5 h-5 mr-1" /> Volver
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{doc.filename}</h2>
            {doc.uploaded_by && (
              <p className="text-xs text-slate-400">Subido por: <strong className="text-slate-600">{doc.uploaded_by}</strong></p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
            doc.status === 'Procesado' ? 'bg-emerald-100 text-emerald-800' :
            doc.status === 'Requiere Revisión' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
            'bg-blue-100 text-blue-800'
          }`}>
            Estado: {doc.status}
          </span>
          {confScore !== null && (
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
              confScore >= 80
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : 'bg-amber-50 text-amber-800 border-amber-300'
            }`}>
              🎯 Confianza Visión IA: {confScore.toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1">
        {/* Left side: Detailed Content */}
        <div className="flex-1 bg-white p-6 rounded-xl shadow-sm border border-slate-200 overflow-y-auto space-y-6">
          {/* Categoría & Badge */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Categoría Documental</p>
              <span className="inline-block bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full text-xs font-semibold">
                {doc.category}
              </span>
            </div>
            {hasMatchScore && (
              <div className="text-right">
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider block mb-1">Match Híbrido RAG</span>
                <span className={`text-lg font-black px-3 py-1 rounded-lg border ${
                  Number(ext.match_score) >= 80 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300' 
                    : 'bg-blue-50 text-blue-700 border-blue-300'
                }`}>
                  {ext.match_score}%
                </span>
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* TARJETA ESPECIALIZADA: VISIÓN POR COMPUTADOR (FACTURAS Y RECIBOS) */}
          {/* ================================================================= */}
          {isInvoice && (
            <div className="bg-gradient-to-br from-indigo-50/50 to-slate-50 rounded-xl p-5 border border-indigo-100 space-y-4">
              <div className="flex items-center justify-between border-b border-indigo-200/60 pb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-indigo-950 font-bold text-base">
                  <Receipt className="w-5 h-5 text-indigo-600" />
                  <span>Lectura Inteligente de Factura / Recibo (Cuentas por Pagar)</span>
                </div>
                {canEditVision ? (
                  <button
                    type="button"
                    onClick={() => setIsEditingVision(!isEditingVision)}
                    className="text-xs bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {isEditingVision ? 'Cancelar Edición' : 'Editar / Validar Datos'}
                  </button>
                ) : (
                  <span className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-lg font-semibold">
                    👁️ Modo Auditoría (Solo Lectura)
                  </span>
                )}
              </div>

              {/* Alerta de Validación Humana si confianza < 80% */}
              {needsHumanReview && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 space-y-1">
                    <p className="font-bold text-sm">
                      ⚠️ Requiere Validación Humana (Confianza IA: {confScore !== null ? `${confScore}%` : '<80%'} — Umbral mínimo: 80%)
                    </p>
                    <p>
                      {ext.low_confidence_reason || 'Algunos campos de la imagen presentan baja legibilidad o ambigüedad. Revisa y confirma los valores a continuación antes de ejecutar el flujo contable en PostgreSQL.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Confirmación o Rechazo en Revisión Humana */}
              {workflowFeedback && (
                <div className={`${
                  (workflowFeedback.decision || workflowFeedback.payment_status || '').includes('RECHAZADA')
                    ? 'bg-rose-50 border-rose-300 text-rose-900'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                } border rounded-lg p-4 flex items-start gap-3`}>
                  <ShieldCheck className={`w-5 h-5 shrink-0 mt-0.5 ${
                    (workflowFeedback.decision || workflowFeedback.payment_status || '').includes('RECHAZADA')
                      ? 'text-rose-600'
                      : 'text-emerald-600'
                  }`} />
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-sm">
                      {(workflowFeedback.decision || workflowFeedback.payment_status || '').includes('RECHAZADA')
                        ? '❌ Factura Rechazada en Revisión Humana'
                        : '✅ Validación Humana Confirmada y Flujo Contable Ejecutado'}
                    </p>
                    <p>
                      Estado Contable: <strong>{workflowFeedback.decision || workflowFeedback.payment_status}</strong> | Carpeta destino: <strong>{workflowFeedback.target_folder}</strong>
                    </p>
                    <p>{workflowFeedback.notes}</p>
                  </div>
                </div>
              )}

              {/* MODO FORMULARIO DE VALIDACIÓN HUMANA */}
              {isEditingVision ? (
                <form onSubmit={handleConfirmVision} className="bg-white p-4 rounded-xl border border-indigo-200 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="font-bold text-slate-600 block mb-1">Proveedor / Emisor</label>
                      <input
                        type="text"
                        value={visionForm.emisor_nombre}
                        onChange={e => setVisionForm({ ...visionForm, emisor_nombre: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 block mb-1">NIT / Identificación Fiscal</label>
                      <input
                        type="text"
                        value={visionForm.emisor_nit}
                        onChange={e => setVisionForm({ ...visionForm, emisor_nit: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 block mb-1">Número de Factura / Recibo</label>
                      <input
                        type="text"
                        value={visionForm.numero_factura}
                        onChange={e => setVisionForm({ ...visionForm, numero_factura: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 block mb-1">Fecha de Emisión (YYYY-MM-DD)</label>
                      <input
                        type="text"
                        value={visionForm.fecha_emision}
                        onChange={e => setVisionForm({ ...visionForm, fecha_emision: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 block mb-1">Moneda</label>
                      <input
                        type="text"
                        value={visionForm.moneda}
                        onChange={e => setVisionForm({ ...visionForm, moneda: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 block mb-1">Monto Total (Numérico)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={visionForm.monto_total}
                        onChange={e => setVisionForm({ ...visionForm, monto_total: e.target.value })}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  {/* Edición de Ítems */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-700">Ítems / Líneas de Factura Extraídos</label>
                      <button
                        type="button"
                        onClick={handleAddItem}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Agregar Ítem
                      </button>
                    </div>
                    <div className="space-y-2">
                      {visionForm.items.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center text-xs">
                          <input
                            type="text"
                            placeholder="Descripción del producto o servicio"
                            value={item.descripcion || ''}
                            onChange={e => handleItemChange(idx, 'descripcion', e.target.value)}
                            className="col-span-6 border border-slate-200 rounded px-2 py-1.5"
                          />
                          <input
                            type="number"
                            placeholder="Cant."
                            value={item.cantidad ?? 1}
                            onChange={e => handleItemChange(idx, 'cantidad', e.target.value)}
                            className="col-span-2 border border-slate-200 rounded px-2 py-1.5"
                          />
                          <input
                            type="number"
                            placeholder="Subtotal"
                            value={item.subtotal ?? 0}
                            onChange={e => handleItemChange(idx, 'subtotal', e.target.value)}
                            className="col-span-3 border border-slate-200 rounded px-2 py-1.5"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="col-span-1 text-red-500 hover:text-red-700 flex justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleRejectVision}
                      disabled={savingVision}
                      className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      ❌ Rechazar Factura (Ilegible / Inválida)
                    </button>
                    <button
                      type="submit"
                      disabled={savingVision}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      {savingVision ? 'Validando y Ejecutando Flujo...' : '✅ Confirmar Datos y Ejecutar Flujo Contable'}
                    </button>
                  </div>
                </form>
              ) : (
                /* MODO VISTA ESTRUCTURADA DE FACTURA */
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-white p-4 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-400 block font-medium">Proveedor / Emisor</span>
                      <span className="font-bold text-slate-800 text-sm">{ext.emisor_nombre || ext.proveedor || 'No detectado'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">NIT / ID Fiscal</span>
                      <span className="font-bold text-slate-800">{ext.emisor_nit || 'No especificado'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">N° Factura / Recibo</span>
                      <span className="font-bold text-indigo-700">{ext.numero_factura || 'S/N'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Fecha de Emisión</span>
                      <span className="font-bold text-slate-800">{ext.fecha_emision || 'No indicada'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Monto Total</span>
                      <span className="font-black text-emerald-700 text-sm">
                        ${Number(ext.monto_total ?? ext.total ?? 0).toLocaleString('es-CO')} {ext.moneda || 'COP'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Estado Contable (LangGraph)</span>
                      <span className="font-bold text-slate-800">{ext.estado_contable || doc.status}</span>
                    </div>
                  </div>

                  {/* Tabla de Ítems extraídos */}
                  {Array.isArray(ext.items) && ext.items.length > 0 && (
                    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 text-xs font-bold text-slate-700">
                        Detalle de Productos / Servicios Extraídos ({ext.items.length})
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50/60 text-slate-500 border-b border-slate-100">
                          <tr>
                            <th className="p-2.5">Descripción</th>
                            <th className="p-2.5 text-right">Cant.</th>
                            <th className="p-2.5 text-right">V. Unitario</th>
                            <th className="p-2.5 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ext.items.map((it, idx) => (
                            <tr key={idx}>
                              <td className="p-2.5 font-medium text-slate-800">{it.descripcion}</td>
                              <td className="p-2.5 text-right text-slate-600">{it.cantidad ?? 1}</td>
                              <td className="p-2.5 text-right text-slate-600">
                                ${Number(it.precio_unitario ?? it.subtotal ?? 0).toLocaleString('es-CO')}
                              </td>
                              <td className="p-2.5 text-right font-bold text-slate-800">
                                ${Number(it.subtotal ?? 0).toLocaleString('es-CO')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TARJETA ESPECIALIZADA PARA HOJAS DE VIDA (NIVEL 3) */}
          {isCV && (
            <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 rounded-xl p-5 border border-blue-100 space-y-4">
              <div className="flex items-center gap-2 text-indigo-900 font-bold text-base border-b border-blue-200/60 pb-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Ficha de Scouting & Compatibilidad con Vacante</span>
              </div>

              {/* Vacante Asignada */}
              {ext.vacancy_title && (
                <div className="bg-white p-3 rounded-lg border border-blue-200/80 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-slate-400 uppercase">Vacante Evaluada:</span>
                    <h4 className="text-sm font-bold text-slate-800">{ext.vacancy_title}</h4>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>Puntaje IA: <strong className="text-slate-800">{ext.gemini_score || ext.match_score}%</strong></div>
                    {ext.semantic_score && <div>Similitud Vectorial: <strong className="text-slate-800">{ext.semantic_score}%</strong></div>}
                  </div>
                </div>
              )}

              {/* Datos de contacto y perfil */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-3 rounded-lg border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Postulante</span>
                  <span className="font-bold text-slate-800">{ext.postulante || 'No detectado'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Rol / Especialidad</span>
                  <span className="font-bold text-slate-800">{ext.rol || 'No especificado'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Experiencia</span>
                  <span className="font-bold text-slate-800">{ext.anos_experiencia !== undefined ? `${ext.anos_experiencia} años` : 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Ubicación</span>
                  <span className="font-bold text-slate-800">{ext.contacto_ubicacion || 'No indicada'}</span>
                </div>
              </div>

              {/* Resumen ejecutivo de scouting */}
              {ext.resumen_scouting && (
                <div>
                  <span className="text-xs font-bold text-slate-700 block mb-1">Síntesis Ejecutiva Headhunter (Gemini IA):</span>
                  <p className="text-xs text-slate-700 bg-white p-3 rounded-lg border border-slate-200 leading-relaxed italic">
                    "{ext.resumen_scouting}"
                  </p>
                </div>
              )}

              {/* Habilidades Cumplidas vs Faltantes */}
              {(ext.matched_skills || ext.missing_skills) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div className="bg-white p-3 rounded-lg border border-emerald-200">
                    <span className="text-xs font-bold text-emerald-800 flex items-center gap-1 mb-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Habilidades Cumplidas de la Vacante
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {ext.matched_skills && ext.matched_skills.length > 0 ? (
                        ext.matched_skills.map((s, i) => (
                          <span key={i} className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] px-2 py-0.5 rounded font-medium">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 italic">No registradas</span>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-rose-200">
                    <span className="text-xs font-bold text-rose-800 flex items-center gap-1 mb-2">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" /> Habilidades Faltantes
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {ext.missing_skills && ext.missing_skills.length > 0 ? (
                        ext.missing_skills.map((s, i) => (
                          <span key={i} className="bg-rose-50 text-rose-800 border border-rose-200 text-[11px] px-2 py-0.5 rounded font-medium">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-emerald-700 font-medium">Ninguna brecha detectada</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Resumen General del Documento */}
          <div>
            <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2">Resumen General del Documento</p>
            <p className="text-slate-700 text-sm leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200">
              {doc.summary || "No hay resumen disponible."}
            </p>
          </div>

          {/* Datos Estructurados JSON Crudo */}
          <div>
            <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2">Datos Estructurados Extraídos (JSON)</p>
            <div className="bg-slate-900 border rounded-lg p-4 overflow-x-auto">
              <pre className="text-xs font-mono text-emerald-400 leading-relaxed">
                {JSON.stringify(doc.extracted_data, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        {/* Right side: Image Preview & Actions */}
        <div className="w-full lg:w-96 flex flex-col gap-4">
          {isImage && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
                <Eye className="w-4 h-4 text-indigo-600" />
                Imagen Original Capturada
              </h3>
              {imagePreviewUrl ? (
                <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-950 flex justify-center">
                  <img
                    src={imagePreviewUrl}
                    alt={doc.filename}
                    className="max-h-96 object-contain"
                  />
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  Cargando imagen...
                </div>
              )}
            </div>
          )}

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-2">Acciones Rápidas</h3>
            <button 
              onClick={async () => {
                try {
                  const response = await documentAPI.download(doc.id);
                  const url = window.URL.createObjectURL(new Blob([response.data]));
                  const link = document.createElement('a');
                  link.href = url;
                  link.setAttribute('download', doc.filename);
                  document.body.appendChild(link);
                  link.click();
                  link.parentNode.removeChild(link);
                } catch (error) {
                  console.error("Error al descargar:", error);
                  alert("Error al descargar el archivo.");
                }
              }}
              className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center transition-colors font-semibold text-sm cursor-pointer shadow-sm"
            >
              <Download className="w-4 h-4 mr-2" />
              Descargar Archivo Original
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
