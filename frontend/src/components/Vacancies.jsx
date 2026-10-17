import React, { useState, useEffect } from 'react';
import { 
  Briefcase, Plus, Trophy, Award, CheckCircle2, XCircle, 
  FileText, UploadCloud, RefreshCw, Eye, Download, Trash2, 
  Sparkles, X, ChevronRight, AlertCircle, Building2, Clock, Check
} from 'lucide-react';
import { vacancyAPI, documentAPI } from '../services/api';
import DocumentViewer from './DocumentViewer';

export default function Vacancies({ documents, fetchData }) {
  const [vacancies, setVacancies] = useState([]);
  const [selectedVacancy, setSelectedVacancy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [evaluatingDocId, setEvaluatingDocId] = useState(null);
  const [uploadingCV, setUploadingCV] = useState(false);
  const [selectedExistingDocId, setSelectedExistingDocId] = useState('');

  // Form State for New Vacancy
  const [formTitle, setFormTitle] = useState('');
  const [formDept, setFormDept] = useState('Tecnología');
  const [formMinExp, setFormMinExp] = useState(2);
  const [formDescription, setFormDescription] = useState('');
  const [formRequirements, setFormRequirements] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [skillsList, setSkillsList] = useState(['Python', 'React', 'FastAPI', 'PostgreSQL']);

  useEffect(() => {
    loadVacancies();
  }, []);

  const loadVacancies = async () => {
    setLoading(true);
    try {
      const res = await vacancyAPI.getAll();
      setVacancies(res.data);
      if (selectedVacancy) {
        const updated = res.data.find(v => v.id === selectedVacancy.id);
        if (updated) {
          loadVacancyDetail(updated.id);
        }
      }
    } catch (err) {
      console.error("Error al cargar vacantes:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadVacancyDetail = async (id) => {
    try {
      const res = await vacancyAPI.getById(id);
      setSelectedVacancy(res.data);
    } catch (err) {
      console.error("Error al cargar detalle de vacante:", err);
    }
  };

  const handleAddSkill = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const trimmed = skillInput.trim().replace(',', '');
      if (trimmed && !skillsList.includes(trimmed)) {
        setSkillsList([...skillsList, trimmed]);
        setSkillInput('');
      }
    }
  };

  const handleRemoveSkill = (skillToRemove) => {
    setSkillsList(skillsList.filter(s => s !== skillToRemove));
  };

  const handleCreateVacancy = async (e) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDescription.trim() || !formRequirements.trim()) {
      alert("Por favor completa los campos obligatorios: Título, Descripción y Requisitos.");
      return;
    }

    try {
      setLoading(true);
      await vacancyAPI.create({
        title: formTitle.trim(),
        department: formDept.trim(),
        min_years_experience: parseInt(formMinExp) || 0,
        description: formDescription.trim(),
        requirements: formRequirements.trim(),
        required_skills: skillsList,
        status: "Abierta"
      });
      setIsModalOpen(false);
      resetForm();
      await loadVacancies();
      if (fetchData) fetchData();
    } catch (err) {
      console.error("Error al crear vacante:", err);
      alert("Error al guardar la vacante.");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormDept('Tecnología');
    setFormMinExp(2);
    setFormDescription('');
    setFormRequirements('');
    setSkillsList(['Python', 'React', 'FastAPI', 'PostgreSQL']);
    setSkillInput('');
  };

  const handleDeleteVacancy = async (id, e) => {
    e.stopPropagation();
    if (confirm("¿Seguro que deseas eliminar esta vacante? Los candidatos asociados pasarán a estado sin vacante.")) {
      try {
        await vacancyAPI.delete(id);
        if (selectedVacancy && selectedVacancy.id === id) {
          setSelectedVacancy(null);
        }
        await loadVacancies();
        if (fetchData) fetchData();
      } catch (err) {
        console.error("Error al eliminar vacante:", err);
        alert("Error al eliminar la vacante.");
      }
    }
  };

  const handleUploadCVToVacancy = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedVacancy) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('vacancy_id', selectedVacancy.id);

    try {
      setUploadingCV(true);
      await documentAPI.upload(formData);
      alert("¡Currículum subido! El emparejamiento híbrido con Gemini y pgvector ha iniciado en segundo plano.");
      setTimeout(() => {
        loadVacancyDetail(selectedVacancy.id);
        loadVacancies();
        if (fetchData) fetchData();
      }, 3500);
    } catch (err) {
      console.error("Error al subir CV:", err);
      alert("Error al subir el currículum.");
    } finally {
      setUploadingCV(false);
      e.target.value = null;
    }
  };

  const handleMatchExistingDocument = async () => {
    if (!selectedExistingDocId || !selectedVacancy) return;
    try {
      setEvaluatingDocId(parseInt(selectedExistingDocId));
      const res = await vacancyAPI.matchDocument(selectedVacancy.id, selectedExistingDocId);
      alert(`¡Evaluación completada! Match Score Híbrido: ${res.data.match_score}%`);
      await loadVacancyDetail(selectedVacancy.id);
      await loadVacancies();
      if (fetchData) fetchData();
    } catch (err) {
      console.error("Error al evaluar match:", err);
      alert("Error al evaluar el documento contra la vacante.");
    } finally {
      setEvaluatingDocId(null);
      setSelectedExistingDocId('');
    }
  };

  const handleRematch = async (docId) => {
    if (!selectedVacancy) return;
    try {
      setEvaluatingDocId(docId);
      const res = await vacancyAPI.matchDocument(selectedVacancy.id, docId);
      alert(`¡Re-evaluación completada! Nuevo Match Score: ${res.data.match_score}%`);
      await loadVacancyDetail(selectedVacancy.id);
      await loadVacancies();
      if (fetchData) fetchData();
    } catch (err) {
      console.error("Error al re-evaluar:", err);
      alert("Error al re-evaluar.");
    } finally {
      setEvaluatingDocId(null);
    }
  };

  // Metrics
  const totalVacancies = vacancies.length;
  const openVacancies = vacancies.filter(v => v.status === 'Abierta').length;
  const totalCandidates = vacancies.reduce((acc, v) => acc + (v.candidates_count || 0), 0);
  const highestScoreGlobal = vacancies.reduce((max, v) => Math.max(max, v.top_score || 0), 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header & Stats Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white rounded-2xl p-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-500/20 border border-blue-400/30 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-blue-300 mb-3">
              <Sparkles className="w-3.5 h-3.5" /> Reclutamiento Autónomo RAG (Nivel 3)
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight">Gestión Multivacante & Matching Híbrido</h2>
            <p className="text-slate-300 mt-2 max-w-2xl text-sm leading-relaxed">
              Define perfiles de contratación y evalúa automáticamente a cada candidato mediante la combinación de 
              <strong> Inteligencia Cognitiva (Gemini IA)</strong> y <strong>Similitud Semántica Vectorial (pgvector)</strong>.
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg hover:shadow-indigo-500/25 transition-all cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-5 h-5" /> Nueva Vacante
          </button>
        </div>

        {/* Global KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-white/10">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">Total Vacantes</span>
            <div className="text-2xl font-bold mt-1 text-white">{totalVacancies}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">Vacantes Abiertas</span>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{openVacancies}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">Candidatos Evaluados</span>
            <div className="text-2xl font-bold mt-1 text-blue-400">{totalCandidates}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">Top Match Global</span>
            <div className="text-2xl font-bold mt-1 text-amber-400">{highestScoreGlobal > 0 ? `${highestScoreGlobal}%` : 'N/A'}</div>
          </div>
        </div>
      </div>

      {/* Main Content: Vacancy Detail OR Vacancies Grid */}
      {selectedVacancy ? (
        /* VISTA DETALLE Y LEADERBOARD DE LA VACANTE */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedVacancy(null)}
              className="text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer transition-colors"
            >
              ← Volver a todas las vacantes
            </button>
            <span className="text-xs bg-slate-200 text-slate-700 px-3 py-1 rounded-full font-medium">
              ID Vacante: #{selectedVacancy.id}
            </span>
          </div>

          {/* Vacancy Info Banner */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-2xl font-bold text-slate-900">{selectedVacancy.title}</h3>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                    selectedVacancy.status === 'Abierta' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {selectedVacancy.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500 mt-2">
                  <span className="flex items-center gap-1"><Building2 className="w-4 h-4 text-slate-400" /> {selectedVacancy.department}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><Clock className="w-4 h-4 text-slate-400" /> Mínimo {selectedVacancy.min_years_experience} años de experiencia</span>
                  <span>•</span>
                  <span>{selectedVacancy.candidates ? selectedVacancy.candidates.length : 0} candidatos postulados</span>
                </div>
              </div>

              {/* Upload CV Action */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer shadow-sm transition-colors">
                  <UploadCloud className="w-4 h-4" />
                  {uploadingCV ? "Procesando..." : "Subir CV a esta Vacante"}
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={handleUploadCVToVacancy}
                    className="hidden"
                    disabled={uploadingCV}
                  />
                </label>
              </div>
            </div>

            {/* Quick Skills list */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase mr-1">Skills Requeridas:</span>
              {selectedVacancy.required_skills && selectedVacancy.required_skills.map((skill, idx) => (
                <span key={idx} className="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-md font-medium">
                  {skill}
                </span>
              ))}
            </div>

            {/* Existing Documents Match Bar */}
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span>¿Tienes un CV ya cargado en el Repositorio? Pruébalo contra esta vacante:</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedExistingDocId}
                  onChange={(e) => setSelectedExistingDocId(e.target.value)}
                  className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Seleccionar CV existente...</option>
                  {documents && documents.map(d => (
                    <option key={d.id} value={d.id}>
                      #{d.id} - {d.filename} ({d.category})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleMatchExistingDocument}
                  disabled={!selectedExistingDocId || evaluatingDocId !== null}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer"
                >
                  {evaluatingDocId === parseInt(selectedExistingDocId) ? "Evaluando..." : "Evaluar Match"}
                </button>
              </div>
            </div>
          </div>

          {/* LEADERBOARD DE CANDIDATOS */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Trophy className="w-6 h-6 text-amber-500" />
                <h4 className="text-xl font-bold text-slate-900">Ranking de Candidatos (Leaderboard Híbrido)</h4>
              </div>
              <span className="text-xs text-slate-500">
                Ordenado por puntuación híbrida descendente
              </span>
            </div>

            {(!selectedVacancy.candidates || selectedVacancy.candidates.length === 0) ? (
              <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <h5 className="text-base font-semibold text-slate-700">Aún no hay candidatos postulados a esta vacante</h5>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Sube un currículum con el botón superior o asocia un documento existente para ver el ranking automático.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {selectedVacancy.candidates.map((cand, idx) => {
                  const data = cand.extracted_data || {};
                  const score = Number(data.match_score) || 0;
                  const geminiScore = Number(data.gemini_score) || 0;
                  const semanticScore = Number(data.semantic_score) || 0;
                  const isTop1 = idx === 0 && score >= 75;
                  const isTop2 = idx === 1 && score >= 70;
                  const isTop3 = idx === 2 && score >= 65;

                  let scoreBadgeColor = "bg-slate-100 text-slate-700 border-slate-300";
                  if (score >= 80) scoreBadgeColor = "bg-emerald-50 text-emerald-700 border-emerald-300";
                  else if (score >= 65) scoreBadgeColor = "bg-blue-50 text-blue-700 border-blue-300";
                  else if (score >= 50) scoreBadgeColor = "bg-amber-50 text-amber-700 border-amber-300";
                  else scoreBadgeColor = "bg-rose-50 text-rose-700 border-rose-300";

                  return (
                    <div
                      key={cand.id}
                      className={`p-5 rounded-xl border transition-all ${
                        isTop1 ? "border-amber-300 bg-amber-50/20 shadow-md ring-1 ring-amber-200" : "border-slate-200 bg-white hover:border-slate-300 shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Candidate Basic Info */}
                        <div className="flex items-start gap-4 flex-1">
                          {/* Rank Badge */}
                          <div className="flex-shrink-0 mt-1">
                            {isTop1 ? (
                              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                                🥇
                              </div>
                            ) : isTop2 ? (
                              <div className="w-10 h-10 rounded-xl bg-slate-300 text-slate-800 flex items-center justify-center font-bold text-lg shadow-sm">
                                🥈
                              </div>
                            ) : isTop3 ? (
                              <div className="w-10 h-10 rounded-xl bg-amber-700 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                                🥉
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-sm">
                                #{idx + 1}
                              </div>
                            )}
                          </div>

                          {/* Details */}
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h5 className="text-lg font-bold text-slate-900">
                                {data.postulante || cand.filename}
                              </h5>
                              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                                {cand.filename}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-slate-600 mt-0.5">
                              💼 {data.rol || 'Cargo no especificado'} • ⏳ {data.anos_experiencia || 0} años exp.
                            </p>
                            {data.resumen_scouting && (
                              <p className="text-xs text-slate-600 mt-2 bg-slate-50 p-2.5 rounded border border-slate-200/60 leading-relaxed italic">
                                "{data.resumen_scouting}"
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Match Score Display */}
                        <div className="flex items-center gap-6 flex-shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0">
                          <div className="text-center">
                            <div className={`text-2xl font-black px-4 py-1.5 rounded-xl border ${scoreBadgeColor}`}>
                              {score}%
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-1">
                              Match Híbrido
                            </span>
                            {/* Breakdown */}
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              IA: <strong className="text-slate-700">{geminiScore}%</strong> • Vector: <strong className="text-slate-700">{semanticScore}%</strong>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => setPreviewDoc(cand)}
                              className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold px-3 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" /> Ver Ficha
                            </button>
                            <button
                              onClick={() => handleRematch(cand.id)}
                              disabled={evaluatingDocId === cand.id}
                              className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium px-3 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${evaluatingDocId === cand.id ? 'animate-spin' : ''}`} />
                              {evaluatingDocId === cand.id ? "Evaluando" : "Re-evaluar"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Skills Matching Breakdown */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
                        {/* Matched */}
                        <div>
                          <span className="font-semibold text-emerald-700 flex items-center gap-1 mb-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Habilidades Cumplidas:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {data.matched_skills && data.matched_skills.length > 0 ? (
                              data.matched_skills.map((s, i) => (
                                <span key={i} className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                                  {s}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400 italic">No especificadas explícitamente</span>
                            )}
                          </div>
                        </div>

                        {/* Missing */}
                        <div>
                          <span className="font-semibold text-rose-700 flex items-center gap-1 mb-1.5">
                            <XCircle className="w-3.5 h-3.5 text-rose-600" /> Habilidades Faltantes:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {data.missing_skills && data.missing_skills.length > 0 ? (
                              data.missing_skills.map((s, i) => (
                                <span key={i} className="bg-rose-50 text-rose-800 border border-rose-200 px-2 py-0.5 rounded font-medium">
                                  {s}
                                </span>
                              ))
                            ) : (
                              <span className="text-emerald-600 font-medium flex items-center gap-1">
                                <Check className="w-3 h-3" /> Ninguna brecha crítica detectada
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* GRID DE VACANTES REGISTRADAS */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-blue-600" /> Convocatorias y Vacantes Activas
            </h3>
            <span className="text-xs text-slate-500">
              Selecciona una vacante para consultar su ranking de compatibilidad
            </span>
          </div>

          {vacancies.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
              <Briefcase className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h4 className="text-lg font-bold text-slate-800">No hay vacantes creadas aún</h4>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto mb-6">
                Crea tu primera vacante con sus requisitos y tecnologías para que el motor RAG de Gemini y pgvector califique automáticamente a los candidatos.
              </p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
              >
                + Crear Primera Vacante
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vacancies.map((vac) => {
                const topScore = vac.top_score || 0;
                let badgeClass = "bg-slate-100 text-slate-700";
                if (topScore >= 80) badgeClass = "bg-emerald-100 text-emerald-800 font-bold";
                else if (topScore >= 60) badgeClass = "bg-blue-100 text-blue-800";

                return (
                  <div
                    key={vac.id}
                    onClick={() => loadVacancyDetail(vac.id)}
                    className="bg-white rounded-xl border border-slate-200 hover:border-blue-400 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      {/* Top status */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {vac.status}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => handleDeleteVacancy(vac.id, e)}
                            className="text-slate-400 hover:text-red-600 p-1 rounded transition-colors"
                            title="Eliminar vacante"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Title & Dept */}
                      <h4 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {vac.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" /> {vac.department} • Exp: {vac.min_years_experience}+ años
                      </p>

                      {/* Description excerpt */}
                      <p className="text-xs text-slate-600 mt-3 line-clamp-2 leading-relaxed">
                        {vac.description}
                      </p>

                      {/* Skills chips */}
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {vac.required_skills && vac.required_skills.slice(0, 4).map((s, idx) => (
                          <span key={idx} className="bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 rounded font-medium">
                            {s}
                          </span>
                        ))}
                        {vac.required_skills && vac.required_skills.length > 4 && (
                          <span className="text-[11px] text-slate-400 px-1 py-0.5">
                            +{vac.required_skills.length - 4} más
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Footer metrics */}
                    <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-[11px] text-slate-400 uppercase font-semibold block">Postulantes</span>
                        <span className="text-base font-bold text-slate-800">{vac.candidates_count || 0}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-slate-400 uppercase font-semibold block">Top Match</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>
                          {topScore > 0 ? `${topScore}%` : 'Sin datos'}
                        </span>
                      </div>
                      <div className="text-blue-600 group-hover:translate-x-1 transition-transform">
                        <ChevronRight className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL CREAR NUEVA VACANTE */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 to-indigo-900 text-white p-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">Crear Nueva Vacante Corporativa</h3>
                <p className="text-xs text-slate-300 mt-1">El motor vectorial de pgvector y Gemini indexarán estos requisitos para calificar a los candidatos.</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateVacancy} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Título del Puesto *</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="ej: Desarrollador Full Stack Python / React"
                    className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Departamento</label>
                  <input
                    type="text"
                    value={formDept}
                    onChange={(e) => setFormDept(e.target.value)}
                    placeholder="ej: Tecnología, Finanzas, Producto"
                    className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Años Mínimos de Experiencia Corporativa</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={formMinExp}
                  onChange={(e) => setFormMinExp(e.target.value)}
                  className="w-full md:w-1/3 text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Skills Tags Input */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase block mb-1">
                  Habilidades & Tecnologías Requeridas (Escribe y presiona Enter o coma)
                </label>
                <div className="flex flex-wrap gap-2 p-2 border border-slate-300 rounded-lg min-h-[46px] bg-slate-50">
                  {skillsList.map((skill, index) => (
                    <span key={index} className="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm">
                      {skill}
                      <button type="button" onClick={() => handleRemoveSkill(skill)} className="hover:text-red-600 font-bold">×</button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={handleAddSkill}
                    placeholder="Agregar skill (ej: Docker, AWS)..."
                    className="bg-transparent text-sm focus:outline-none flex-1 min-w-[140px]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Descripción del Cargo *</label>
                <textarea
                  required
                  rows="3"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Describe las principales responsabilidades, objetivos y el entorno de trabajo..."
                  className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Requisitos Técnicos y de Perfil *</label>
                <textarea
                  required
                  rows="3"
                  value={formRequirements}
                  onChange={(e) => setFormRequirements(e.target.value)}
                  placeholder="Detalla los conocimientos requeridos, certificaciones deseadas y formación académica..."
                  className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? "Creando y Vectorizando..." : "Guardar y Publicar Vacante"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PREVISUALIZADOR MODAL DE DOCUMENTO */}
      {previewDoc && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-100 border-b flex justify-between items-center">
              <span className="font-bold text-slate-800 text-sm">Ficha Técnica del Postulante</span>
              <button onClick={() => setPreviewDoc(null)} className="text-slate-500 hover:text-slate-800 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-y-auto">
              <DocumentViewer doc={previewDoc} onClose={() => setPreviewDoc(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
