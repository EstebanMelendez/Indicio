import React from 'react';
import { ArrowLeft, Download, CheckCircle2, XCircle, Award, Sparkles, Building2, User, Phone, MapPin, GraduationCap } from 'lucide-react';
import { documentAPI } from '../services/api';

export default function DocumentViewer({ doc, onClose }) {
  const isCV = doc.category && (doc.category.includes('Vida') || doc.category.includes('Laboral') || doc.category.includes('Curriculum') || doc.category.includes('CV'));
  const ext = doc.extracted_data || {};
  const hasMatchScore = ext.match_score !== undefined && ext.match_score !== null;

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      <div className="flex items-center mb-6">
        <button onClick={onClose} className="text-blue-600 hover:text-blue-800 mr-4 flex items-center transition-colors cursor-pointer font-medium">
          <ArrowLeft className="w-5 h-5 mr-1" /> Volver
        </button>
        <h2 className="text-2xl font-bold text-slate-800">{doc.filename}</h2>
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

        {/* Right side: Actions */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
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
