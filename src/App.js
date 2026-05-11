import { useState, useMemo, useCallback, useEffect, createContext, useContext, Component } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ComposedChart
} from "recharts";

// ─── CONSTANTS & COLOURS ─────────────────────────────────────────────────────
const C = {
  bg:        "#0d1117",
  surface:   "rgba(255,255,255,0.03)",
  border:    "rgba(255,255,255,0.07)",
  borderMed: "rgba(255,255,255,0.12)",
  text:      "#e2e8f0",
  muted:     "rgba(255,255,255,0.4)",
  faint:     "rgba(255,255,255,0.15)",
  model:     "#3b82f6",
  asis:      "#10b981",
  gap:       "#ef4444",
  warn:      "#f59e0b",
  OT:        "#f59e0b",
  CPMO:      "#8b5cf6",
  PMO:       "#06b6d4",
  EPCM:      "#3b82f6",
  UG:        "#8b5cf6",
  SF:        "#10b981",
  font:      "Calibri, sans-serif",
};
const ENTITY_COLORS = { OT: C.OT, CPMO: C.CPMO, PMO: C.PMO, EPCM: C.EPCM };
const PHASE_COLORS  = { PFS: "#f59e0b", FS: "#8b5cf6", FEED: "#06b6d4", Execution: "#3b82f6" };
const SCENARIO_PAL  = ["#3b82f6","#f59e0b","#10b981","#ef4444","#8b5cf6","#06b6d4"];

// ─── PROJECTS CONTEXT ─────────────────────────────────────────────────────────
const ProjectsCtx = createContext({
  projects: [], addProject: () => {}, goToProjectSettings: () => {},
  MODEL_MH:[], MODEL_FTE:[], MODEL_COST:[],
  ASIS_MH:[], ASIS_FTE:[], ASIS_COST:[],
  ENT_MODEL:{ OT:[], CPMO:[], PMO:[], EPCM:[] },
  ENT_ASIS:{  OT:[], CPMO:[], PMO:[], EPCM:[] },
  DISC_MODEL:{ Mining:{fte:[],cost:[]}, ProcessTSF:{fte:[],cost:[]} },
  DISC_ASIS:{  Mining:{fte:[],cost:[]}, ProcessTSF:{fte:[],cost:[]} },
  PMD_RATIOS:{ Mining:{}, Full:{} },
  PHASE_DURATIONS:{},
  RATE_CARDS:{ OT:269, CPMO:256, PMO:240, EPCM:304 },
  RAMP_SHAPES:{},
});

// ─── MONTHS ───────────────────────────────────────────────────────────────────
const MONTHS = ["Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26","Jul 26","Aug 26","Sep 26","Oct 26","Nov 26","Dec 26","Jan 27","Feb 27","Mar 27","Apr 27","May 27","Jun 27","Jul 27","Aug 27","Sep 27","Oct 27","Nov 27","Dec 27","Jan 28","Feb 28","Mar 28","Apr 28","May 28","Jun 28","Jul 28","Aug 28","Sep 28","Oct 28","Nov 28","Dec 28","Jan 29","Feb 29","Mar 29","Apr 29","May 29","Jun 29","Jul 29","Aug 29","Sep 29","Oct 29","Nov 29","Dec 29","Jan 30","Feb 30","Mar 30","Apr 30","May 30","Jun 30","Jul 30","Aug 30","Sep 30","Oct 30","Nov 30","Dec 30","Jan 31","Feb 31","Mar 31","Apr 31","May 31","Jun 31","Jul 31","Aug 31","Sep 31","Oct 31","Nov 31","Dec 31","Jan 32","Feb 32","Mar 32","Apr 32","May 32","Jun 32","Jul 32","Aug 32","Sep 32","Oct 32","Nov 32","Dec 32","Jan 33","Feb 33","Mar 33","Apr 33","May 33","Jun 33"];
const YEARS  = ["2026","2027","2028","2029","2030","2031","2032","2033"];

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SB_URL = process.env.REACT_APP_SUPABASE_URL || "https://cjozixuffjzaridfrnud.supabase.co";
const SB_KEY = process.env.REACT_APP_SUPABASE_KEY || "sb_publishable_7EUyFz_CFk3lf3BPtYpp6A_fU1ik5ZG";
const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function sbFetch(path, params = "") {
  const r = await fetch(`${SB_URL}/rest/v1/${path}${params}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase fetch failed: ${path} ${r.status}`);
  return r.json();
}

async function saveProjectToSupabase(project) {
  const upsertHeaders = {
    ...sbHeaders,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
  };

  // 1. Write the project row
  const projectRow = {
    id:         project.id,
    name:       project.name,
    type:       project.type,
    phase:      project.phase,
    complexity: project.complexity || "High",
    finish:     project.finish || null,
    capex:      project._meta?.capex ? parseFloat(project._meta.capex) : null,
    start_idx:  project.startIdx,
    end_idx:    project.endIdx,
    has_asis:   false,
    is_custom:  true,
    model_mh:   project.model_mh,
    model_fte:  project.model_fte,
    model_cost: project.model_cost,
    asis_mh:    0, asis_fte: 0, asis_cost: 0,
    scope_mining:   project._meta?.scope?.mining   || false,
    scope_process:  project._meta?.scope?.process  || false,
    scope_tsf:      project._meta?.scope?.tsf      || false,
    scope_surface:  project._meta?.scope?.surface  || false,
  };

  const r1 = await fetch(`${SB_URL}/rest/v1/projects`, {
    method: "POST", headers: upsertHeaders, body: JSON.stringify(projectRow),
  });
  if (!r1.ok) throw new Error(`Failed to save project: ${await r1.text()}`);

  // 2. Write the 90 monthly data rows
  const monthlyRows = Array.from({ length: 90 }, (_, i) => ({
    project_id: project.id,
    month_idx:  i,
    model_fte:  project.fte[i]            || 0,
    model_cost: project.cost[i]           || 0,
    asis_fte:   0,
    asis_cost:  0,
    ot_fte:     project.entities.OT[i]   || 0,
    cpmo_fte:   project.entities.CPMO[i] || 0,
    pmo_fte:    project.entities.PMO[i]  || 0,
    epcm_fte:   project.entities.EPCM[i] || 0,
  }));

  const r2 = await fetch(`${SB_URL}/rest/v1/project_monthly_data`, {
    method: "POST", headers: upsertHeaders, body: JSON.stringify(monthlyRows),
  });
  if (!r2.ok) throw new Error(`Failed to save monthly data: ${await r2.text()}`);
}

// ─── PORTFOLIO RECOMPUTE ──────────────────────────────────────────────────────
// Recomputes portfolio_monthly_data by summing all project monthly arrays.
// Called after any project edit, recalculation, or actuals update.
async function recomputePortfolio() {
  // Fetch all project monthly data
  const allMonthly = await sbFetch(
    "project_monthly_data",
    "?select=month_idx,model_fte,model_cost,asis_fte,asis_cost,ot_fte,cpmo_fte,pmo_fte,epcm_fte&order=month_idx.asc"
  );

  // Aggregate by month
  const portfolio = Array.from({length:90}, (_,i) => ({
    month_idx:       i,
    model_fte:       0, model_mh:       0, model_cost:      0,
    asis_fte:        0, asis_mh:        0, asis_cost:       0,
    ot_model_fte:    0, cpmo_model_fte: 0, pmo_model_fte:   0, epcm_model_fte:  0,
    ot_asis_fte:     0, cpmo_asis_fte:  0, pmo_asis_fte:    0, epcm_asis_fte:   0,
    mining_model_fte: 0, process_model_fte: 0,
    mining_asis_fte:  0, process_asis_fte:  0,
    mining_model_cost: 0, process_model_cost: 0,
    mining_asis_cost:  0, process_asis_cost:  0,
  }));

  for (const row of allMonthly) {
    const m = row.month_idx;
    if (m < 0 || m > 89) continue;
    portfolio[m].model_fte      += row.model_fte  || 0;
    portfolio[m].model_mh       += (row.model_fte || 0) * 160;
    portfolio[m].model_cost     += row.model_cost || 0;
    portfolio[m].asis_fte       += row.asis_fte   || 0;
    portfolio[m].asis_mh        += (row.asis_fte  || 0) * 160;
    portfolio[m].asis_cost      += row.asis_cost  || 0;
    portfolio[m].ot_model_fte   += row.ot_fte     || 0;
    portfolio[m].cpmo_model_fte += row.cpmo_fte   || 0;
    portfolio[m].pmo_model_fte  += row.pmo_fte    || 0;
    portfolio[m].epcm_model_fte += row.epcm_fte   || 0;
  }

  // Round values
  portfolio.forEach(p => {
    p.model_fte       = +p.model_fte.toFixed(2);
    p.model_mh        = Math.round(p.model_mh);
    p.model_cost      = Math.round(p.model_cost);
    p.asis_fte        = +p.asis_fte.toFixed(2);
    p.asis_mh         = Math.round(p.asis_mh);
    p.asis_cost       = Math.round(p.asis_cost);
    p.ot_model_fte    = +p.ot_model_fte.toFixed(2);
    p.cpmo_model_fte  = +p.cpmo_model_fte.toFixed(2);
    p.pmo_model_fte   = +p.pmo_model_fte.toFixed(2);
    p.epcm_model_fte  = +p.epcm_model_fte.toFixed(2);
  });

  // Upsert portfolio rows
  const upsertHeaders = {
    ...sbHeaders,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
  };

  for (let i = 0; i < portfolio.length; i += 90) {
    const r = await fetch(`${SB_URL}/rest/v1/portfolio_monthly_data`, {
      method:"POST", headers:upsertHeaders,
      body: JSON.stringify(portfolio.slice(i, i+90)),
    });
    if (!r.ok) throw new Error(`Portfolio recompute failed: ${await r.text()}`);
  }
}
// For EDITING existing projects: scale existing monthly arrays proportionally.
// This is identical to the Excel methodology (verified: linear scaling confirmed).
//
// Algorithm:
//   1. Fetch current monthly data from Supabase
//   2. Compute new PM&D cost from changed inputs
//   3. scale = new_pmd_cost / old_pmd_cost
//   4. new_arrays = old_arrays × scale (for capex/scope changes)
//   5. If duration changed: apply ramp shape over new duration at new peak FTE
//   6. Upsert new monthly rows back to Supabase
//
async function recalculateProject(projectId, form, modelConfig, currentProject) {
  const { PMD_RATIOS, RAMP_SHAPES, PHASE_DURATIONS } = modelConfig;

  const phaseKey     = `${form.phase} ${form.complexity}`;
  const hasFullScope = form.scope_process || form.scope_tsf || form.scope_surface;
  const scopeType    = hasFullScope ? "Full" : "Mining";

  // Fetch current monthly data from Supabase
  const currentMonthly = await sbFetch(
    "project_monthly_data",
    `?project_id=eq.${projectId}&select=*&order=month_idx.asc`
  );

  // Current peak FTE and cost (from existing arrays)
  const currentPeakFte   = Math.max(...currentMonthly.map(r => r.model_fte  || 0));
  const currentMonthlyCk = Math.max(...currentMonthly.map(r => r.model_cost || 0));
  const currentModelCost = currentProject?.model_cost || 0; // ZARm

  // New PM&D cost from form inputs
  // model_cost is the total PM&D budget. For existing projects we use it directly.
  // If capex changed, derive new model_cost from PMD ratio.
  const newCapex     = parseFloat(form.capex) || 0;
  const oldCapex     = currentProject?.capex  || newCapex;

  let newModelCostZARm;
  if (newCapex > 0 && oldCapex > 0) {
    // Scale model_cost proportionally to capex change
    // (capex is execution capital; PM&D scales linearly with it)
    newModelCostZARm = currentModelCost * (newCapex / oldCapex);
  } else {
    newModelCostZARm = currentModelCost;
  }

  // If phase or complexity changed, also apply the ratio change
  const oldPhaseKey  = `${currentProject?.phase || form.phase} ${currentProject?.complexity || form.complexity}`;
  const oldScopeType = (currentProject?.scope_process || currentProject?.scope_tsf || currentProject?.scope_surface)
    ? "Full" : "Mining";

  if ((form.phase !== currentProject?.phase || form.complexity !== currentProject?.complexity) &&
      PMD_RATIOS?.[scopeType]?.[phaseKey] && PMD_RATIOS?.[oldScopeType]?.[oldPhaseKey]) {
    const newRatio = PMD_RATIOS[scopeType][phaseKey];
    const oldRatio = PMD_RATIOS[oldScopeType][oldPhaseKey];
    if (oldRatio > 0) {
      newModelCostZARm = newModelCostZARm * (newRatio / oldRatio);
    }
  }

  const scaleFactor = currentModelCost > 0 ? newModelCostZARm / currentModelCost : 1;

  // New timing
  const newStartIdx = form.startIdx ?? (currentProject?.startIdx || 0);
  const defaultDur  = PHASE_DURATIONS?.[phaseKey] || 13;
  const newDuration = parseFloat(form.durationMonths) || defaultDur;
  const newEndIdx   = Math.min(newStartIdx + Math.round(newDuration) - 1, 89);
  const newPeakFte  = currentPeakFte * scaleFactor;
  const newPeakCost = currentMonthlyCk * scaleFactor;

  // Determine if timing changed
  const oldStartIdx = currentProject?.startIdx || 0;
  const oldEndIdx   = currentProject?.endIdx   || 89;
  const timingChanged = newStartIdx !== oldStartIdx || Math.round(newDuration) !== (oldEndIdx - oldStartIdx + 1);

  // Build new monthly arrays
  const fte   = Array(90).fill(0);
  const cost  = Array(90).fill(0);
  const entOT   = Array(90).fill(0);
  const entCPMO = Array(90).fill(0);
  const entPMO  = Array(90).fill(0);
  const entEPCM = Array(90).fill(0);

  if (timingChanged) {
    // Remap to new timing with ramp shape
    const shape  = RAMP_SHAPES?.[phaseKey] || { up:[], down:[] };
    const upLen  = shape.up?.length   || 0;
    const downLen= shape.down?.length || 0;

    // Derive entity splits from existing data
    const currentActive = currentMonthly.filter(r => r.model_fte > 0);
    const avgOTPct   = currentActive.length ? currentActive.reduce((s,r)=>s+(r.ot_fte||0),0)/currentActive.reduce((s,r)=>s+(r.model_fte||0),0) : 0.025;
    const avgCPMOPct = currentActive.length ? currentActive.reduce((s,r)=>s+(r.cpmo_fte||0),0)/currentActive.reduce((s,r)=>s+(r.model_fte||0),0) : 0.13;
    const avgPMOPct  = currentActive.length ? currentActive.reduce((s,r)=>s+(r.pmo_fte||0),0)/currentActive.reduce((s,r)=>s+(r.model_fte||0),0) : 0.15;
    const avgEPCMPct = currentActive.length ? currentActive.reduce((s,r)=>s+(r.epcm_fte||0),0)/currentActive.reduce((s,r)=>s+(r.model_fte||0),0) : 0.66;

    for (let i = newStartIdx; i <= newEndIdx; i++) {
      const pos = i - newStartIdx;
      const rev = newEndIdx - i;
      let factor = 1.0;
      if (pos < upLen)    factor = shape.up[pos];
      else if (rev < downLen) factor = shape.down[downLen - 1 - rev];

      const ftePt   = +(newPeakFte * factor).toFixed(2);
      const costPt  = Math.round(newPeakCost * factor);
      fte[i]        = ftePt;
      cost[i]       = costPt;
      entOT[i]      = +(ftePt * avgOTPct).toFixed(2);
      entCPMO[i]    = +(ftePt * avgCPMOPct).toFixed(2);
      entPMO[i]     = +(ftePt * avgPMOPct).toFixed(2);
      entEPCM[i]    = +(ftePt * avgEPCMPct).toFixed(2);
    }
  } else {
    // Scale existing arrays in-place (preserves exact shape)
    for (const row of currentMonthly) {
      const i = row.month_idx;
      fte[i]    = +((row.model_fte  || 0) * scaleFactor).toFixed(2);
      cost[i]   = Math.round((row.model_cost || 0) * scaleFactor);
      entOT[i]  = +((row.ot_fte    || 0) * scaleFactor).toFixed(2);
      entCPMO[i]= +((row.cpmo_fte  || 0) * scaleFactor).toFixed(2);
      entPMO[i] = +((row.pmo_fte   || 0) * scaleFactor).toFixed(2);
      entEPCM[i]= +((row.epcm_fte  || 0) * scaleFactor).toFixed(2);
    }
  }

  const totalMH    = Math.round(fte.reduce((s,v,i)=>s+v*160,0));
  const peakFTE    = Math.max(...fte);
  const totalCostM = +(cost.reduce((a,b)=>a+b,0)/1000).toFixed(1);

  // Write new monthly rows
  const upsertHeaders = {
    ...sbHeaders,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
  };

  await fetch(`${SB_URL}/rest/v1/project_monthly_data?project_id=eq.${projectId}`, {
    method:"DELETE", headers:sbHeaders,
  });

  const monthlyRows = Array.from({length:90}, (_,idx) => ({
    project_id: projectId,
    month_idx:  idx,
    model_fte:  fte[idx],
    model_cost: cost[idx],
    asis_fte:   currentMonthly.find(r=>r.month_idx===idx)?.asis_fte   || 0,
    asis_cost:  currentMonthly.find(r=>r.month_idx===idx)?.asis_cost  || 0,
    ot_fte:     entOT[idx],
    cpmo_fte:   entCPMO[idx],
    pmo_fte:    entPMO[idx],
    epcm_fte:   entEPCM[idx],
  }));

  for (let i = 0; i < monthlyRows.length; i += 500) {
    const r = await fetch(`${SB_URL}/rest/v1/project_monthly_data`, {
      method:"POST", headers:upsertHeaders,
      body: JSON.stringify(monthlyRows.slice(i, i+500)),
    });
    if (!r.ok) throw new Error(`Failed to write monthly data: ${await r.text()}`);
  }

  // Update project summary stats
  await fetch(`${SB_URL}/rest/v1/projects?id=eq.${projectId}`, {
    method:"PATCH",
    headers: { ...sbHeaders, "Content-Type":"application/json", "Prefer":"return=minimal" },
    body: JSON.stringify({
      model_fte:   +peakFTE.toFixed(2),
      model_mh:    totalMH,
      model_cost:  totalCostM,
      capex:       parseFloat(form.capex) || currentProject?.capex,
      start_idx:   newStartIdx,
      end_idx:     newEndIdx,
      finish:      MONTHS[newEndIdx] || null,
      updated_at:  new Date().toISOString(),
    }),
  });

  return { peakFTE, totalMH, totalCostM, scaleFactor, newModelCostZARm };
}
// Fetches all data from Supabase and assembles it into the shape the app expects.
async function loadAppData() {
  const [projects, monthly, portfolio, config] = await Promise.all([
    sbFetch("projects", "?select=*&order=start_idx.asc"),
    sbFetch("project_monthly_data", "?select=*&order=project_id.asc,month_idx.asc"),
    sbFetch("portfolio_monthly_data", "?select=*&order=month_idx.asc"),
    sbFetch("model_config", "?select=*"),
  ]);

  // ── Project monthly data — group by project_id ────────────────────────────
  const byProject = {};
  for (const row of monthly) {
    if (!byProject[row.project_id]) byProject[row.project_id] = [];
    byProject[row.project_id].push(row);
  }

  // ── Assemble PROJECTS array ───────────────────────────────────────────────
  const PROJECTS = projects.map(p => {
    const rows = (byProject[p.id] || []).sort((a,b) => a.month_idx - b.month_idx);
    const fte  = Array(90).fill(0);
    const cost = Array(90).fill(0);
    const ents = { OT:Array(90).fill(0), CPMO:Array(90).fill(0), PMO:Array(90).fill(0), EPCM:Array(90).fill(0) };
    for (const r of rows) {
      fte[r.month_idx]       = r.model_fte  || 0;
      cost[r.month_idx]      = r.model_cost || 0;
      ents.OT[r.month_idx]   = r.ot_fte    || 0;
      ents.CPMO[r.month_idx] = r.cpmo_fte  || 0;
      ents.PMO[r.month_idx]  = r.pmo_fte   || 0;
      ents.EPCM[r.month_idx] = r.epcm_fte  || 0;
    }
    return {
      id:         p.id,
      name:       p.name,
      type:       p.type,
      phase:      p.phase,
      complexity: p.complexity || "High",
      finish:     p.finish || "—",
      capex:      p.capex,
      model_mh:   p.model_mh,
      model_fte:  p.model_fte,
      model_cost: p.model_cost,
      asis_mh:    p.asis_mh   || 0,
      asis_fte:   p.asis_fte  || 0,
      asis_cost:  p.asis_cost || 0,
      hasAsIs:    p.has_asis  || false,
      isCustom:   p.is_custom || false,
      startIdx:   p.start_idx,
      endIdx:     p.end_idx,
      scope_mining:   p.scope_mining   || false,
      scope_process:  p.scope_process  || false,
      scope_tsf:      p.scope_tsf      || false,
      scope_surface:  p.scope_surface  || false,
      fte, cost,
      entities: ents,
    };
  });

  // ── Assemble portfolio arrays ─────────────────────────────────────────────
  const port = portfolio.sort((a,b) => a.month_idx - b.month_idx);
  const MODEL_MH   = port.map(r => r.model_mh   || 0);
  const MODEL_FTE  = port.map(r => r.model_fte  || 0);
  const MODEL_COST = port.map(r => r.model_cost || 0);
  const ASIS_MH    = port.map(r => r.asis_mh    || 0);
  const ASIS_FTE   = port.map(r => r.asis_fte   || 0);
  const ASIS_COST  = port.map(r => r.asis_cost  || 0);

  const ENT_MODEL = {
    OT:   port.map(r => r.ot_model_fte   || 0),
    CPMO: port.map(r => r.cpmo_model_fte || 0),
    PMO:  port.map(r => r.pmo_model_fte  || 0),
    EPCM: port.map(r => r.epcm_model_fte || 0),
  };
  const ENT_ASIS = {
    OT:   port.map(r => r.ot_asis_fte   || 0),
    CPMO: port.map(r => r.cpmo_asis_fte || 0),
    PMO:  port.map(r => r.pmo_asis_fte  || 0),
    EPCM: port.map(r => r.epcm_asis_fte || 0),
  };
  const DISC_MODEL = {
    Mining:     { fte: port.map(r => r.mining_model_fte  || 0), cost: port.map(r => r.mining_model_cost  || 0) },
    ProcessTSF: { fte: port.map(r => r.process_model_fte || 0), cost: port.map(r => r.process_model_cost || 0) },
  };
  const DISC_ASIS = {
    Mining:     { fte: port.map(r => r.mining_asis_fte  || 0), cost: port.map(r => r.mining_asis_cost  || 0) },
    ProcessTSF: { fte: port.map(r => r.process_asis_fte || 0), cost: port.map(r => r.process_asis_cost || 0) },
  };

  // ── Assemble model config ─────────────────────────────────────────────────
  const PMD_RATIOS_DB  = { Mining: {}, Full: {} };
  const PHASE_DURATIONS_DB = {};
  const RATE_CARDS_DB  = {};
  const RAMP_SHAPES_DB = {};
  for (const c of config) {
    if (c.category === "rate_card")   RATE_CARDS_DB[c.key] = c.value;
    if (c.category === "pmd_ratio")   PMD_RATIOS_DB[c.sub_key][c.key] = c.value;
    if (c.category === "capacity" && c.sub_key === "avg_duration") PHASE_DURATIONS_DB[c.key] = c.value;
    if (c.category === "ramp_shape")  {
      if (!RAMP_SHAPES_DB[c.key]) RAMP_SHAPES_DB[c.key] = {};
      RAMP_SHAPES_DB[c.key][c.sub_key] = c.value_json;
    }
  }

  return {
    PROJECTS, MODEL_MH, MODEL_FTE, MODEL_COST,
    ASIS_MH, ASIS_FTE, ASIS_COST,
    ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS,
    PMD_RATIOS: PMD_RATIOS_DB,
    PHASE_DURATIONS: PHASE_DURATIONS_DB,
    RATE_CARDS: RATE_CARDS_DB,
    RAMP_SHAPES: RAMP_SHAPES_DB,
  };
}
const CAPACITY_LIMITS = {
  "Opportunity Study":        { max:4, directLoad:0.25, avgDuration:3.5 },
  "Concept Study":            { max:4, directLoad:0.25, avgDuration:6.5 },
  "PFS High Complexity":      { max:1, directLoad:1.0,  avgDuration:13.75 },
  "FS High Complexity":       { max:1, directLoad:1.0,  avgDuration:15.25 },
  "FEED High Complexity":     { max:1, directLoad:1.0,  avgDuration:13.5 },
  "Execution High Complexity":{ max:1, directLoad:1.0,  avgDuration:53.5 },
};

// ─── FORMATTERS ──────────────────────────────────────────────────────────────
const fmt = {
  mh:    (v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(Math.round(v)),
  fte:   (v) => typeof v === "number" ? v.toFixed(1) : "—",
  cost:  (v) => `R${(v/1000).toFixed(1)}m`,
  costK: (v) => v >= 1000 ? `R${(v/1000).toFixed(1)}m` : `R${Math.round(v)}k`,
  pct:   (a,b) => b > 0 ? `${Math.round((a/b)*100)}%` : "—",
  gap:   (a,b) => b > 0 ? Math.round(((b-a)/b)*100) : 0,
};

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
const Tooltip_ = ({ active, payload, label, metric }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#1a1f2e", border:`1px solid ${C.borderMed}`, borderRadius:8, padding:"10px 14px", fontSize:12, fontFamily:C.font }}>
      <div style={{ color:C.muted, marginBottom:6 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color:p.color, margin:"2px 0" }}>
          <span style={{ color:"rgba(255,255,255,0.6)" }}>{p.name}: </span>
          {metric==="fte" ? fmt.fte(p.value) : metric==="cost" ? fmt.costK(p.value) : fmt.mh(p.value)}
        </div>
      ))}
    </div>
  );
};

const KPI = ({ label, value, sub, color, badge }) => (
  <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 20px", position:"relative" }}>
    <div style={{ fontSize:10, letterSpacing:1.5, textTransform:"uppercase", color:C.muted, marginBottom:5, fontFamily:C.font }}>{label}</div>
    <div style={{ fontSize:26, fontWeight:700, color:color||C.text, fontFamily:C.font, lineHeight:1.1 }}>{value}</div>
    {sub && <div style={{ fontSize:11, color:C.muted, marginTop:3, fontFamily:C.font }}>{sub}</div>}
    {badge != null && (
      <div style={{ position:"absolute", top:14, right:14, fontSize:10, padding:"2px 8px", borderRadius:20,
        background: badge > 60 ? "rgba(239,68,68,0.15)" : badge > 30 ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)",
        color: badge > 60 ? "#f87171" : badge > 30 ? "#fbbf24" : "#34d399" }}>
        {badge}% gap
      </div>
    )}
  </div>
);

const Tag = ({ label, color, bg }) => (
  <span style={{ fontSize:10, padding:"2px 8px", borderRadius:20, background:bg||"rgba(255,255,255,0.08)", color:color||C.muted, fontFamily:C.font, whiteSpace:"nowrap" }}>{label}</span>
);

const MetricToggle = ({ value, onChange }) => (
  <div style={{ display:"flex", gap:6 }}>
    {[["fte","FTE"],["mh","Manhours"],["cost","Cost"]].map(([k,l]) => (
      <button key={k} onClick={()=>onChange(k)} style={{
        padding:"5px 16px", borderRadius:20, border:`1px solid ${value===k?C.model:C.faint}`,
        background: value===k ? "rgba(59,130,246,0.2)" : "transparent",
        color: value===k ? "#60a5fa" : C.muted, fontSize:12, cursor:"pointer", fontFamily:C.font
      }}>{l}</button>
    ))}
  </div>
);

const Panel = ({ title, sub, children, style={} }) => (
  <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"22px", ...style }}>
    {(title||sub) && (
      <div style={{ marginBottom:18 }}>
        {title && <div style={{ fontSize:15, fontWeight:600, color:C.text, fontFamily:C.font }}>{title}</div>}
        {sub   && <div style={{ fontSize:11, color:C.muted, marginTop:3, fontFamily:C.font }}>{sub}</div>}
      </div>
    )}
    {children}
  </div>
);

// ─── ALERT BANNER ────────────────────────────────────────────────────────────
const BottleneckAlerts = () => {
  const { projects, ENT_MODEL, ENT_ASIS, PHASE_DURATIONS } = useContext(ProjectsCtx);

  const alerts = useMemo(() => {
    const results = [];

    // ── 1. Count concurrent projects by phase/complexity ────────────────────
    // Read max concurrent from PHASE_DURATIONS context (comes from model_config capacity)
    const getMax = (phase, complexity) => {
      // model_config stores avg_duration; max_concurrent is separate sub_key
      // Fall back to sensible defaults if not loaded
      if (phase === "Execution") return complexity === "High" ? 1 : 2;
      if (phase === "FEED")      return complexity === "High" ? 1 : 2;
      if (phase === "FS")        return complexity === "High" ? 1 : 2;
      if (phase === "PFS")       return complexity === "High" ? 1 : 2;
      return 1;
    };
    const phaseGroups = {};
    projects.forEach(p => {
      const key = `${p.phase} ${p.complexity || "High"}`;
      if (!phaseGroups[key]) phaseGroups[key] = [];
      phaseGroups[key].push(p);
    });
    Object.entries(phaseGroups).forEach(([key, ps]) => {
      const [phase, complexity] = key.split(" ");
      const limit = getMax(phase, complexity);
      if (ps.length > limit) {
        results.push({
          sev: ps.length > limit * 2 ? "high" : "med",
          msg: `${ps.length} ${key} projects in portfolio — capacity limit is ${limit} concurrent. Requires phased scheduling.`,
        });
      }
      for (let m = 0; m < 90; m++) {
        const active = ps.filter(p => m >= p.startIdx && m <= p.endIdx);
        if (active.length > limit) {
          const names = active.map(p => p.name.split(" ").slice(0,2).join(" ")).join(", ");
          results.push({
            sev: "med",
            msg: `${active.length} ${key} projects active in ${MONTHS[m]} — exceeds ${limit}-concurrent limit: ${names}.`,
          });
          break;
        }
      }
    });

    // ── 2. EPCM peak demand vs As-Is gap ───────────────────────────────────
    const epcmModelPeak  = Math.max(...ENT_MODEL.EPCM);
    const epcmModelPeakM = ENT_MODEL.EPCM.indexOf(epcmModelPeak);
    const epcmAsisPeak   = Math.max(...ENT_ASIS.EPCM);
    if (epcmModelPeak > 0 && epcmAsisPeak > 0) {
      const gap = Math.round((1 - epcmAsisPeak / epcmModelPeak) * 100);
      if (gap > 50) {
        results.push({
          sev: "high",
          msg: `EPCM demand peaks at ${epcmModelPeak.toFixed(0)} FTE (${MONTHS[epcmModelPeakM]}) vs current As-Is of ${epcmAsisPeak.toFixed(0)} FTE — a ${gap}% gap requiring significant contractor ramp-up.`,
        });
      }
    }

    // ── 3. Single-project FTE spikes ────────────────────────────────────────
    projects.forEach(p => {
      const peakFte = Math.max(...p.fte);
      const peakIdx = p.fte.indexOf(peakFte);
      // Flag projects where the peak month is dramatically higher than the average plateau
      const activeFte = p.fte.filter(v => v > 0);
      if (activeFte.length < 3) return;
      const avg = activeFte.reduce((a,b)=>a+b,0) / activeFte.length;
      if (peakFte > avg * 2.5 && peakFte > 50) {
        results.push({
          sev: "med",
          msg: `${p.name} has an unusually high FTE spike of ${peakFte.toFixed(0)} in ${MONTHS[peakIdx]} — ${Math.round(peakFte/avg)}× the project average. Verify data.`,
        });
      }
    });

    // ── 4. High-cost projects overlapping ──────────────────────────────────
    const exeProjects = projects.filter(p => p.phase === "Execution");
    for (let m = 0; m < 90; m++) {
      const activeExe = exeProjects.filter(p => m >= p.startIdx && m <= p.endIdx);
      if (activeExe.length >= 3) {
        const totalFte = activeExe.reduce((s,p) => s + (p.fte[m]||0), 0);
        if (totalFte > 100) {
          const names = activeExe.map(p=>p.name.split(" ").slice(0,2).join(" ")).join(", ");
          results.push({
            sev: "med",
            msg: `${activeExe.length} Execution projects overlap in ${MONTHS[m]} (${totalFte.toFixed(0)} combined FTE), compressing EPCM procurement and site management capacity: ${names}.`,
          });
          break;
        }
      }
    }

    // ── 5. Projects nearing end with large As-Is gaps ──────────────────────
    const now = new Date();
    const currentMonthIdx = Math.max(0, Math.min(89,
      (now.getFullYear() - 2026) * 12 + now.getMonth()
    ));
    projects.forEach(p => {
      const monthsLeft = p.endIdx - currentMonthIdx;
      if (monthsLeft > 0 && monthsLeft <= 12 && p.model_fte > 0) {
        const gap = Math.round((1 - p.asis_fte / p.model_fte) * 100);
        if (gap > 40) {
          results.push({
            sev: "low",
            msg: `${p.name} ends in ${monthsLeft} months (${MONTHS[p.endIdx]}) but As-Is is ${gap}% below model requirement — resourcing risk in final phase.`,
          });
        }
      }
    });

    // ── 6. If no issues found ───────────────────────────────────────────────
    if (results.length === 0) {
      results.push({
        sev: "low",
        msg: "No capacity bottlenecks detected in current portfolio configuration.",
      });
    }

    return results;
  }, [projects, ENT_MODEL, ENT_ASIS]);

  const sevCfg = {
    high: { bg:"rgba(239,68,68,0.07)",   border:"rgba(239,68,68,0.25)",   dot:"#ef4444", label:"HIGH" },
    med:  { bg:"rgba(245,158,11,0.07)",  border:"rgba(245,158,11,0.25)",  dot:"#f59e0b", label:"MED"  },
    low:  { bg:"rgba(99,102,241,0.07)",  border:"rgba(99,102,241,0.25)",  dot:"#818cf8", label:"LOW"  },
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {alerts.map((a,i) => {
        const cfg = sevCfg[a.sev];
        return (
          <div key={i} style={{ display:"flex", gap:12, padding:"10px 14px", borderRadius:8, background:cfg.bg, border:`1px solid ${cfg.border}`, alignItems:"flex-start" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0, marginTop:1 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:cfg.dot }} />
              <span style={{ fontSize:9, fontWeight:700, color:cfg.dot, letterSpacing:1, fontFamily:C.font }}>{cfg.label}</span>
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", lineHeight:1.6, fontFamily:C.font }}>{a.msg}</div>
          </div>
        );
      })}
    </div>
  );
};

// ─── ADD PROJECT MODEL ENGINE ─────────────────────────────────────────────────

// PM&D cost as % of execution capital — from Benchmarking sheet
// Columns: PFS_Hi, FS_Hi, FEED_Hi, Exe_Hi (Low complexity uses halved ratios)
const PMD_RATIOS = {
  // Mining scope only (UG projects without Process/TSF)
  Mining: { "PFS High":0.005821, "PFS Low":0.002910, "FS High":0.007325, "FS Low":0.003663, "FEED High":0.007958, "FEED Low":0.003979, "Execution High":0.030349, "Execution Low":0.015174 },
  // Mining + Process + TSF (Surface or mixed scope)
  Full:   { "PFS High":0.007603, "PFS Low":0.003801, "FS High":0.009408, "FS Low":0.004704, "FEED High":0.012127, "FEED Low":0.006064, "Execution High":0.057661, "Execution Low":0.028831 },
};

// Average duration in months per phase/complexity — from Project Execution Capacity sheet
const PHASE_DURATIONS = {
  "PFS High":13.75, "PFS Low":8.25, "FS High":15.25, "FS Low":13.0,
  "FEED High":13.5, "FEED Low":9.0, "Execution High":53.5, "Execution Low":28.5,
};

// Entity splits by scope type — derived from existing project plateau values
// Each object = { OT, CPMO, PMO, EPCM } fractions summing to 1
const ENTITY_SPLITS = {
  // Underground mining-only projects (Zaaiplaats, Mponeng, Tau Tona, Doornkop, Tshepong)
  "UG-Execution": { OT:0.024, CPMO:0.134, PMO:0.182, EPCM:0.660 },
  "UG-FEED":      { OT:0.028, CPMO:0.104, PMO:0.060, EPCM:0.808 },
  "UG-FS":        { OT:0.035, CPMO:0.175, PMO:0.100, EPCM:0.690 },
  "UG-PFS":       { OT:0.040, CPMO:0.190, PMO:0.110, EPCM:0.660 },
  // Surface projects with Process+TSF scope (FSR)
  "SF-Execution": { OT:0.022, CPMO:0.124, PMO:0.151, EPCM:0.703 },
  "SF-FEED":      { OT:0.025, CPMO:0.120, PMO:0.140, EPCM:0.715 },
  "SF-FS":        { OT:0.028, CPMO:0.138, PMO:0.130, EPCM:0.704 },
  "SF-PFS":       { OT:0.032, CPMO:0.150, PMO:0.140, EPCM:0.678 },
};

// Rate cards ZARk/FTE/month (rate_ZAR/hr × 160 hrs) — from Portfolio Summary rate card column
const RATE_CARDS = { OT:269, CPMO:256, PMO:240, EPCM:304 };

// Ramp shape: fraction of peak FTE per position from start/end
// Derived from analysis of existing project monthly arrays
const RAMP_SHAPES = {
  "Execution High": { up:[0.32,0.76], down:[0.79,0.28] },
  "Execution Low":  { up:[0.40,0.80], down:[0.70,0.30] },
  "FEED High":      { up:[0.15,0.42,0.56], down:[0.60,0.25] },
  "FEED Low":       { up:[0.20,0.55], down:[0.55,0.25] },
  "FS High":        { up:[0.03,0.36,0.64,0.85], down:[0.36] },
  "FS Low":         { up:[0.10,0.50,0.80], down:[0.40] },
  "PFS High":       { up:[0.48,0.70,0.90], down:[0.45] },
  "PFS Low":        { up:[0.50,0.80], down:[0.50] },
};

function buildModelledArrays(startIdx, durationMonths, peakFte, monthlyRateCost, entitySplits, phaseKey) {
  const endIdx = Math.min(startIdx + durationMonths - 1, 89);
  const fte    = Array(90).fill(0);
  const cost   = Array(90).fill(0);
  const ents   = { OT:Array(90).fill(0), CPMO:Array(90).fill(0), PMO:Array(90).fill(0), EPCM:Array(90).fill(0) };

  const shape  = RAMP_SHAPES[phaseKey] || { up:[], down:[] };
  const upLen  = shape.up.length;
  const downLen= shape.down.length;
  const total  = endIdx - startIdx + 1;

  for (let i = startIdx; i <= endIdx; i++) {
    const pos = i - startIdx;          // position from start (0-based)
    const rev = endIdx - i;            // position from end (0-based)
    let factor = 1.0;
    if (pos < upLen)   factor = shape.up[pos];
    else if (rev < downLen) factor = shape.down[downLen - 1 - rev];

    const ftePt  = +(peakFte * factor).toFixed(2);
    const costPt = Math.round(monthlyRateCost * factor);
    fte[i]  = ftePt;
    cost[i] = costPt;
    Object.keys(ents).forEach(e => { ents[e][i] = +(ftePt * entitySplits[e]).toFixed(2); });
  }
  return { fte, cost, entities: ents, endIdx };
}

// ─── ADD PROJECT MODAL ────────────────────────────────────────────────────────
const AddProjectModal = ({ onClose, onAdd }) => {
  const [step, setStep] = useState(1); // 2-step: identity → scope/timing
  const [form, setForm] = useState({
    name:"", type:"Underground", phase:"Execution", complexity:"High",
    startIdx:0, capex:"",
    scopeMining:true, scopeProcess:false, scopeTSF:false, scopeSurface:false,
    durationMonths:"",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [err, setErr] = useState("");

  // Derive computed values live
  const phaseKey   = `${form.phase} ${form.complexity}`;
  const defaultDur = PHASE_DURATIONS[phaseKey] || 13;
  const duration   = form.durationMonths !== "" ? +form.durationMonths : Math.round(defaultDur);
  const endIdx     = Math.min(+form.startIdx + duration - 1, 89);
  const endLabel   = MONTHS[endIdx] || "Jun 2033";

  // Determine which ratio table to use based on scope
  const hasFullScope = form.scopeProcess || form.scopeTSF;
  const ratioTable   = hasFullScope ? PMD_RATIOS.Full : PMD_RATIOS.Mining;
  const pmdRatio     = ratioTable[phaseKey] || 0;

  // Calculate PM&D cost, FTE, and monthly rate from capex
  const capex      = parseFloat(form.capex) || 0;
  const pmdCostZARm= capex * pmdRatio;
  const entityKey  = `${form.type === "Underground" ? "UG" : "SF"}-${form.phase}`;
  const splits     = ENTITY_SPLITS[entityKey] || ENTITY_SPLITS["UG-Execution"];
  const blendedRate= Object.keys(RATE_CARDS).reduce((s,e) => s + RATE_CARDS[e]*splits[e], 0); // ZARk/FTE/month
  const totalMH    = capex > 0 ? Math.round((pmdCostZARm * 1000) / (blendedRate / 160)) : 0;
  const peakFte    = capex > 0 && duration > 0 ? +(totalMH / (duration * 160)).toFixed(1) : 0;
  const monthlyCostK = peakFte > 0 ? Math.round(peakFte * blendedRate) : 0; // ZARk/month

  function handleNext(e) {
    e.preventDefault();
    if (!form.name.trim()) return setErr("Project name is required.");
    if (!form.capex || parseFloat(form.capex) <= 0) return setErr("Capital cost is required.");
    setErr(""); setStep(2);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (duration < 1) return setErr("Duration must be at least 1 month.");
    if (endIdx > 89)  return setErr("Project end date exceeds the model horizon (Jun 2033).");
    if (peakFte <= 0) return setErr("Calculated FTE is zero — check your capital cost.");

    const { fte, cost, entities, endIdx: ei } = buildModelledArrays(
      +form.startIdx, duration, peakFte, monthlyCostK, splits, phaseKey
    );

    onAdd({
      id: `custom_${Date.now()}`,
      name:       form.name.trim(),
      type:       form.type,
      phase:      form.phase,
      finish:     MONTHS[ei] || "—",
      model_mh:   totalMH,
      model_fte:  peakFte,
      model_cost: +((monthlyCostK * duration) / 1000).toFixed(1),
      asis_mh:0, asis_fte:0, asis_cost:0,
      hasAsIs:    false,
      startIdx:   +form.startIdx,
      endIdx:     ei,
      fte, cost, entities,
      isCustom:   true,
      _meta: { capex: form.capex, complexity: form.complexity, pmdRatio, scope: { mining:form.scopeMining, process:form.scopeProcess, tsf:form.scopeTSF, surface:form.scopeSurface } },
    });
    onClose();
  }

  // Styles
  const overlay  = { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:16 };
  const modal    = { background:"#161b22", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"32px 36px", width:540, maxHeight:"90vh", overflowY:"auto", fontFamily:C.font };
  const lbl      = { display:"block", fontSize:11, color:C.muted, marginBottom:5, letterSpacing:0.5, fontFamily:C.font };
  const inp      = { width:"100%", padding:"9px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, outline:"none", fontFamily:C.font, boxSizing:"border-box" };
  const row2     = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 };
  const mb       = { marginBottom:16 };

  const ToggleGroup = ({ label_, options, value, onChange }) => (
    <div style={mb}>
      <div style={lbl}>{label_}</div>
      <div style={{ display:"flex", gap:6 }}>
        {options.map(([k,l]) => (
          <button key={k} type="button" onClick={()=>onChange(k)} style={{
            flex:1, padding:"8px 0", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:C.font, fontWeight:500,
            border:`1px solid ${value===k?"#3b82f6":"rgba(255,255,255,0.1)"}`,
            background: value===k?"rgba(59,130,246,0.2)":"rgba(255,255,255,0.03)",
            color: value===k?"#60a5fa":C.muted,
          }}>{l}</button>
        ))}
      </div>
    </div>
  );

  const ScopeToggle = ({ label_, field }) => {
    const on = form[field];
    return (
      <button type="button" onClick={()=>set(field,!on)} style={{
        padding:"8px 12px", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:C.font,
        border:`1px solid ${on?"#8b5cf6":"rgba(255,255,255,0.1)"}`,
        background: on?"rgba(139,92,246,0.2)":"rgba(255,255,255,0.03)",
        color: on?"#a78bfa":C.muted, textAlign:"left",
        display:"flex", alignItems:"center", gap:8,
      }}>
        <span style={{ fontSize:14 }}>{on?"✓":"○"}</span> {label_}
      </button>
    );
  };

  // Live preview card shown on step 2
  const Preview = () => (
    <div style={{ background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.2)", borderRadius:10, padding:"14px 16px", marginBottom:18 }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:8, fontFamily:C.font, letterSpacing:0.5 }}>CALCULATED FROM MODEL</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
        {[
          ["Peak FTE",    peakFte > 0 ? peakFte.toFixed(1) : "—",                     "#60a5fa"],
          ["PM&D Cost",   capex > 0 ? `R${pmdCostZARm.toFixed(1)}m` : "—",            "#a78bfa"],
          ["Monthly Cost",peakFte > 0 ? `R${(monthlyCostK/1000).toFixed(2)}m` : "—",  "#34d399"],
          ["Total MH",    totalMH > 0 ? `${(totalMH/1000).toFixed(1)}k` : "—",        "#93c5fd"],
          ["Duration",    `${duration} months`,                                         C.muted],
          ["Est. Finish", endLabel,                                                     C.muted],
        ].map(([l,v,col]) => (
          <div key={l}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:C.font, marginBottom:2 }}>{l}</div>
            <div style={{ fontSize:14, fontWeight:700, color:col, fontFamily:C.font }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:10 }}>
        {Object.entries(splits).map(([e,pct]) => (
          <div key={e} style={{ fontSize:10, color:ENTITY_COLORS[e], fontFamily:C.font }}>
            {e} {Math.round(pct*100)}%
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={overlay} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:17, fontWeight:700, color:C.text, fontFamily:C.font }}>Add New Project</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", color:C.text, width:28, height:28, borderRadius:6, cursor:"pointer", fontSize:14 }}>✕</button>
        </div>
        {/* Step indicator */}
        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:24 }}>
          {[["1","Project Details"], ["2","Scope & Timing"]].map(([n,l],idx) => (
            <div key={n} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:22, height:22, borderRadius:"50%", background: step>idx?"#3b82f6":step===idx+1?"#3b82f6":"rgba(255,255,255,0.1)", color:"#fff", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:C.font }}>{n}</div>
              <span style={{ fontSize:11, color: step===idx+1?C.text:C.muted, fontFamily:C.font }}>{l}</span>
              {idx===0 && <span style={{ color:"rgba(255,255,255,0.15)", margin:"0 4px" }}>›</span>}
            </div>
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={handleNext}>
            <div style={mb}>
              <label style={lbl}>PROJECT NAME</label>
              <input style={inp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. New Shaft Feasibility Study" autoFocus />
            </div>
            <ToggleGroup label_="PROJECT TYPE" options={[["Underground","Underground"],["Surface","Surface"]]} value={form.type} onChange={v=>set("type",v)} />
            <ToggleGroup label_="STUDY PHASE" options={[["PFS","PFS"],["FS","FS"],["FEED","FEED"],["Execution","Execution"]]} value={form.phase} onChange={v=>set("phase",v)} />
            <ToggleGroup label_="COMPLEXITY" options={[["High","High"],["Low","Low"]]} value={form.complexity} onChange={v=>set("complexity",v)} />
            <div style={mb}>
              <label style={lbl}>EXECUTION CAPITAL COST (ZARm) <span style={{ color:"rgba(255,255,255,0.25)" }}>— used to derive PM&D resource requirement</span></label>
              <input style={inp} type="number" min="0" step="1" value={form.capex} onChange={e=>set("capex",e.target.value)} placeholder="e.g. 470" />
              {capex > 0 && (
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:5, fontFamily:C.font }}>
                  PM&D ratio for {phaseKey}: {(pmdRatio*100).toFixed(3)}% → PM&D cost R{(capex*pmdRatio).toFixed(1)}m
                </div>
              )}
            </div>
            {err && <div style={{ color:"#f87171", fontSize:12, marginBottom:12, fontFamily:C.font }}>{err}</div>}
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button type="submit" style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#3b82f6", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>Next →</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit}>
            <Preview />
            <div style={mb}>
              <div style={lbl}>SCOPE INDICATORS <span style={{ color:"rgba(255,255,255,0.25)" }}>— select all disciplines that apply</span></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <ScopeToggle label_="Mining" field="scopeMining" />
                <ScopeToggle label_="Processing / Metallurgical" field="scopeProcess" />
                <ScopeToggle label_="TSF (Tailings Storage)" field="scopeTSF" />
                <ScopeToggle label_="Surface Infrastructure" field="scopeSurface" />
              </div>
            </div>
            <div style={{ ...row2, ...mb }}>
              <div>
                <label style={lbl}>START MONTH</label>
                <select style={{ ...inp, cursor:"pointer" }} value={form.startIdx} onChange={e=>set("startIdx",+e.target.value)}>
                  {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>DURATION (MONTHS) <span style={{ color:"rgba(255,255,255,0.25)" }}>default {Math.round(defaultDur)}</span></label>
                <input style={inp} type="number" min="1" max="90" value={form.durationMonths !== "" ? form.durationMonths : Math.round(defaultDur)}
                  onChange={e=>set("durationMonths", e.target.value)} />
              </div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:11, color:C.muted, fontFamily:C.font }}>
              Est. finish: <span style={{ color:C.text, fontWeight:600 }}>{endLabel}</span>
              {endIdx >= 89 && <span style={{ color:"#f59e0b", marginLeft:8 }}>⚠ Project extends to model horizon limit</span>}
            </div>
            {err && <div style={{ color:"#f87171", fontSize:12, marginBottom:12, fontFamily:C.font }}>{err}</div>}
            <div style={{ display:"flex", gap:10, justifyContent:"space-between" }}>
              <button type="button" onClick={()=>{setStep(1);setErr("");}} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,255,255,0.12)", background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:C.font }}>← Back</button>
              <button type="submit" style={{ padding:"9px 24px", borderRadius:8, border:"none", background:"#3b82f6", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>Add Project</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// ─── GANTT TIMELINE ───────────────────────────────────────────────────────────
const GanttView = ({ filter }) => {
  const { projects, addProject, MODEL_FTE, MODEL_MH, MODEL_COST, ASIS_FTE, ASIS_MH, ASIS_COST, ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS } = useContext(ProjectsCtx);
  const filtered = projects.filter(p => {
    if (filter.type !== "all" && p.type !== filter.type) return false;
    if (filter.phase !== "all" && p.phase !== filter.phase) return false;
    return true;
  });

  const CELL_W = 18;
  const ROW_H  = 32;
  const LABEL_W = 160;

  // Year headers
  const yearSpans = YEARS.map((y, yi) => ({ year: y, start: yi * 12, width: 12 }));

  return (
    <div>
      <div style={{ overflowX:"auto" }}>
        <div style={{ minWidth: LABEL_W + 90 * CELL_W + 20 }}>
          {/* Year header */}
          <div style={{ display:"flex", marginLeft:LABEL_W, marginBottom:2 }}>
            {yearSpans.map(ys => (
              <div key={ys.year} style={{ width: ys.width * CELL_W, fontSize:10, color:C.muted, fontFamily:C.font, borderLeft:`1px solid ${C.border}`, paddingLeft:4 }}>{ys.year}</div>
            ))}
          </div>
          {/* Month ticks */}
          <div style={{ display:"flex", marginLeft:LABEL_W, marginBottom:6 }}>
            {MONTHS.map((m,i) => (
              <div key={i} style={{ width:CELL_W, fontSize:8, color:"rgba(255,255,255,0.2)", fontFamily:C.font, textAlign:"center", borderLeft:`1px solid rgba(255,255,255,0.04)` }}>
                {m.startsWith("Jan") ? "J" : ""}
              </div>
            ))}
          </div>
          {/* Project rows */}
          {filtered.map(p => {
            const color = PHASE_COLORS[p.phase] || "#3b82f6";
            const barW   = (p.endIdx - p.startIdx + 1) * CELL_W;
            const barL   = p.startIdx * CELL_W;
            const gapPct = fmt.gap(p.asis_fte, p.model_fte);
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center", height:ROW_H, borderBottom:`1px solid rgba(255,255,255,0.03)` }}>
                <div style={{ width:LABEL_W, flexShrink:0, paddingRight:10 }}>
                  <div style={{ fontSize:11, color:C.text, fontFamily:C.font, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                  <div style={{ display:"flex", gap:4, marginTop:2 }}>
                    <Tag label={p.phase} color={color} bg={`${color}20`} />
                  </div>
                </div>
                <div style={{ position:"relative", flex:1, height:ROW_H - 8, display:"flex", alignItems:"center" }}>
                  {/* Background grid */}
                  {MONTHS.map((_,i) => (
                    <div key={i} style={{ position:"absolute", left:i*CELL_W, width:CELL_W, height:"100%", borderLeft:`1px solid rgba(255,255,255,0.025)`, background: Math.floor(i/12)%2===0?"transparent":"rgba(255,255,255,0.01)" }} />
                  ))}
                  {/* Bar */}
                  <div style={{
                    position:"absolute", left:barL, width:barW, height:18,
                    background:`${color}30`, border:`1px solid ${color}60`,
                    borderRadius:3, display:"flex", alignItems:"center", paddingLeft:6,
                    overflow:"hidden"
                  }}>
                    <span style={{ fontSize:10, color, fontFamily:C.font, whiteSpace:"nowrap" }}>
                      {p.model_fte} FTE · R{p.model_cost}m
                    </span>
                  </div>
                  {/* As-Is overlay if available */}
                  {p.hasAsIs && (
                    <div style={{
                      position:"absolute", left:barL, width: Math.round((p.asis_mh / p.model_mh) * barW),
                      height:18, background:`${C.asis}25`, border:`1px solid ${C.asis}50`,
                      borderRadius:3
                    }} />
                  )}
                </div>
                <div style={{ width:50, textAlign:"right", fontSize:11, fontFamily:C.font, color: gapPct > 60 ? "#f87171" : gapPct > 30 ? "#fbbf24" : "#34d399", flexShrink:0 }}>
                  {gapPct}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display:"flex", gap:16, marginTop:14, fontSize:11, color:C.muted, fontFamily:C.font }}>
        {Object.entries(PHASE_COLORS).map(([ph,col]) => (
          <span key={ph}><span style={{ color:col }}>■</span> {ph}</span>
        ))}
        <span><span style={{ color:C.asis }}>■</span> As-Is actual (where available)</span>
        <span style={{ marginLeft:"auto", color:C.muted }}>Gap% = model FTE vs as-is FTE</span>
      </div>
    </div>
  );
};

// ─── PROJECT DRILLDOWN ────────────────────────────────────────────────────────
const ProjectDrilldown = ({ project, onClose }) => {
  const [metric, setMetric] = useState("fte");
  const p = project;
  const finish = p.finish !== "—" ? p.finish : MONTHS[p.endIdx] || "—";
  const data = metric === "fte" ? p.fte : p.cost;
  const entityData = MONTHS.map((m,i) => ({
    month:m,
    OT:   p.entities.OT[i],
    CPMO: p.entities.CPMO[i],
    PMO:  p.entities.PMO[i],
    EPCM: p.entities.EPCM[i],
  }));
  const peakFTE  = Math.max(...p.fte);
  const peakMonth = MONTHS[p.fte.indexOf(peakFTE)];
  const totalCost = p.cost.reduce((a,b)=>a+b,0);
  const gapPct   = fmt.gap(p.asis_fte, p.model_fte);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"#0d1117", border:`1px solid ${C.borderMed}`, borderRadius:16, width:"min(900px,95vw)", maxHeight:"90vh", overflowY:"auto", padding:28 }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4 }}>
              <h2 style={{ fontSize:22, fontWeight:700, color:C.text, fontFamily:C.font, margin:0 }}>{p.name}</h2>
              <Tag label={p.type} color={p.type==="Underground"?C.UG:C.SF} bg={p.type==="Underground"?"rgba(139,92,246,0.2)":"rgba(16,185,129,0.2)"} />
              <Tag label={p.phase} color={PHASE_COLORS[p.phase]} bg={`${PHASE_COLORS[p.phase]}20`} />
              {p.hasAsIs && <Tag label="✓ As-Is Data" color="#34d399" bg="rgba(16,185,129,0.15)" />}
            </div>
            {finish !== "—" && <div style={{ fontSize:12, color:C.muted, fontFamily:C.font }}>Est. Finish: {finish}</div>}
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", color:C.text, width:32, height:32, borderRadius:8, cursor:"pointer", fontSize:16, fontFamily:C.font }}>✕</button>
        </div>

        {/* KPIs */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
          <KPI label="Total Manhours" value={fmt.mh(p.model_mh)} color="#93c5fd" />
          <KPI label="Peak FTE" value={fmt.fte(peakFTE)} sub={`in ${peakMonth}`} color="#60a5fa" />
          <KPI label="Total Cost" value={fmt.cost(totalCost)} color="#a78bfa" />
          <KPI label="FTE Gap" value={`${gapPct}%`} sub={`${p.asis_fte} vs ${p.model_fte} FTE`} color={gapPct>60?"#f87171":gapPct>30?"#fbbf24":"#34d399"} />
        </div>

        <MetricToggle value={metric} onChange={setMetric} />

        {/* Main chart */}
        <Panel title={`Monthly ${metric==="fte"?"FTE Demand":metric==="mh"?"Manhours":"Cost"}`} sub="90-month horizon" style={{ marginTop:16, marginBottom:16 }}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={MONTHS.map((m,i)=>({ month:m, value: data[i] }))} margin={{top:5,right:10,left:10,bottom:5}}>
              <defs>
                <linearGradient id="gDrill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PHASE_COLORS[p.phase]} stopOpacity={0.35}/>
                  <stop offset="95%" stopColor={PHASE_COLORS[p.phase]} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
              <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
              <Tooltip content={<Tooltip_ metric={metric} />} />
              <Area type="monotone" dataKey="value" name={metric==="fte"?"FTE":"Cost"} stroke={PHASE_COLORS[p.phase]} strokeWidth={2} fill="url(#gDrill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        {/* Entity stacked */}
        <Panel title="FTE by Entity" sub="OT · CPMO · PMO · EPCM">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={entityData} margin={{top:5,right:10,left:10,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
              <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
              <Tooltip content={<Tooltip_ metric="fte" />} />
              <Legend wrapperStyle={{fontSize:11,color:C.muted,fontFamily:C.font}} />
              <Bar dataKey="EPCM" stackId="a" fill={C.EPCM} />
              <Bar dataKey="PMO"  stackId="a" fill={C.PMO} />
              <Bar dataKey="CPMO" stackId="a" fill={C.CPMO} />
              <Bar dataKey="OT"   stackId="a" fill={C.OT} />
            </BarChart>
          </ResponsiveContainer>
          {/* Entity summary row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginTop:16 }}>
            {["OT","CPMO","PMO","EPCM"].map(e => {
              const peak = Math.max(...p.entities[e]);
              const total = p.entities[e].reduce((a,b)=>a+b,0);
              return (
                <div key={e} style={{ borderTop:`2px solid ${ENTITY_COLORS[e]}`, paddingTop:8 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:ENTITY_COLORS[e], fontFamily:C.font }}>{e}</div>
                  <div style={{ fontSize:11, color:C.muted, fontFamily:C.font }}>Peak {peak.toFixed(1)} FTE</div>
                  <div style={{ fontSize:11, color:C.muted, fontFamily:C.font }}>Σ {total.toFixed(1)} FTE-months</div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
};

// ─── VIEW 1: AS-IS ────────────────────────────────────────────────────────────
const AsIsView = () => {
  const [metric, setMetric] = useState("fte");
  const [drillProject, setDrillProject] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterPhase, setFilterPhase] = useState("all");
  const [openMenu, setOpenMenu] = useState(null);

  const { projects, MODEL_FTE, MODEL_MH, MODEL_COST, ASIS_FTE, ASIS_MH, ASIS_COST, ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS, goToProjectSettings } = useContext(ProjectsCtx);

  // Projects matching type+phase filters (drives KPIs, chart, and table)
  const typePhaseFiltered = useMemo(() => projects.filter(p => {
    if (filterType !== "all" && p.type !== filterType) return false;
    if (filterPhase !== "all" && p.phase !== filterPhase) return false;
    return true;
  }), [projects, filterType, filterPhase]);

  // Compute model arrays by summing individual project arrays for filtered set
  const filteredModelFTE  = useMemo(() => MONTHS.map((_,i) => +typePhaseFiltered.reduce((s,p)=>s+(p.fte[i]||0),0).toFixed(1)),  [typePhaseFiltered]);
  const filteredModelCost = useMemo(() => MONTHS.map((_,i) => Math.round(typePhaseFiltered.reduce((s,p)=>s+(p.cost[i]||0),0))), [typePhaseFiltered]);
  const filteredModelMH   = useMemo(() => MONTHS.map((_,i) => Math.round(typePhaseFiltered.reduce((s,p)=>s+(p.fte[i]||0)*160,0))),[typePhaseFiltered]);

  // Scale portfolio As-Is proportionally to filtered project count
  const filteredRatio = projects.length > 0 ? typePhaseFiltered.length / projects.length : 1;
  const filteredAsisFTE  = useMemo(() => ASIS_FTE.map(v  => +( v * filteredRatio).toFixed(1)),  [filteredRatio]);
  const filteredAsisMH   = useMemo(() => ASIS_MH.map(v   => Math.round(v * filteredRatio)),      [filteredRatio]);
  const filteredAsisCost = useMemo(() => ASIS_COST.map(v  => Math.round(v * filteredRatio)),      [filteredRatio]);

  const mD = metric==="fte"?filteredModelFTE:metric==="mh"?filteredModelMH:filteredModelCost;
  const aD = metric==="fte"?filteredAsisFTE:metric==="mh"?filteredAsisMH:filteredAsisCost;
  const peakM = Math.max(...mD), peakA = Math.max(...aD);
  const filteredTotalCost = filteredModelCost.reduce((a,b)=>a+b,0);

  const chartData = MONTHS.map((m,i)=>({ month:m, Model:mD[i]||0, "As-Is":aD[i]||0 }));

  // Table also filters by search
  const filtered = useMemo(() => typePhaseFiltered.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [typePhaseFiltered, search]);

  const asIsCount  = projects.filter(p => p.hasAsIs).length;
  const asIsNames  = projects.filter(p => p.hasAsIs).map(p => p.name.split(" ")[0]).join(" · ");

  return (
    <div>
      {drillProject && <ProjectDrilldown project={drillProject} onClose={()=>setDrillProject(null)} />}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <MetricToggle value={metric} onChange={setMetric} />
        <div style={{ display:"flex", gap:8 }}>
          {[["all","All Types"],["Underground","Underground"],["Surface","Surface"]].map(([k,l])=>(
            <button key={k} onClick={()=>setFilterType(k)} style={{ padding:"5px 14px", borderRadius:20, border:`1px solid ${filterType===k?"#8b5cf6":C.faint}`, background:filterType===k?"rgba(139,92,246,0.2)":"transparent", color:filterType===k?"#a78bfa":C.muted, fontSize:12, cursor:"pointer", fontFamily:C.font }}>{l}</button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        <KPI label="Peak Required FTE" value={fmt.fte(peakM)} sub="Model benchmark" color="#60a5fa" badge={fmt.gap(peakA,peakM)} />
        <KPI label="Peak Deployed FTE" value={fmt.fte(peakA)} sub="As-Is actual" color="#34d399" />
        <KPI label="Total Model Cost" value={fmt.cost(filteredTotalCost)} sub={filterType==="all" && filterPhase==="all" ? "90-month horizon" : "filtered selection"} color="#a78bfa" />
        <KPI label="Projects w/ As-Is Data" value={`${asIsCount} / ${projects.length}`} sub={asIsNames} color="#f59e0b" />
      </div>

      {/* Gap chart */}
      <Panel title={`Portfolio ${metric.toUpperCase()} — As-Is vs Model`} sub="Jan 2026 – Jun 2033 · Shaded gap = resourcing shortfall" style={{ marginBottom:20 }}>
        <div style={{ display:"flex", gap:16, fontSize:11, color:C.muted, marginBottom:12, fontFamily:C.font }}>
          <span><span style={{color:C.model}}>■</span> Model Required</span>
          <span><span style={{color:C.asis}}>■</span> As-Is Deployed</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{top:5,right:10,left:10,bottom:5}}>
            <defs>
              <linearGradient id="gM" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.model} stopOpacity={0.3}/><stop offset="95%" stopColor={C.model} stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.asis} stopOpacity={0.3}/><stop offset="95%" stopColor={C.asis} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
            <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
            <Tooltip content={<Tooltip_ metric={metric} />} />
            <Area type="monotone" dataKey="Model" stroke={C.model} strokeWidth={2} fill="url(#gM)" />
            <Area type="monotone" dataKey="As-Is" stroke={C.asis}  strokeWidth={2} fill="url(#gA)" />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* Entity panels */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
        {Object.keys(ENTITY_COLORS).map(e => {
          const mF = ENT_MODEL[e], aF = ENT_ASIS[e];
          const pM = Math.max(...mF), pA = Math.max(...aF);
          const gap = fmt.gap(pA, pM);
          return (
            <Panel key={e} style={{ padding:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div>
                  <span style={{ fontSize:14, fontWeight:700, color:ENTITY_COLORS[e], fontFamily:C.font }}>{e}</span>
                  <span style={{ fontSize:11, color:C.muted, marginLeft:8, fontFamily:C.font }}>{e==="OT"?"Owners Team":e==="CPMO"?"Capital Portfolio Mgmt":e==="PMO"?"Site PMO":"EPCM Contractor"}</span>
                </div>
                <Tag label={`${gap}% gap`} color={gap>60?"#f87171":gap>30?"#fbbf24":"#34d399"} bg={gap>60?"rgba(239,68,68,0.12)":gap>30?"rgba(245,158,11,0.12)":"rgba(16,185,129,0.12)"} />
              </div>
              <div style={{ display:"flex", gap:16, marginBottom:10, fontSize:11, color:C.muted, fontFamily:C.font }}>
                <span>Model peak <span style={{color:ENTITY_COLORS[e],fontWeight:600}}>{pM.toFixed(1)}</span></span>
                <span>As-Is peak <span style={{color:C.asis,fontWeight:600}}>{pA.toFixed(1)}</span></span>
              </div>
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={MONTHS.map((m,i)=>({ month:m, Model:mF[i], "As-Is":aF[i] }))} margin={{top:0,right:0,left:-20,bottom:0}}>
                  <defs>
                    <linearGradient id={`gE${e}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ENTITY_COLORS[e]} stopOpacity={0.25}/><stop offset="95%" stopColor={ENTITY_COLORS[e]} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="month" tick={false} axisLine={false}/>
                  <YAxis tick={{fill:"rgba(255,255,255,0.3)",fontSize:9}} axisLine={false} tickLine={false}/>
                  <Tooltip content={<Tooltip_ metric="fte" />} />
                  <Area type="monotone" dataKey="Model"  stroke={ENTITY_COLORS[e]} strokeWidth={1.5} fill={`url(#gE${e})`} />
                  <Area type="monotone" dataKey="As-Is"  stroke={C.asis} strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>
          );
        })}
      </div>

      {/* Project table */}
      <Panel title="Project-Level Detail" sub="Click any row to drill into monthly breakdown">
        {/* Filters */}
        <div style={{ display:"flex", gap:10, marginBottom:14 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects…"
            style={{ flex:1, padding:"7px 12px", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:12, outline:"none", fontFamily:C.font }} />
          {[["all","All Phases"],["PFS","PFS"],["FS","FS"],["FEED","FEED"],["Execution","Execution"]].map(([k,l])=>(
            <button key={k} onClick={()=>setFilterPhase(k)} style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${filterPhase===k?PHASE_COLORS[k]||C.model:C.faint}`, background:filterPhase===k?`${PHASE_COLORS[k]||C.model}20`:"transparent", color:filterPhase===k?PHASE_COLORS[k]||"#60a5fa":C.muted, fontSize:11, cursor:"pointer", fontFamily:C.font, whiteSpace:"nowrap" }}>{l}</button>
          ))}
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:C.font }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              {["Project","Type","Phase","As-Is FTE","Model FTE","Gap","As-Is Cost","Model Cost","As-Is MH","Model MH","Data"].map(h=>(
                <th key={h} style={{ padding:"8px 10px", textAlign:"left", color:C.muted, fontWeight:500, fontSize:10, letterSpacing:0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p,i)=>{
              const gap = fmt.gap(p.asis_fte, p.model_fte);
              return (
                <tr key={p.id} onClick={()=>setDrillProject(p)}
                  style={{ borderBottom:`1px solid rgba(255,255,255,0.03)`, background:i%2===0?"transparent":"rgba(255,255,255,0.015)", cursor:"pointer", transition:"background 0.15s" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(59,130,246,0.07)"}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"rgba(255,255,255,0.015)"}>
                  <td style={{ padding:"9px 10px", color:C.text, fontWeight:500 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {p.name}
                      <div style={{ position:"relative", display:"inline-block" }} onClick={e=>e.stopPropagation()}>
                        <button
                          onClick={e=>{ e.stopPropagation(); setOpenMenu(openMenu===p.id?null:p.id); }}
                          style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:16, padding:"2px 6px", borderRadius:4, lineHeight:1 }}>
                          ···
                        </button>
                        {openMenu===p.id && (
                          <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, background:"#1e2530", border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 0", minWidth:180, boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}>
                            {[
                              ["✎  Edit project details",  ()=>{ goToProjectSettings(p.id,"projects");  setOpenMenu(null); }],
                              ["⇅  Edit As-Is actuals",    ()=>{ goToProjectSettings(p.id,"actuals");   setOpenMenu(null); }],
                            ].map(([label, action])=>(
                              <button key={label} onClick={action} style={{
                                display:"block", width:"100%", textAlign:"left", padding:"8px 14px",
                                background:"none", border:"none", color:C.text, fontSize:12,
                                cursor:"pointer", fontFamily:C.font,
                              }}
                                onMouseEnter={e=>e.target.style.background="rgba(255,255,255,0.07)"}
                                onMouseLeave={e=>e.target.style.background="none"}>
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:"9px 10px" }}><Tag label={p.type.slice(0,3).toUpperCase()} color={p.type==="Underground"?C.UG:C.SF} bg={p.type==="Underground"?"rgba(139,92,246,0.15)":"rgba(16,185,129,0.15)"} /></td>
                  <td style={{ padding:"9px 10px" }}><Tag label={p.phase} color={PHASE_COLORS[p.phase]} bg={`${PHASE_COLORS[p.phase]}20`} /></td>
                  <td style={{ padding:"9px 10px", color:C.asis }}>{p.asis_fte}</td>
                  <td style={{ padding:"9px 10px", color:C.model }}>{p.model_fte}</td>
                  <td style={{ padding:"9px 10px" }}><span style={{ color:gap>60?"#f87171":gap>30?"#fbbf24":"#34d399", fontWeight:600 }}>{gap}%</span></td>
                  <td style={{ padding:"9px 10px", color:C.asis }}>R{p.asis_cost}m</td>
                  <td style={{ padding:"9px 10px", color:C.model }}>R{p.model_cost}m</td>
                  <td style={{ padding:"9px 10px", color:"rgba(255,255,255,0.4)" }}>{fmt.mh(p.asis_mh)}</td>
                  <td style={{ padding:"9px 10px", color:"rgba(255,255,255,0.4)" }}>{fmt.mh(p.model_mh)}</td>
                  <td style={{ padding:"9px 10px" }}><Tag label={p.hasAsIs?"✓ Actual":"Modelled"} color={p.hasAsIs?"#34d399":"rgba(255,255,255,0.3)"} bg={p.hasAsIs?"rgba(16,185,129,0.15)":"rgba(255,255,255,0.05)"} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize:11, color:C.muted, marginTop:10, fontFamily:C.font }}>Showing {filtered.length} of {projects.length} projects</div>
      </Panel>
    </div>
  );
};

// ─── VIEW 2: RESOURCE MODEL ───────────────────────────────────────────────────
const ModelView = () => {
  const [subView, setSubView] = useState("demand");
  const [metric, setMetric]   = useState("fte");
  const [filterType, setFilterType] = useState("all");
  const [filterPhase, setFilterPhase] = useState("all");
  const [ganttFilter, setGanttFilter] = useState({ type:"all", phase:"all" });

  const { projects, addProject, MODEL_FTE, MODEL_MH, MODEL_COST, ASIS_FTE, ASIS_MH, ASIS_COST, ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS } = useContext(ProjectsCtx);

  const stackData = MONTHS.map((m,i) => ({ month:m, OT:ENT_MODEL.OT[i], CPMO:ENT_MODEL.CPMO[i], PMO:ENT_MODEL.PMO[i], EPCM:ENT_MODEL.EPCM[i] }));
  const discData  = MONTHS.map((m,i) => ({ month:m, Mining:DISC_MODEL.Mining.fte[i], "Process & TSF":DISC_MODEL.ProcessTSF.fte[i] }));

  const [showAddModal, setShowAddModal] = useState(false);
  const filtered = useMemo(()=>projects.filter(p=>{
    if (filterType!=="all" && p.type!==filterType) return false;
    if (filterPhase!=="all" && p.phase!==filterPhase) return false;
    return true;
  }),[projects,filterType,filterPhase]);

  // Filtered model arrays for KPIs and demand chart
  const filtModelFTE  = useMemo(()=>MONTHS.map((_,i)=>+filtered.reduce((s,p)=>s+(p.fte[i]||0),0).toFixed(1)),[filtered]);
  const filtModelCost = useMemo(()=>MONTHS.map((_,i)=>Math.round(filtered.reduce((s,p)=>s+(p.cost[i]||0),0))),[filtered]);
  const filtModelMH   = useMemo(()=>MONTHS.map((_,i)=>Math.round(filtered.reduce((s,p)=>s+(p.fte[i]||0)*160,0))),[filtered]);
  const filtPeakFTE   = Math.max(...filtModelFTE);
  const filtPeakIdx   = filtModelFTE.indexOf(filtPeakFTE);
  const filtTotalCost = filtModelCost.reduce((a,b)=>a+b,0);

  const mD = metric==="fte"?filtModelFTE:metric==="mh"?filtModelMH:filtModelCost;
  const peakIdx = mD.indexOf(Math.max(...mD));

  return (
    <div>
      {/* Sub-view tabs */}
      <div style={{ display:"flex", gap:4, marginBottom:24, borderBottom:`1px solid ${C.border}`, paddingBottom:1 }}>
        {[["demand","Demand Curves"],["entity","By Entity"],["discipline","By Discipline"],["gantt","Timeline"],["capacity","Capacity"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubView(k)} style={{
            padding:"8px 18px", background:"transparent", border:"none", cursor:"pointer", fontFamily:C.font, fontSize:13,
            color:subView===k?C.text:C.muted, fontWeight:subView===k?600:400,
            borderBottom:`2px solid ${subView===k?C.model:"transparent"}`, marginBottom:-1
          }}>{l}</button>
        ))}
        {subView !== "gantt" && subView !== "capacity" && (
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center" }}>
            <MetricToggle value={metric} onChange={setMetric} />
          </div>
        )}
      </div>

      {/* KPIs always visible */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        <KPI label="Peak Portfolio FTE" value={fmt.fte(filtPeakFTE)} sub={MONTHS[filtPeakIdx] || "—"} color="#60a5fa" />
        <KPI label="Peak EPCM FTE" value={fmt.fte(Math.max(...ENT_MODEL.EPCM))} sub="Largest entity" color={C.EPCM} />
        <KPI label="Total Forecast Cost" value={fmt.cost(filtTotalCost)} sub={filterType==="all" && filterPhase==="all" ? "90-month" : "filtered selection"} color="#a78bfa" />
        <KPI label="Projects" value={String(filtered.length)} sub={`${filtered.filter(p=>p.type==="Underground").length} UG · ${filtered.filter(p=>p.type==="Surface").length} Surface`} color="#34d399" />
      </div>

      {subView === "demand" && (
        <>
          <Panel title={`Required ${metric==="fte"?"FTE Demand":metric==="mh"?"Manhour Forecast":"Cost Forecast"}`} sub={`Peak in ${MONTHS[peakIdx]} — ${fmt.fte(filtPeakFTE)} FTE`} style={{ marginBottom:20 }}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={MONTHS.map((m,i)=>({ month:m, value:mD[i] }))} margin={{top:5,right:10,left:10,bottom:5}}>
                <defs><linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.model} stopOpacity={0.4}/><stop offset="95%" stopColor={C.model} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
                <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tooltip_ metric={metric} />} />
                <ReferenceLine x={MONTHS[peakIdx]} stroke="#f59e0b" strokeDasharray="4 2" label={{value:"Peak",fill:"#f59e0b",fontSize:10}} />
                <Area type="monotone" dataKey="value" name="Required" stroke={C.model} strokeWidth={2.5} fill="url(#gReq)" />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          <div style={{ display:"flex", gap:10, marginBottom:14 }}>
            {[["all","All"],["Underground","Underground"],["Surface","Surface"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFilterType(k)} style={{ padding:"5px 14px", borderRadius:20, border:`1px solid ${filterType===k?C.model:C.faint}`, background:filterType===k?"rgba(59,130,246,0.15)":"transparent", color:filterType===k?"#60a5fa":C.muted, fontSize:12, cursor:"pointer", fontFamily:C.font }}>{l}</button>
            ))}
            {[["all","All Phases"],["PFS","PFS"],["FS","FS"],["FEED","FEED"],["Execution","Execution"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFilterPhase(k)} style={{ padding:"5px 12px", borderRadius:20, border:`1px solid ${filterPhase===k?(PHASE_COLORS[k]||C.model):C.faint}`, background:filterPhase===k?`${PHASE_COLORS[k]||C.model}20`:"transparent", color:filterPhase===k?(PHASE_COLORS[k]||"#60a5fa"):C.muted, fontSize:11, cursor:"pointer", fontFamily:C.font }}>{l}</button>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
            {filtered.map(p=>(
              <div key={p.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.text, lineHeight:1.3 }}>{p.name}</div>
                  <Tag label={p.type.slice(0,3)} color={p.type==="Underground"?C.UG:C.SF} bg={p.type==="Underground"?"rgba(139,92,246,0.15)":"rgba(16,185,129,0.15)"} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                  {[["MH",fmt.mh(p.model_mh),"#93c5fd"],["PEAK FTE",fmt.fte(p.model_fte),"#60a5fa"],["COST",`R${p.model_cost}m`,"#a78bfa"]].map(([lbl,val,col])=>(
                    <div key={lbl}><div style={{ fontSize:9, color:C.muted, marginBottom:2, fontFamily:C.font, letterSpacing:0.5 }}>{lbl}</div><div style={{ fontSize:14, color:col, fontWeight:700, fontFamily:C.font }}>{val}</div></div>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:10, alignItems:"center" }}>
                  <Tag label={p.phase} color={PHASE_COLORS[p.phase]} bg={`${PHASE_COLORS[p.phase]}20`} />
                  {(p.finish !== "—" || p.endIdx != null) && <span style={{ fontSize:10, color:C.muted, fontFamily:C.font }}>→ {p.finish !== "—" ? p.finish : MONTHS[p.endIdx]}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {subView === "entity" && (
        <div>
          <Panel title="FTE Demand by Entity — Stacked" sub="OT · CPMO · PMO · EPCM" style={{ marginBottom:20 }}>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={stackData} margin={{top:5,right:10,left:10,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
                <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tooltip_ metric="fte" />} />
                <Legend wrapperStyle={{fontSize:11,color:C.muted,fontFamily:C.font}} />
                <Bar dataKey="EPCM" stackId="a" fill={C.EPCM} /><Bar dataKey="PMO" stackId="a" fill={C.PMO} /><Bar dataKey="CPMO" stackId="a" fill={C.CPMO} /><Bar dataKey="OT" stackId="a" fill={C.OT} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
            {Object.entries(ENTITY_COLORS).map(([e,col])=>{
              const mF = ENT_MODEL[e], aF = ENT_ASIS[e];
              const pM = Math.max(...mF), pA = Math.max(...aF);
              const gap = fmt.gap(pA,pM);
              const totalCost = MODEL_COST.reduce((a,b)=>a+b,0);
              return (
                <div key={e} style={{ background:C.surface, borderRadius:10, padding:"16px", borderTop:`2px solid ${col}` }}>
                  <div style={{ fontSize:14, fontWeight:700, color:col, fontFamily:C.font, marginBottom:8 }}>{e}</div>
                  <div style={{ fontSize:11, color:C.muted, fontFamily:C.font, marginBottom:4 }}>Model peak <span style={{color:col,fontWeight:600}}>{pM.toFixed(1)} FTE</span></div>
                  <div style={{ fontSize:11, color:C.muted, fontFamily:C.font, marginBottom:4 }}>As-Is peak <span style={{color:C.asis,fontWeight:600}}>{pA.toFixed(1)} FTE</span></div>
                  <div style={{ marginTop:8, height:4, background:"rgba(255,255,255,0.08)", borderRadius:2 }}>
                    <div style={{ height:"100%", width:`${Math.min(100,(pA/pM)*100)}%`, background:col, borderRadius:2 }} />
                  </div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:4, fontFamily:C.font }}>Coverage: {Math.round((pA/pM)*100)}%</div>
                  <div style={{ marginTop:8, fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:C.font }}>
                    {e==="OT"?"Owners Team":e==="CPMO"?"Capital Portfolio Mgmt":e==="PMO"?"Site PMO":"EPCM Contractor"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subView === "discipline" && (
        <div>
          <Panel title="FTE Demand — Mining vs Process & TSF" sub="Portfolio-level discipline split · Jan 2026 – Jun 2033" style={{ marginBottom:20 }}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={discData} margin={{top:5,right:10,left:10,bottom:5}}>
                <defs>
                  <linearGradient id="gMin" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient>
                  <linearGradient id="gPro" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
                <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tooltip_ metric="fte" />} />
                <Legend wrapperStyle={{fontSize:11,color:C.muted,fontFamily:C.font}} />
                <Area type="monotone" dataKey="Mining" stroke="#f59e0b" strokeWidth={2} fill="url(#gMin)" />
                <Area type="monotone" dataKey="Process & TSF" stroke="#06b6d4" strokeWidth={2} fill="url(#gPro)" />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            {[["Mining","#f59e0b",DISC_MODEL.Mining,DISC_ASIS.Mining],["Process & TSF","#06b6d4",DISC_MODEL.ProcessTSF,DISC_ASIS.ProcessTSF]].map(([name,col,mData,aData])=>{
              const peakM = Math.max(...mData.fte), peakA = Math.max(...aData.fte);
              const totalMCost = mData.cost.reduce((a,b)=>a+b,0), totalACost = aData.cost.reduce((a,b)=>a+b,0);
              const gap = fmt.gap(peakA,peakM);
              return (
                <Panel key={name} style={{ borderTop:`2px solid ${col}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                    <div style={{ fontSize:16, fontWeight:700, color:col, fontFamily:C.font }}>{name}</div>
                    <Tag label={`${gap}% gap`} color={gap>60?"#f87171":gap>30?"#fbbf24":"#34d399"} bg="rgba(255,255,255,0.05)" />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
                    <div><div style={{ fontSize:10, color:C.muted, fontFamily:C.font, marginBottom:4 }}>MODEL PEAK FTE</div><div style={{ fontSize:22, fontWeight:700, color:col, fontFamily:C.font }}>{peakM.toFixed(1)}</div></div>
                    <div><div style={{ fontSize:10, color:C.muted, fontFamily:C.font, marginBottom:4 }}>AS-IS PEAK FTE</div><div style={{ fontSize:22, fontWeight:700, color:C.asis, fontFamily:C.font }}>{peakA.toFixed(1)}</div></div>
                    <div><div style={{ fontSize:10, color:C.muted, fontFamily:C.font, marginBottom:4 }}>MODEL COST (60mo)</div><div style={{ fontSize:16, fontWeight:700, color:col, fontFamily:C.font }}>{fmt.cost(totalMCost)}</div></div>
                    <div><div style={{ fontSize:10, color:C.muted, fontFamily:C.font, marginBottom:4 }}>AS-IS COST (60mo)</div><div style={{ fontSize:16, fontWeight:700, color:C.asis, fontFamily:C.font }}>{fmt.cost(totalACost)}</div></div>
                  </div>
                  <ResponsiveContainer width="100%" height={130}>
                    <AreaChart data={MONTHS.map((m,i)=>({ month:m, Model:mData.fte[i], "As-Is":aData.fte[i] }))} margin={{top:0,right:0,left:-20,bottom:0}}>
                      <defs><linearGradient id={`gD${name}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={col} stopOpacity={0.25}/><stop offset="95%" stopColor={col} stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="month" tick={false} axisLine={false}/>
                      <YAxis tick={{fill:"rgba(255,255,255,0.3)",fontSize:9}} axisLine={false} tickLine={false}/>
                      <Tooltip content={<Tooltip_ metric="fte" />} />
                      <Area type="monotone" dataKey="Model" stroke={col} strokeWidth={1.5} fill={`url(#gD${name})`} />
                      <Area type="monotone" dataKey="As-Is" stroke={C.asis} strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Panel>
              );
            })}
          </div>
        </div>
      )}

      {subView === "gantt" && (
        <Panel title="Project Timeline" sub="Hover bars to see FTE & cost · Gap% = model vs as-is FTE">
          {showAddModal && <AddProjectModal onClose={()=>setShowAddModal(false)} onAdd={addProject} />}
          <div style={{ display:"flex", gap:8, marginBottom:16, alignItems:"center" }}>
            {[["all","All"],["Underground","UG"],["Surface","SF"]].map(([k,l])=>(
              <button key={k} onClick={()=>setGanttFilter(f=>({...f,type:k}))} style={{ padding:"4px 12px", borderRadius:20, border:`1px solid ${ganttFilter.type===k?C.model:C.faint}`, background:ganttFilter.type===k?"rgba(59,130,246,0.15)":"transparent", color:ganttFilter.type===k?"#60a5fa":C.muted, fontSize:11, cursor:"pointer", fontFamily:C.font }}>{l}</button>
            ))}
            {[["all","All Phases"],["PFS","PFS"],["FS","FS"],["FEED","FEED"],["Execution","EXE"]].map(([k,l])=>(
              <button key={k} onClick={()=>setGanttFilter(f=>({...f,phase:k}))} style={{ padding:"4px 12px", borderRadius:20, border:`1px solid ${ganttFilter.phase===k?(PHASE_COLORS[k]||C.model):C.faint}`, background:ganttFilter.phase===k?`${PHASE_COLORS[k]||C.model}20`:"transparent", color:ganttFilter.phase===k?(PHASE_COLORS[k]||"#60a5fa"):C.muted, fontSize:11, cursor:"pointer", fontFamily:C.font }}>{l}</button>
            ))}
            <button onClick={()=>setShowAddModal(true)} style={{ marginLeft:"auto", padding:"4px 14px", borderRadius:20, border:"1px solid rgba(59,130,246,0.4)", background:"rgba(59,130,246,0.12)", color:"#60a5fa", fontSize:11, cursor:"pointer", fontFamily:C.font, fontWeight:600 }}>+ Add Project</button>
          </div>
          <GanttView filter={ganttFilter} />
        </Panel>
      )}

      {subView === "capacity" && (
        <div>
          <Panel title="Portfolio Bottleneck Alerts" sub="Capacity constraints and resourcing risks" style={{ marginBottom:20 }}>
            <BottleneckAlerts />
          </Panel>
          <Panel title="Project Execution Capacity Limits" sub="Maximum concurrent projects · Direct loading · Average durations">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
              {Object.entries(CAPACITY_LIMITS).map(([type,lim])=>(
                <div key={type} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"16px" }}>
                  <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:12, lineHeight:1.4, fontFamily:C.font }}>{type}</div>
                  {[["Max concurrent", lim.max, lim.max===1?"#f87171":"#34d399"],["Direct loading",`${Math.round(lim.directLoad*100)}%`,"#60a5fa"],["Avg duration",`${lim.avgDuration} mo`,"#a78bfa"]].map(([lbl,val,col])=>(
                    <div key={lbl} style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:11, color:C.muted, fontFamily:C.font }}>{lbl}</span>
                      <span style={{ fontSize:13, fontWeight:700, color:col, fontFamily:C.font }}>{val}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:8, height:4, background:"rgba(255,255,255,0.08)", borderRadius:2 }}>
                    <div style={{ height:"100%", width:`${Math.min(100,lim.directLoad*100)}%`, background:lim.max===1?"#f87171":"#34d399", borderRadius:2 }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
};

// ─── VIEW 3: SCENARIO MODELLER ────────────────────────────────────────────────
const ScenarioView = () => {
  const { projects, addProject, MODEL_FTE, MODEL_MH, MODEL_COST, ASIS_FTE, ASIS_MH, ASIS_COST, ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS } = useContext(ProjectsCtx);
  const [scenarios, setScenarios] = useState([
    { id:1, name:"Baseline Model", color:"#3b82f6", params:{ fteScale:1.0, costScale:1.0, deferMonths:0, excludedProjects:[] } }
  ]);
  const [active, setActive]   = useState([1]);
  const [name, setName]       = useState("");
  const [params, setParams]   = useState({ fteScale:1.0, costScale:1.0, deferMonths:0 });

  const compute = useCallback((sc) => {
    const { fteScale, costScale, deferMonths, excludedProjects } = sc.params;
    const wt = (projects.length - excludedProjects.length) / projects.length;
    const fte  = Array.from({length:90}, (_,i) => { const j=i-deferMonths; return j>=0&&j<90 ? +(MODEL_FTE[j]*fteScale*wt).toFixed(2) : 0; });
    const cost = Array.from({length:90}, (_,i) => { const j=i-deferMonths; return j>=0&&j<90 ? Math.round(MODEL_COST[j]*costScale*wt) : 0; });
    return { fte, cost };
  }, [projects]);

  const addScenario = () => {
    if (!name.trim()) return;
    const id = Date.now();
    const color = SCENARIO_PAL[scenarios.length % SCENARIO_PAL.length];
    setScenarios(s => [...s, { id, name: name.trim(), color, params: { ...params, excludedProjects:[] } }]);
    setActive(a => [...a, id]);
    setName(""); setParams({ fteScale:1.0, costScale:1.0, deferMonths:0 });
  };

  const visible = scenarios.filter(s => active.includes(s.id));

  const chartData = MONTHS.map((m,i) => {
    const row = { month:m };
    visible.forEach(s => { const c = compute(s); row[s.name] = c.fte[i]; });
    row["As-Is"] = ASIS_FTE[i];
    return row;
  });

  const exportCSV = () => {
    const headers = ["Month","As-Is FTE",...visible.map(s=>s.name+" FTE")].join(",");
    const rows = MONTHS.map((m,i) => {
      const d = chartData[i];
      return [m, ASIS_FTE[i], ...visible.map(s=>d[s.name]||0)].join(",");
    });
    const csv = [headers,...rows].join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
    a.download = "harmony_resource_scenarios.csv";
    a.click();
  };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", gap:24 }}>
      {/* Left: builder + list */}
      <div>
        <Panel title="Build Scenario" style={{ marginBottom:14 }}>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, color:C.muted, display:"block", marginBottom:5, fontFamily:C.font, letterSpacing:1 }}>SCENARIO NAME</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Lean 80% Resourcing"
              style={{ width:"100%", padding:"8px 12px", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:13, outline:"none", fontFamily:C.font, boxSizing:"border-box" }} />
          </div>
          {[
            ["FTE SCALE", "fteScale", 0.3, 1.5, 0.05, "#60a5fa", v=>`${(v*100).toFixed(0)}% of model`],
            ["COST SCALE", "costScale", 0.5, 1.5, 0.05, "#a78bfa", v=>`${(v*100).toFixed(0)}% of model`],
            ["DEFER START", "deferMonths", 0, 24, 1, "#34d399", v=>`${v} months`],
          ].map(([lbl,key,min,max,step,col,fmt_])=>(
            <div key={key} style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <label style={{ fontSize:10, color:C.muted, fontFamily:C.font, letterSpacing:1 }}>{lbl}</label>
                <span style={{ fontSize:11, color:col, fontFamily:C.font }}>{fmt_(params[key])}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={params[key]}
                onChange={e=>setParams(p=>({...p,[key]: key==="deferMonths"?parseInt(e.target.value):parseFloat(e.target.value)}))}
                style={{ width:"100%", accentColor:col }} />
            </div>
          ))}
          <button onClick={addScenario} style={{ width:"100%", padding:"9px", borderRadius:8, border:"none", background:name.trim()?"rgba(59,130,246,0.8)":"rgba(255,255,255,0.06)", color:name.trim()?C.text:"rgba(255,255,255,0.3)", fontSize:13, fontWeight:600, cursor:name.trim()?"pointer":"not-allowed", fontFamily:C.font }}>+ Add Scenario</button>
        </Panel>

        <Panel title="Scenarios">
          {scenarios.map(s => {
            const on = active.includes(s.id);
            const c  = compute(s);
            const peak = Math.max(...c.fte).toFixed(1);
            const totalCost = (c.cost.reduce((a,b)=>a+b,0)/1000).toFixed(0);
            return (
              <div key={s.id} onClick={()=>setActive(a=>on&&a.length>1?a.filter(x=>x!==s.id):[...a,s.id])}
                style={{ padding:"11px 12px", borderRadius:8, marginBottom:8, background:on?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.01)", border:`1px solid ${on?s.color+"40":C.border}`, cursor:"pointer", opacity:on?1:0.5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <div style={{ width:9, height:9, borderRadius:"50%", background:s.color, flexShrink:0 }} />
                  <div style={{ fontSize:13, fontWeight:600, color:C.text, flex:1, fontFamily:C.font }}>{s.name}</div>
                  <div style={{ fontSize:10, color:on?s.color:C.muted, fontFamily:C.font }}>{on?"● ON":"○ OFF"}</div>
                </div>
                <div style={{ display:"flex", gap:14, fontSize:11, color:C.muted, fontFamily:C.font }}>
                  <span>Peak <span style={{color:s.color}}>{peak} FTE</span></span>
                  <span>Cost <span style={{color:"#a78bfa"}}>R{totalCost}m</span></span>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:5, fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:C.font }}>
                  <span>FTE×{s.params.fteScale}</span>
                  <span>Cost×{s.params.costScale}</span>
                  {s.params.deferMonths>0&&<span>Defer {s.params.deferMonths}mo</span>}
                </div>
              </div>
            );
          })}
          {/* As-Is anchor */}
          <div style={{ padding:"10px 12px", borderRadius:8, background:"rgba(255,255,255,0.02)", border:`1px dashed ${C.asis}40` }}>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4 }}>
              <div style={{ width:9, height:9, borderRadius:"50%", background:C.asis, flexShrink:0 }} />
              <div style={{ fontSize:13, fontWeight:600, color:"#34d399", fontFamily:C.font }}>As-Is</div>
              <span style={{ fontSize:10, color:C.muted, fontFamily:C.font }}>always shown</span>
            </div>
            <div style={{ fontSize:11, color:C.muted, fontFamily:C.font }}>Current deployment baseline</div>
          </div>
        </Panel>
      </div>

      {/* Right: charts */}
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:16, fontWeight:600, color:C.text, fontFamily:C.font }}>Scenario FTE Comparison</div>
          <button onClick={exportCSV} style={{ padding:"6px 16px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.muted, fontSize:12, cursor:"pointer", fontFamily:C.font }}>↓ Export CSV</button>
        </div>

        <Panel sub="Toggle scenarios on the left · As-Is always shown as dashed baseline" style={{ marginBottom:16 }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{top:5,right:10,left:10,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} interval={5}/>
              <YAxis tick={{fill:"rgba(255,255,255,0.35)",fontSize:10}} tickLine={false} axisLine={false}/>
              <Tooltip content={<Tooltip_ metric="fte" />} />
              {visible.map(s=><Line key={s.id} type="monotone" dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} />)}
              <Line type="monotone" dataKey="As-Is" stroke={C.asis} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        {/* Comparison cards */}
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(4,visible.length)},1fr)`, gap:12, marginBottom:16 }}>
          {visible.map(s => {
            const c = compute(s);
            const peak = Math.max(...c.fte);
            const totalC = c.cost.reduce((a,b)=>a+b,0);
            const vsAsIs = fmt.gap(Math.max(...ASIS_FTE), peak);
            return (
              <div key={s.id} style={{ background:C.surface, borderRadius:10, padding:"14px", borderTop:`2px solid ${s.color}` }}>
                <div style={{ fontSize:11, color:C.muted, fontFamily:C.font, marginBottom:6, lineHeight:1.4 }}>{s.name}</div>
                <div style={{ fontSize:24, fontWeight:700, color:s.color, fontFamily:C.font }}>{peak.toFixed(1)}</div>
                <div style={{ fontSize:11, color:C.muted, fontFamily:C.font }}>peak FTE</div>
                <div style={{ fontSize:15, color:"#a78bfa", fontWeight:600, marginTop:8, fontFamily:C.font }}>R{(totalC/1000).toFixed(0)}m</div>
                <div style={{ fontSize:11, color:C.muted, fontFamily:C.font }}>total cost</div>
                <div style={{ marginTop:8, fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:C.font }}>
                  vs As-Is peak: <span style={{color:vsAsIs>0?"#f87171":"#34d399"}}>{vsAsIs>0?"+":""}{vsAsIs}%</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Guide */}
        <Panel style={{ background:"rgba(59,130,246,0.05)", border:`1px solid rgba(59,130,246,0.2)` }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#93c5fd", marginBottom:10, fontFamily:C.font }}>Scenario Modelling Guide</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {[["FTE Scale","Adjust resource intensity — 80% models a lean approach, 120% models contingency"],["Cost Scale","Apply rate card changes — 120% models a 20% contractor rate increase"],["Defer Start","Shift the entire portfolio forward in time to test schedule sensitivity"],["Export CSV","Download all scenario data as a spreadsheet for further analysis in Excel"]].map(([t,d])=>(
              <div key={t}><div style={{ fontSize:12, fontWeight:600, color:"#60a5fa", marginBottom:3, fontFamily:C.font }}>{t}</div><div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", lineHeight:1.6, fontFamily:C.font }}>{d}</div></div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
};

// ─── ADD PROJECT INLINE VIEW ──────────────────────────────────────────────────
const AddProjectInline = ({ onAdd }) => {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name:"", type:"Underground", phase:"Execution", complexity:"High",
    startIdx:0, capex:"",
    scopeMining:true, scopeProcess:false, scopeTSF:false, scopeSurface:false,
    durationMonths:"",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [err, setErr] = useState("");
  const [submitted, setSubmitted] = useState(null);
  const [saving, setSaving]       = useState(false);

  const phaseKey    = `${form.phase} ${form.complexity}`;
  const defaultDur  = PHASE_DURATIONS[phaseKey] || 13;
  const duration    = form.durationMonths !== "" ? +form.durationMonths : Math.round(defaultDur);
  const endIdx      = Math.min(+form.startIdx + duration - 1, 89);
  const endLabel    = MONTHS[endIdx] || "Jun 2033";
  const hasFullScope= form.scopeProcess || form.scopeTSF;
  const ratioTable  = hasFullScope ? PMD_RATIOS.Full : PMD_RATIOS.Mining;
  const pmdRatio    = ratioTable[phaseKey] || 0;
  const capex       = parseFloat(form.capex) || 0;
  const pmdCostZARm = capex * pmdRatio;
  const entityKey   = `${form.type === "Underground" ? "UG" : "SF"}-${form.phase}`;
  const splits      = ENTITY_SPLITS[entityKey] || ENTITY_SPLITS["UG-Execution"];
  const blendedRate = Object.keys(RATE_CARDS).reduce((s,e) => s + RATE_CARDS[e]*splits[e], 0);
  const totalMH     = capex > 0 ? Math.round((pmdCostZARm * 1000) / (blendedRate / 160)) : 0;
  const peakFte     = capex > 0 && duration > 0 ? +(totalMH / (duration * 160)).toFixed(1) : 0;
  const monthlyCostK= peakFte > 0 ? Math.round(peakFte * blendedRate) : 0;

  function handleNext(e) {
    e.preventDefault();
    if (!form.name.trim()) return setErr("Project name is required.");
    if (!form.capex || parseFloat(form.capex) <= 0) return setErr("Capital cost is required.");
    setErr(""); setStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (duration < 1) return setErr("Duration must be at least 1 month.");
    if (endIdx > 89)  return setErr("Project end date exceeds the model horizon (Jun 2033).");
    if (peakFte <= 0) return setErr("Calculated FTE is zero — check your capital cost.");
    const { fte, cost, entities, endIdx: ei } = buildModelledArrays(
      +form.startIdx, duration, peakFte, monthlyCostK, splits, phaseKey
    );
    const project = {
      id: `custom_${Date.now()}`,
      name: form.name.trim(), type: form.type, phase: form.phase,
      complexity: form.complexity,
      finish: MONTHS[ei] || "—",
      model_mh: totalMH, model_fte: peakFte,
      model_cost: +((monthlyCostK * duration) / 1000).toFixed(1),
      asis_mh:0, asis_fte:0, asis_cost:0, hasAsIs:false,
      startIdx: +form.startIdx, endIdx: ei,
      fte, cost, entities, isCustom: true,
      _meta: {
        capex: form.capex,
        complexity: form.complexity,
        scope: { mining: form.scopeMining, process: form.scopeProcess, tsf: form.scopeTSF, surface: form.scopeSurface },
      },
    };
    setSaving(true);
    setErr("");
    try {
      await saveProjectToSupabase(project);
      await recomputePortfolio();
      onAdd(project);
      setSubmitted(project);
    } catch (e) {
      setErr(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Styles
  const lbl  = { display:"block", fontSize:11, color:C.muted, marginBottom:6, letterSpacing:0.5, fontFamily:C.font };
  const inp  = { width:"100%", padding:"10px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.05)", color:C.text, fontSize:14, outline:"none", fontFamily:C.font, boxSizing:"border-box" };
  const mb16 = { marginBottom:16 };

  const ToggleGroup = ({ label_, options, value, onChange }) => (
    <div style={mb16}>
      <div style={lbl}>{label_}</div>
      <div style={{ display:"flex", gap:8 }}>
        {options.map(([k,l]) => (
          <button key={k} type="button" onClick={()=>onChange(k)} style={{
            flex:1, padding:"10px 0", borderRadius:8, fontSize:13, cursor:"pointer", fontFamily:C.font, fontWeight:500,
            border:`1px solid ${value===k?"#3b82f6":"rgba(255,255,255,0.1)"}`,
            background: value===k?"rgba(59,130,246,0.2)":"rgba(255,255,255,0.03)",
            color: value===k?"#60a5fa":C.muted,
          }}>{l}</button>
        ))}
      </div>
    </div>
  );

  const ScopeToggle = ({ label_, field }) => {
    const on = form[field];
    return (
      <button type="button" onClick={()=>set(field,!on)} style={{
        padding:"10px 14px", borderRadius:8, fontSize:13, cursor:"pointer", fontFamily:C.font,
        border:`1px solid ${on?"#8b5cf6":"rgba(255,255,255,0.1)"}`,
        background: on?"rgba(139,92,246,0.2)":"rgba(255,255,255,0.03)",
        color: on?"#a78bfa":C.muted,
        display:"flex", alignItems:"center", gap:10, textAlign:"left",
      }}>
        <span style={{ fontSize:16, width:20, textAlign:"center" }}>{on?"✓":"○"}</span> {label_}
      </button>
    );
  };

  // Success state
  if (submitted) {
    return (
      <div style={{ maxWidth:640, margin:"60px auto", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>✓</div>
        <h2 style={{ fontSize:24, fontWeight:700, color:"#34d399", fontFamily:C.font, marginBottom:8 }}>{submitted.name} added</h2>
        <p style={{ color:C.muted, fontFamily:C.font, marginBottom:24 }}>
          The project has been added to the portfolio and the Resource Model has been updated.
        </p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:32 }}>
          {[["Peak FTE", submitted.model_fte.toFixed(1), "#60a5fa"],["Total Cost",`R${submitted.model_cost}m`,"#a78bfa"],["Manhours",`${(submitted.model_mh/1000).toFixed(1)}k`,"#93c5fd"]].map(([l,v,c])=>(
            <div key={l} style={{ background:C.surface, borderRadius:10, padding:"16px", border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, color:C.muted, fontFamily:C.font, marginBottom:4 }}>{l}</div>
              <div style={{ fontSize:22, fontWeight:700, color:c, fontFamily:C.font }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
          <button onClick={()=>{ setSubmitted(null); setStep(1); setForm({ name:"", type:"Underground", phase:"Execution", complexity:"High", startIdx:0, capex:"", scopeMining:true, scopeProcess:false, scopeTSF:false, scopeSurface:false, durationMonths:"" }); }}
            style={{ padding:"10px 24px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:C.font }}>
            Add Another Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth:720, margin:"0 auto" }}>
      {/* Step indicator */}
      <div style={{ display:"flex", gap:0, marginBottom:32, borderBottom:`1px solid ${C.border}` }}>
        {[["1","Project Details"],["2","Scope & Timing"]].map(([n,l],idx)=>(
          <div key={n} onClick={()=>idx===0&&setStep(1)} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 24px", cursor:idx===0?"pointer":"default",
            borderBottom:`2px solid ${step===idx+1?"#3b82f6":"transparent"}`, marginBottom:-1 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, fontFamily:C.font,
              background: step>idx?"#3b82f6":step===idx+1?"#3b82f6":"rgba(255,255,255,0.1)", color:"#fff" }}>{step>idx+1?"✓":n}</div>
            <span style={{ fontSize:13, color:step===idx+1?C.text:C.muted, fontFamily:C.font, fontWeight:step===idx+1?600:400 }}>{l}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <form onSubmit={handleNext}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:32 }}>
            <div>
              <div style={mb16}>
                <label style={lbl}>PROJECT NAME</label>
                <input style={inp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. New Shaft Feasibility Study" autoFocus />
              </div>
              <ToggleGroup label_="PROJECT TYPE" options={[["Underground","Underground"],["Surface","Surface"]]} value={form.type} onChange={v=>set("type",v)} />
              <ToggleGroup label_="STUDY PHASE"  options={[["PFS","PFS"],["FS","FS"],["FEED","FEED"],["Execution","Execution"]]} value={form.phase} onChange={v=>set("phase",v)} />
              <ToggleGroup label_="COMPLEXITY"   options={[["High","High"],["Low","Low"]]} value={form.complexity} onChange={v=>set("complexity",v)} />
            </div>
            <div>
              <div style={mb16}>
                <label style={lbl}>EXECUTION CAPITAL COST (ZARm)</label>
                <input style={inp} type="number" min="0" step="1" value={form.capex} onChange={e=>set("capex",e.target.value)} placeholder="e.g. 470" />
              </div>
              {capex > 0 && (
                <div style={{ background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.15)", borderRadius:10, padding:"16px", marginBottom:16 }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:C.font, marginBottom:10, letterSpacing:0.5 }}>PREVIEW — CALCULATED FROM MODEL</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    {[
                      ["PM&D Ratio",  `${(pmdRatio*100).toFixed(3)}%`, C.muted],
                      ["PM&D Cost",   `R${pmdCostZARm.toFixed(1)}m`, "#a78bfa"],
                      ["Est. Peak FTE",peakFte > 0 ? peakFte.toFixed(1) : "—", "#60a5fa"],
                      ["Est. Monthly", peakFte > 0 ? `R${(monthlyCostK/1000).toFixed(2)}m` : "—", "#34d399"],
                    ].map(([l,v,c])=>(
                      <div key={l}>
                        <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:C.font, marginBottom:2 }}>{l}</div>
                        <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:C.font }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:C.font, marginTop:10 }}>
                    Based on {phaseKey} · {hasFullScope ? "Full scope" : "Mining only"} ratios
                  </div>
                </div>
              )}
              <Panel style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:11, color:C.muted, fontFamily:C.font, lineHeight:1.7 }}>
                  <div style={{ fontWeight:600, color:C.text, marginBottom:6 }}>How capital cost is used</div>
                  The PM&D resource requirement is derived as a percentage of execution capital using benchmarking ratios from the Twickenham and Tumela reference projects. A higher capex means more complex scope, requiring proportionally more PM&D resource.
                </div>
              </Panel>
            </div>
          </div>
          {err && <div style={{ color:"#f87171", fontSize:13, marginTop:8, fontFamily:C.font }}>{err}</div>}
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:24 }}>
            <button type="submit" style={{ padding:"11px 32px", borderRadius:8, border:"none", background:"#3b82f6", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>
              Next — Scope & Timing →
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleSubmit}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:32 }}>
            <div>
              <div style={mb16}>
                <label style={lbl}>SCOPE INDICATORS — select all that apply</label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <ScopeToggle label_="Mining"                  field="scopeMining" />
                  <ScopeToggle label_="Processing / Metallurgical" field="scopeProcess" />
                  <ScopeToggle label_="TSF (Tailings Storage)"  field="scopeTSF" />
                  <ScopeToggle label_="Surface Infrastructure"  field="scopeSurface" />
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:8, fontFamily:C.font }}>
                  Scope affects entity split ratios. Adding Process or TSF shifts more resource to EPCM.
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, ...mb16 }}>
                <div>
                  <label style={lbl}>START MONTH</label>
                  <select style={{ ...inp, cursor:"pointer" }} value={form.startIdx} onChange={e=>set("startIdx",+e.target.value)}>
                    {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>DURATION (MONTHS) <span style={{ color:"rgba(255,255,255,0.25)" }}>default {Math.round(defaultDur)}</span></label>
                  <input style={inp} type="number" min="1" max="90"
                    value={form.durationMonths !== "" ? form.durationMonths : Math.round(defaultDur)}
                    onChange={e=>set("durationMonths",e.target.value)} />
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 16px", fontSize:12, color:C.muted, fontFamily:C.font }}>
                Est. finish: <span style={{ color:C.text, fontWeight:600 }}>{endLabel}</span>
                {endIdx >= 89 && <span style={{ color:"#f59e0b", marginLeft:8 }}>⚠ Reaches model horizon</span>}
              </div>
            </div>
            <div>
              {/* Full output preview */}
              <Panel title="Final Model Output" style={{ marginBottom:16 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                  {[
                    ["Peak FTE",     peakFte > 0 ? peakFte.toFixed(1) : "—",               "#60a5fa"],
                    ["PM&D Cost",    capex > 0 ? `R${pmdCostZARm.toFixed(1)}m` : "—",      "#a78bfa"],
                    ["Monthly Cost", peakFte > 0 ? `R${(monthlyCostK/1000).toFixed(2)}m` : "—", "#34d399"],
                    ["Total MH",     totalMH > 0 ? `${(totalMH/1000).toFixed(1)}k` : "—",  "#93c5fd"],
                    ["Duration",     `${duration} months`,                                   C.muted],
                    ["Est. Finish",  endLabel,                                               C.muted],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{ background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:C.font, marginBottom:3, letterSpacing:0.5 }}>{l}</div>
                      <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:C.font }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
                  <div style={{ fontSize:10, color:C.muted, fontFamily:C.font, marginBottom:6 }}>ENTITY SPLIT</div>
                  <div style={{ display:"flex", gap:0, height:8, borderRadius:4, overflow:"hidden", marginBottom:6 }}>
                    {Object.entries(splits).map(([e,pct])=>(
                      <div key={e} style={{ width:`${pct*100}%`, background:ENTITY_COLORS[e] }} />
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:12 }}>
                    {Object.entries(splits).map(([e,pct])=>(
                      <span key={e} style={{ fontSize:10, color:ENTITY_COLORS[e], fontFamily:C.font }}>{e} {Math.round(pct*100)}%</span>
                    ))}
                  </div>
                </div>
              </Panel>
              <Panel style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:11, color:C.muted, fontFamily:C.font, lineHeight:1.7 }}>
                  <div style={{ fontWeight:600, color:C.text, marginBottom:6 }}>Adding: {form.name || "New Project"}</div>
                  <div><span style={{ color:"rgba(255,255,255,0.4)" }}>Type:</span> {form.type} · {phaseKey}</div>
                  <div><span style={{ color:"rgba(255,255,255,0.4)" }}>Capex:</span> R{form.capex||"—"}m</div>
                  <div><span style={{ color:"rgba(255,255,255,0.4)" }}>Start:</span> {MONTHS[+form.startIdx]} → {endLabel}</div>
                </div>
              </Panel>
            </div>
          </div>
          {err && <div style={{ color:"#f87171", fontSize:13, marginTop:8, fontFamily:C.font }}>{err}</div>}
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:24 }}>
            <button type="button" onClick={()=>{setStep(1);setErr("");}} style={{ padding:"11px 24px", borderRadius:8, border:"1px solid rgba(255,255,255,0.12)", background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:C.font }}>
              ← Back
            </button>
            <button type="submit" disabled={saving} style={{ padding:"11px 32px", borderRadius:8, border:"none", background: saving?"rgba(16,185,129,0.5)":"#10b981", color:"#fff", fontSize:14, fontWeight:600, cursor: saving?"not-allowed":"pointer", fontFamily:C.font }}>
              {saving ? "Saving…" : "Add to Portfolio"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

// ─── SETTINGS VIEW ────────────────────────────────────────────────────────────
const SettingsView = ({ target, onReload }) => {
  const { projects, PMD_RATIOS, PHASE_DURATIONS, RATE_CARDS, RAMP_SHAPES } = useContext(ProjectsCtx);
  const modelConfig = { PMD_RATIOS, PHASE_DURATIONS, RATE_CARDS, RAMP_SHAPES };

  const [section, setSection] = useState(target?.section || "projects");
  const [editingId, setEditingId] = useState(target?.projectId || null);
  const [editForm, setEditForm]   = useState({});
  const [preview,  setPreview]    = useState(null); // live recalc preview
  const [saving,   setSaving]     = useState(false);
  const [saved,    setSaved]      = useState(null);
  const [err,      setErr]        = useState("");

  // When target changes (navigated from table), update section + open correct project
  useEffect(() => {
    if (target) {
      setSection(target.section || "projects");
      setEditingId(target.projectId || null);
    }
  }, [target]);

  // Open edit form for a project
  function openEdit(p) {
    setEditingId(p.id);
    setEditForm({
      name:           p.name,
      type:           p.type,
      phase:          p.phase,
      complexity:     p.complexity || "High",
      finish:         p.finish || "",
      capex:          p.capex || "",
      startIdx:       p.startIdx || 0,
      durationMonths: p.endIdx != null ? p.endIdx - (p.startIdx||0) + 1 : null,
      scope_mining:   p.scope_mining  ?? (p.type==="Underground"),
      scope_process:  p.scope_process ?? false,
      scope_tsf:      p.scope_tsf     ?? false,
      scope_surface:  p.scope_surface ?? false,
      // Track original values to detect model-significant changes
      _orig: { phase:p.phase, complexity:p.complexity, capex:p.capex,
               scope_mining:p.scope_mining, scope_process:p.scope_process,
               scope_tsf:p.scope_tsf, scope_surface:p.scope_surface,
               startIdx:p.startIdx, durationMonths:p.endIdx!=null?p.endIdx-(p.startIdx||0)+1:null },
    });
    setPreview(null); setErr(""); setSaved(null);
  }

  // Determine if any model-significant field has changed
  const isModelChanged = editForm._orig ? (
    editForm.phase         !== editForm._orig.phase         ||
    editForm.complexity    !== editForm._orig.complexity    ||
    String(editForm.capex) !== String(editForm._orig.capex || "") ||
    editForm.scope_mining  !== editForm._orig.scope_mining  ||
    editForm.scope_process !== editForm._orig.scope_process ||
    editForm.scope_tsf     !== editForm._orig.scope_tsf     ||
    editForm.scope_surface !== editForm._orig.scope_surface ||
    editForm.startIdx      !== editForm._orig.startIdx      ||
    String(editForm.durationMonths) !== String(editForm._orig.durationMonths || "")
  ) : false;

  // Live preview — compute when model-significant fields change
  useEffect(() => {
    if (!isModelChanged || !editForm.capex || parseFloat(editForm.capex) <= 0) {
      setPreview(null); return;
    }
    const phaseKey = `${editForm.phase} ${editForm.complexity}`;
    const hasFullScope = editForm.scope_process || editForm.scope_tsf || editForm.scope_surface;
    const scopeType = hasFullScope ? "Full" : "Mining";
    const pmdRatio  = PMD_RATIOS[scopeType]?.[phaseKey] || 0;
    const capex     = parseFloat(editForm.capex) || 0;
    const pmdCost   = pmdRatio * capex; // ZARm
    const dur       = parseFloat(editForm.durationMonths) || PHASE_DURATIONS[phaseKey] || 13;

    // Blended rate estimate from rate cards (approximate entity split)
    const blended = (RATE_CARDS.OT||269)*0.025 + (RATE_CARDS.CPMO||256)*0.13 +
                    (RATE_CARDS.PMO||240)*0.15  + (RATE_CARDS.EPCM||304)*0.66;
    const peakFTE  = pmdCost * 1000 / (blended * dur);
    const monthlyK = peakFTE * blended;

    setPreview({ pmdCost, peakFTE: +peakFTE.toFixed(1), monthlyK: Math.round(monthlyK),
                 totalCostM: +(monthlyK * dur / 1000).toFixed(1), dur });
  }, [editForm.phase, editForm.complexity, editForm.capex,
      editForm.scope_mining, editForm.scope_process, editForm.scope_tsf, editForm.scope_surface,
      editForm.durationMonths, isModelChanged]);

  async function handleSave(projectId) {
    setSaving(true); setErr("");
    try {
      // 1. Save metadata to projects table
      const patch = {
        name:          editForm.name,
        type:          editForm.type,
        phase:         editForm.phase,
        complexity:    editForm.complexity,
        finish:        editForm.finish || null,
        capex:         editForm.capex ? parseFloat(editForm.capex) : null,
        scope_mining:  editForm.scope_mining,
        scope_process: editForm.scope_process,
        scope_tsf:     editForm.scope_tsf,
        scope_surface: editForm.scope_surface,
        updated_at:    new Date().toISOString(),
      };
      const r = await fetch(`${SB_URL}/rest/v1/projects?id=eq.${projectId}`, {
        method:"PATCH",
        headers:{ ...sbHeaders, "Content-Type":"application/json", "Prefer":"return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`Save failed: ${await r.text()}`);

      // 2. If model-significant fields changed, recalculate monthly arrays
      if (isModelChanged) {
        const currentProject = projects.find(p => p.id === projectId);
        await recalculateProject(projectId, editForm, modelConfig, currentProject);
        await recomputePortfolio();
      }

      setSaved(projectId);
      setEditingId(null);
      setPreview(null);
      onReload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(projectId) {
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    setSaving(true);
    try {
      await fetch(`${SB_URL}/rest/v1/project_monthly_data?project_id=eq.${projectId}`, {
        method:"DELETE", headers:sbHeaders });
      await fetch(`${SB_URL}/rest/v1/projects?id=eq.${projectId}`, {
        method:"DELETE", headers:sbHeaders });
      onReload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const inp = { width:"100%", padding:"8px 12px", borderRadius:7, border:`1px solid rgba(255,255,255,0.12)`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, outline:"none", fontFamily:C.font, boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, color:C.muted, marginBottom:4, letterSpacing:0.5, fontFamily:C.font };

  const SECTIONS = [
    { id:"projects",  label:"Projects",        icon:"◈" },
    { id:"actuals",   label:"As-Is Actuals",   icon:"◎" },
    { id:"rateCards", label:"Rate Cards",      icon:"$" },
    { id:"ratios",    label:"PM&D Ratios",     icon:"%" },
    { id:"capacity",  label:"Capacity Limits", icon:"⊞" },
    { id:"rampShapes",label:"Ramp Shapes",     icon:"~" },
  ];

  return (
    <div style={{ display:"grid", gridTemplateColumns:"200px 1fr", gap:24, minHeight:600 }}>
      {/* Sidebar */}
      <div style={{ background:"rgba(255,255,255,0.02)", borderRadius:12, border:`1px solid ${C.border}`, padding:8 }}>
        {SECTIONS.map(s=>(
          <button key={s.id} onClick={()=>{ setSection(s.id); setEditingId(null); }} style={{
            display:"flex", alignItems:"center", gap:10, width:"100%", padding:"10px 12px",
            borderRadius:8, border:"none", cursor:"pointer", fontFamily:C.font, fontSize:13,
            background: section===s.id?"rgba(59,130,246,0.15)":"transparent",
            color: section===s.id?C.text:C.muted,
            fontWeight: section===s.id?600:400,
          }}>
            <span style={{ fontSize:12 }}>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>

      {/* Main panel */}
      <div>

        {/* ── Section bio helper ── */}
        {(() => {
          const bios = {
            projects: {
              title: "Project Details",
              desc:  "Edit the core metadata for any project in the portfolio — name, type, phase, complexity, capital cost, and scope indicators. When you change a model-significant field (capex, phase, complexity, or scope), the app automatically recalculates the monthly FTE and cost arrays using the benchmarking model and updates the portfolio charts. Changes marked 'Save & Recalculate' will update the demand curves; changes to name or finish date only update the label.",
              tip:   "Click Edit on a project row to expand its form. A live preview shows the estimated impact before you save.",
            },
            actuals: {
              title: "As-Is Actuals",
              desc:  "Enter actual deployed FTE and monthly cost data for any project as real resourcing information becomes available. This is how the 'As-Is' side of the gap analysis gets updated — without this data, the As-Is view shows modelled estimates only. Select a project, fill in the months that have real data, and save. The portfolio As-Is charts update automatically.",
              tip:   "Only active months are shown (between the project's start and end date). Green cells indicate months with data entered. You don't have to fill every month — partial data is fine.",
            },
            rateCards: {
              title: "Rate Cards",
              desc:  "The average hourly billing rates used for each resourcing entity — OT (Owners Team), CPMO (Capital Portfolio Management Office), PMO (Site Project Management Office), and EPCM (Engineering, Procurement & Construction contractor). These rates drive the cost calculations for any new project added through the app. They were originally sourced from the Twickenham and Tumela benchmark projects.",
              tip:   "Changing a rate card affects new projects added going forward. Existing project monthly cost arrays are not retroactively updated — use 'Save & Recalculate' on individual projects to apply new rates to existing data.",
            },
            ratios: {
              title: "PM&D Ratios",
              desc:  "PM&D stands for Project Management & Delivery — it represents the resourcing cost as a percentage of the project's execution capital. These ratios are the foundation of the benchmarking model: when you add a new project and enter its capital cost, the app multiplies it by the relevant ratio to derive the total PM&D budget, from which all FTE and cost figures are calculated. They come from the Twickenham and Tumela reference projects.",
              tip:   "There are two ratio sets — 'Mining' scope (underground mining-only projects) and 'Full' scope (projects that include Processing and/or TSF disciplines). Make sure you understand what drives a ratio before changing it, as it will affect all new projects of that type.",
            },
            capacity: {
              title: "Capacity Limits",
              desc:  "These rules define how many projects of each type Harmony's PM&D organisation can realistically manage at the same time, and how long each study phase typically takes. The 'Max Concurrent' limit is used by the Bottleneck Alerts in the Resource Model to flag scheduling conflicts. The 'Avg Duration' is used as the default project length when adding a new project — the user can override it, but this provides the starting point.",
              tip:   "For example, if the organisation can only support one Execution High Complexity project at a time, setting Max Concurrent to 1 will trigger an alert whenever two overlap in the timeline. Update durations if project delivery experience shows the benchmarks are too short or long.",
            },
            rampShapes: {
              title: "Ramp Shapes",
              desc:  "Ramp shapes control how a project's resource demand builds up at the start and winds down at the end of a phase. Rather than a flat rectangular block of FTE, real projects follow a curve — a slow mobilisation, a sustained plateau, then a demobilisation. These curves are defined as fractions of the peak FTE for each month at the start and end of a project. For example, an Execution High project might ramp to 32% of peak in month 1, 76% in month 2, then reach 100% from month 3 onwards.",
              tip:   "Ramp shapes affect only new projects added through the app and recalculations triggered by edits. Editing them incorrectly can silently distort demand curves — it is recommended to adjust these only if actual project experience consistently shows the current shapes are wrong.",
            },
          };
          const bio = bios[section];
          if (!bio) return null;
          return (
            <div style={{ background:"rgba(255,255,255,0.025)", border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 18px", marginBottom:24 }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.text, fontFamily:C.font, marginBottom:6 }}>{bio.title}</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontFamily:C.font, lineHeight:1.7, marginBottom: bio.tip ? 10 : 0 }}>{bio.desc}</div>
              {bio.tip && (
                <div style={{ display:"flex", gap:8, alignItems:"flex-start", background:"rgba(59,130,246,0.07)", borderRadius:7, padding:"8px 12px" }}>
                  <span style={{ fontSize:12, color:"#60a5fa", flexShrink:0, marginTop:1 }}>💡</span>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:C.font, lineHeight:1.6 }}>{bio.tip}</div>
                </div>
              )}
            </div>
          );
        })()}
            {err && <div style={{ color:"#f87171", fontSize:13, marginBottom:12, fontFamily:C.font }}>{err}</div>}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {projects.map(p => {
                const isEditing = editingId === p.id;
                const wasSaved  = saved === p.id;
                return (
                  <div key={p.id} style={{ background:C.surface, border:`1px solid ${isEditing?"#3b82f6":C.border}`, borderRadius:10, overflow:"hidden", transition:"border 0.2s" }}>
                    {/* Row header */}
                    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px" }}>
                      <div style={{ flex:1, display:"flex", alignItems:"center", gap:10 }}>
                        <Tag label={p.type.slice(0,3).toUpperCase()} color={p.type==="Underground"?C.UG:C.SF} bg={p.type==="Underground"?"rgba(139,92,246,0.15)":"rgba(16,185,129,0.15)"} />
                        <Tag label={p.phase} color={PHASE_COLORS[p.phase]} bg={`${PHASE_COLORS[p.phase]}20`} />
                        <span style={{ fontSize:13, fontWeight:600, color:C.text, fontFamily:C.font }}>{p.name}</span>
                        {p.isCustom && <Tag label="Custom" color="#f59e0b" bg="rgba(245,158,11,0.15)" />}
                        {wasSaved  && <span style={{ fontSize:11, color:"#34d399", fontFamily:C.font }}>✓ Saved</span>}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        {isEditing ? (
                          <>
                            <button onClick={()=>{ setEditingId(null); setErr(""); }} style={{ padding:"6px 14px", borderRadius:7, border:`1px solid rgba(255,255,255,0.12)`, background:"transparent", color:C.muted, fontSize:12, cursor:"pointer", fontFamily:C.font }}>Cancel</button>
                            <button onClick={()=>handleSave(p.id)} disabled={saving} style={{ padding:"6px 14px", borderRadius:7, border:"none", background:saving?"rgba(59,130,246,0.4)":"#3b82f6", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>
                              {saving ? (isModelChanged?"Recalculating…":"Saving…") : (isModelChanged && editForm.capex?"Save & Recalculate":"Save")}
                            </button>
                            {p.isCustom && <button onClick={()=>handleDelete(p.id)} style={{ padding:"6px 14px", borderRadius:7, border:"1px solid rgba(239,68,68,0.4)", background:"rgba(239,68,68,0.1)", color:"#f87171", fontSize:12, cursor:"pointer", fontFamily:C.font }}>Delete</button>}
                          </>
                        ) : (
                          <button onClick={()=>openEdit(p)} style={{ padding:"6px 14px", borderRadius:7, border:`1px solid rgba(255,255,255,0.12)`, background:"transparent", color:C.muted, fontSize:12, cursor:"pointer", fontFamily:C.font }}>Edit</button>
                        )}
                      </div>
                    </div>

                    {/* Edit form */}
                    {isEditing && (
                      <div style={{ borderTop:`1px solid rgba(59,130,246,0.2)`, padding:"16px", background:"rgba(59,130,246,0.04)" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:12 }}>
                          <div>
                            <label style={lbl}>NAME</label>
                            <input style={inp} value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} />
                          </div>
                          <div>
                            <label style={lbl}>TYPE</label>
                            <select style={{...inp,cursor:"pointer"}} value={editForm.type} onChange={e=>setEditForm(f=>({...f,type:e.target.value}))}>
                              <option>Underground</option><option>Surface</option>
                            </select>
                          </div>
                          <div>
                            <label style={lbl}>PHASE</label>
                            <select style={{...inp,cursor:"pointer"}} value={editForm.phase} onChange={e=>setEditForm(f=>({...f,phase:e.target.value}))}>
                              <option>PFS</option><option>FS</option><option>FEED</option><option>Execution</option>
                            </select>
                          </div>
                          <div>
                            <label style={lbl}>COMPLEXITY</label>
                            <select style={{...inp,cursor:"pointer"}} value={editForm.complexity} onChange={e=>setEditForm(f=>({...f,complexity:e.target.value}))}>
                              <option>High</option><option>Low</option>
                            </select>
                          </div>
                          <div>
                            <label style={lbl}>CAPEX (ZARm) <span style={{color:"rgba(255,255,255,0.25)"}}>execution capital</span></label>
                            <input style={inp} type="number" value={editForm.capex} onChange={e=>setEditForm(f=>({...f,capex:e.target.value}))} placeholder="e.g. 470" />
                          </div>
                          <div>
                            <label style={lbl}>EST. FINISH</label>
                            <input style={inp} value={editForm.finish} onChange={e=>setEditForm(f=>({...f,finish:e.target.value}))} placeholder="e.g. Jun 2031" />
                          </div>
                          <div>
                            <label style={lbl}>START MONTH</label>
                            <select style={{...inp,cursor:"pointer"}} value={editForm.startIdx||0} onChange={e=>setEditForm(f=>({...f,startIdx:+e.target.value}))}>
                              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={lbl}>DURATION (MONTHS)</label>
                            <input style={inp} type="number" min="1" max="90"
                              value={editForm.durationMonths || ""}
                              onChange={e=>setEditForm(f=>({...f,durationMonths:e.target.value}))}
                              placeholder={`default ${Math.round(PHASE_DURATIONS[`${editForm.phase} ${editForm.complexity}`]||13)}`} />
                          </div>
                        </div>

                        <div style={{ marginBottom:12 }}>
                          <label style={lbl}>SCOPE INDICATORS</label>
                          <div style={{ display:"flex", gap:8 }}>
                            {[["scope_mining","Mining"],["scope_process","Processing"],["scope_tsf","TSF"],["scope_surface","Surface Infra"]].map(([k,l])=>(
                              <button key={k} type="button" onClick={()=>setEditForm(f=>({...f,[k]:!f[k]}))} style={{
                                padding:"6px 12px", borderRadius:7, fontSize:12, cursor:"pointer", fontFamily:C.font,
                                border:`1px solid ${editForm[k]?"#8b5cf6":"rgba(255,255,255,0.1)"}`,
                                background: editForm[k]?"rgba(139,92,246,0.2)":"rgba(255,255,255,0.03)",
                                color: editForm[k]?"#a78bfa":C.muted,
                              }}>{editForm[k]?"✓ ":""}{l}</button>
                            ))}
                          </div>
                        </div>

                        {/* Live recalculation preview */}
                        {isModelChanged && preview && (
                          <div style={{ background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.25)", borderRadius:8, padding:"12px 14px", marginBottom:12 }}>
                            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:C.font, letterSpacing:0.5, marginBottom:8 }}>RECALCULATION PREVIEW — SAVE WILL UPDATE MONTHLY ARRAYS</div>
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                              {[
                                ["Peak FTE",     preview.peakFTE.toFixed(1),              "#60a5fa"],
                                ["PM&D Cost",    `R${preview.pmdCost.toFixed(1)}m`,        "#a78bfa"],
                                ["Monthly Cost", `R${(preview.monthlyK/1000).toFixed(2)}m`,"#34d399"],
                                ["Total Cost",   `R${preview.totalCostM}m`,                "#93c5fd"],
                              ].map(([l,v,c])=>(
                                <div key={l}>
                                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:C.font, marginBottom:2 }}>{l}</div>
                                  <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:C.font }}>{v}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {isModelChanged && !preview && editForm.capex && (
                          <div style={{ fontSize:11, color:"#f59e0b", fontFamily:C.font, marginBottom:12 }}>
                            ⚠ Model-significant fields changed — monthly arrays will be recalculated on save.
                          </div>
                        )}

                        {!isModelChanged && (
                          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:C.font, marginBottom:12 }}>
                            Only name, type, or finish date changed — monthly arrays will not be recalculated.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── As-Is Actuals section ── */}
        {section==="actuals" && (
          <ActualsEditor
            projects={projects}
            initialProjectId={target?.projectId}
            onReload={onReload}
          />
        )}

        {/* ── Rate Cards section ── */}
        {section==="rateCards" && (
          <RateCardEditor onReload={onReload} />
        )}

        {/* ── PM&D Ratios section ── */}
        {section==="ratios" && (
          <PMDRatioEditor onReload={onReload} />
        )}

        {/* ── Capacity Limits section ── */}
        {section==="capacity" && (
          <CapacityLimitsEditor onReload={onReload} />
        )}

        {/* ── Ramp Shapes section ── */}
        {section==="rampShapes" && (
          <div>
            <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:10, padding:"20px" }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.text, fontFamily:C.font, marginBottom:14 }}>Current Ramp Shapes</div>
              {[
                { phase:"Execution High", up:[0.32,0.76], down:[0.79,0.28] },
                { phase:"Execution Low",  up:[0.40,0.80], down:[0.70,0.30] },
                { phase:"FEED High",      up:[0.15,0.42,0.56], down:[0.60,0.25] },
                { phase:"FEED Low",       up:[0.20,0.55], down:[0.55,0.25] },
                { phase:"FS High",        up:[0.03,0.36,0.64,0.85], down:[0.36] },
                { phase:"FS Low",         up:[0.10,0.50,0.80], down:[0.40] },
                { phase:"PFS High",       up:[0.48,0.70,0.90], down:[0.45] },
                { phase:"PFS Low",        up:[0.50,0.80], down:[0.50] },
              ].map(r=>(
                <div key={r.phase} style={{ display:"flex", alignItems:"center", gap:16, padding:"10px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                  <div style={{ width:160, fontSize:12, color:C.text, fontFamily:C.font, fontWeight:500 }}>{r.phase}</div>
                  <div style={{ flex:1 }}>
                    {/* Mini ramp visualisation */}
                    <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:28 }}>
                      {[...r.up, ...Array(Math.max(0, 6 - r.up.length - r.down.length)).fill(1), ...r.down].map((v,i)=>(
                        <div key={i} style={{ flex:1, background: i < r.up.length ? "#3b82f6" : i >= r.up.length + Math.max(0,6-r.up.length-r.down.length) ? "#8b5cf6" : "#34d399", borderRadius:2, height:`${v*100}%`, minHeight:2 }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:C.muted, fontFamily:C.font, textAlign:"right" }}>
                    <span style={{ color:"#60a5fa" }}>↑ {r.up.map(v=>Math.round(v*100)+'%').join(', ')}</span>
                    <span style={{ margin:"0 6px", color:"rgba(255,255,255,0.15)" }}>·</span>
                    <span style={{ color:"#a78bfa" }}>↓ {r.down.map(v=>Math.round(v*100)+'%').join(', ')}</span>
                  </div>
                </div>
              ))}
              <div style={{ marginTop:14, padding:"10px 14px", background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:8 }}>
                <div style={{ fontSize:11, color:"#fbbf24", fontFamily:C.font, lineHeight:1.6 }}>
                  ⚠ Ramp shapes are not editable through the app UI. They are derived from the Twickenham and Tumela benchmark projects and should only be changed by updating the source data and re-running the migration. Contact your implementation team if adjustments are needed.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// ─── AS-IS ACTUALS EDITOR ─────────────────────────────────────────────────────
const ActualsEditor = ({ projects, initialProjectId, onReload }) => {
  const [selectedId, setSelectedId] = useState(initialProjectId || null);
  const [rows,       setRows]       = useState([]); // { month_idx, month, model_fte, model_cost, asis_fte, asis_cost }
  const [edits,      setEdits]      = useState({}); // { month_idx: { asis_fte, asis_cost } }
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [err,        setErr]        = useState("");

  const project = projects.find(p => p.id === selectedId);

  // Load monthly data when project changes
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true); setEdits({}); setSaved(false); setErr("");
    sbFetch("project_monthly_data", `?project_id=eq.${selectedId}&select=*&order=month_idx.asc`)
      .then(data => {
        const p = projects.find(p => p.id === selectedId);
        // Only show active months (between startIdx and endIdx)
        const activeRows = data
          .filter(r => r.month_idx >= (p?.startIdx||0) && r.month_idx <= (p?.endIdx||89))
          .map(r => ({
            month_idx:  r.month_idx,
            month:      MONTHS[r.month_idx] || `Month ${r.month_idx}`,
            model_fte:  r.model_fte  || 0,
            model_cost: r.model_cost || 0,
            asis_fte:   r.asis_fte   || 0,
            asis_cost:  r.asis_cost  || 0,
          }));
        setRows(activeRows);
        // Pre-fill edits with existing As-Is values
        const init = {};
        activeRows.forEach(r => {
          init[r.month_idx] = {
            asis_fte:  r.asis_fte  > 0 ? String(r.asis_fte)  : "",
            asis_cost: r.asis_cost > 0 ? String(r.asis_cost) : "",
          };
        });
        setEdits(init);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [selectedId]);

  function setEdit(monthIdx, field, value) {
    setEdits(prev => ({
      ...prev,
      [monthIdx]: { ...prev[monthIdx], [field]: value },
    }));
    setSaved(false);
  }

  // Count months with any actual data entered
  const filledMonths = Object.values(edits).filter(e =>
    (e.asis_fte && parseFloat(e.asis_fte) > 0) ||
    (e.asis_cost && parseFloat(e.asis_cost) > 0)
  ).length;

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      const upsertHeaders = {
        ...sbHeaders,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      };

      // Build update rows — only for months we have edit data for
      const updateRows = rows.map(r => ({
        project_id: selectedId,
        month_idx:  r.month_idx,
        model_fte:  r.model_fte,
        model_cost: r.model_cost,
        asis_fte:   parseFloat(edits[r.month_idx]?.asis_fte)  || 0,
        asis_cost:  parseFloat(edits[r.month_idx]?.asis_cost) || 0,
        ot_fte:     0, cpmo_fte: 0, pmo_fte: 0, epcm_fte: 0,
      }));

      // Upsert in batches
      for (let i = 0; i < updateRows.length; i += 200) {
        const r = await fetch(`${SB_URL}/rest/v1/project_monthly_data`, {
          method: "POST",
          headers: upsertHeaders,
          body: JSON.stringify(updateRows.slice(i, i+200)),
        });
        if (!r.ok) throw new Error(`Failed to save: ${await r.text()}`);
      }

      // Update project summary As-Is stats and set has_asis = true if any data
      const hasData = filledMonths > 0;
      const peakAsisFte  = Math.max(...updateRows.map(r => r.asis_fte),  0);
      const totalAsisCost= updateRows.reduce((s,r) => s + r.asis_cost, 0);
      const totalAsisMH  = updateRows.reduce((s,r) => s + r.asis_fte * 160, 0);

      await fetch(`${SB_URL}/rest/v1/projects?id=eq.${selectedId}`, {
        method: "PATCH",
        headers: { ...sbHeaders, "Content-Type":"application/json", "Prefer":"return=minimal" },
        body: JSON.stringify({
          has_asis:   hasData,
          asis_fte:   +peakAsisFte.toFixed(2),
          asis_cost:  +(totalAsisCost / 1000).toFixed(1), // ZARm
          asis_mh:    Math.round(totalAsisMH),
          updated_at: new Date().toISOString(),
        }),
      });

      setSaved(true);
      onReload();
      // Recompute portfolio totals to reflect new As-Is data
      recomputePortfolio().catch(e => console.warn("Portfolio recompute failed:", e));
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function handleClear() {
    if (!window.confirm("Clear all As-Is data for this project?")) return;
    const cleared = {};
    rows.forEach(r => { cleared[r.month_idx] = { asis_fte:"", asis_cost:"" }; });
    setEdits(cleared);
    setSaved(false);
  }

  const inp = (val, onChange, hasValue) => ({
    value: val,
    onChange,
    style: {
      width:"100%", padding:"5px 8px", borderRadius:5, fontSize:12, textAlign:"right",
      border:`1px solid ${hasValue ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.08)"}`,
      background: hasValue ? "rgba(52,211,153,0.06)" : "rgba(255,255,255,0.03)",
      color: hasValue ? "#34d399" : C.muted, outline:"none", fontFamily:C.font,
      boxSizing:"border-box",
    },
  });

  return (
    <div>
      <div style={{ fontSize:14, fontWeight:600, color:C.text, fontFamily:C.font, marginBottom:4 }}>As-Is Actuals</div>
      <div style={{ fontSize:13, color:C.muted, fontFamily:C.font, marginBottom:20, lineHeight:1.6 }}>
        Enter actual deployed FTE and monthly cost per project. Only active months are shown.
        <span style={{ color:"#34d399" }}> Green cells</span> indicate months with data entered.
        {projects.filter(p=>p.hasAsIs).length > 0 && (
          <span> · {projects.filter(p=>p.hasAsIs).length} project{projects.filter(p=>p.hasAsIs).length>1?"s":""} currently have actuals: {projects.filter(p=>p.hasAsIs).map(p=>p.name.split(" ")[0]).join(", ")}.</span>
        )}
      </div>

      {/* Project selector */}
      <div style={{ marginBottom:20 }}>
        <label style={{ display:"block", fontSize:10, color:C.muted, marginBottom:6, letterSpacing:0.5, fontFamily:C.font }}>SELECT PROJECT</label>
        <select
          value={selectedId || ""}
          onChange={e=>setSelectedId(e.target.value || null)}
          style={{ padding:"9px 14px", borderRadius:8, border:`1px solid rgba(255,255,255,0.12)`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, outline:"none", fontFamily:C.font, cursor:"pointer", minWidth:320 }}>
          <option value="">— Choose a project —</option>
          {projects.map(p=>(
            <option key={p.id} value={p.id}>
              {p.hasAsIs ? "✓ " : "  "}{p.name} ({p.phase})
            </option>
          ))}
        </select>
      </div>

      {/* Editor */}
      {selectedId && !loading && project && (
        <div>
          {/* Header info */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
            <div style={{ display:"flex", gap:8 }}>
              <Tag label={project.type.slice(0,3).toUpperCase()} color={project.type==="Underground"?C.UG:C.SF} bg={project.type==="Underground"?"rgba(139,92,246,0.15)":"rgba(16,185,129,0.15)"} />
              <Tag label={project.phase} color={PHASE_COLORS[project.phase]} bg={`${PHASE_COLORS[project.phase]}20`} />
            </div>
            <div style={{ fontSize:12, color:C.muted, fontFamily:C.font }}>
              {MONTHS[project.startIdx]} → {MONTHS[project.endIdx]} · {rows.length} active months
            </div>
            <div style={{ fontSize:12, color: filledMonths>0?"#34d399":C.muted, fontFamily:C.font, marginLeft:"auto" }}>
              {filledMonths} / {rows.length} months with data
            </div>
          </div>

          {/* Table */}
          <div style={{ background:C.surface, borderRadius:10, border:`1px solid ${C.border}`, overflow:"hidden", marginBottom:16 }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:C.font }}>
              <thead>
                <tr style={{ background:"rgba(255,255,255,0.03)", borderBottom:`1px solid ${C.border}` }}>
                  <th style={{ padding:"9px 14px", textAlign:"left",   fontSize:11, color:C.muted, fontWeight:500, width:80 }}>Month</th>
                  <th style={{ padding:"9px 10px", textAlign:"right",  fontSize:11, color:C.muted, fontWeight:500 }}>Model FTE</th>
                  <th style={{ padding:"9px 10px", textAlign:"right",  fontSize:11, color:C.muted, fontWeight:500 }}>Model Cost (ZARk)</th>
                  <th style={{ padding:"9px 10px", textAlign:"center", fontSize:11, color:"rgba(255,255,255,0.15)", fontWeight:400, width:20 }}>│</th>
                  <th style={{ padding:"9px 10px", textAlign:"right",  fontSize:11, color:"#34d399", fontWeight:500 }}>Actual FTE</th>
                  <th style={{ padding:"9px 10px", textAlign:"right",  fontSize:11, color:"#34d399", fontWeight:500 }}>Actual Cost (ZARk)</th>
                  <th style={{ padding:"9px 10px", textAlign:"right",  fontSize:11, color:C.muted, fontWeight:500 }}>Gap %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e         = edits[r.month_idx] || {};
                  const hasFte    = e.asis_fte  && parseFloat(e.asis_fte)  > 0;
                  const hasCost   = e.asis_cost && parseFloat(e.asis_cost) > 0;
                  const hasAny    = hasFte || hasCost;
                  const gap       = hasFte && r.model_fte > 0
                    ? Math.round((1 - parseFloat(e.asis_fte)/r.model_fte)*100)
                    : null;
                  const gapColor  = gap === null ? C.muted : gap > 60 ? "#f87171" : gap > 30 ? "#fbbf24" : "#34d399";

                  return (
                    <tr key={r.month_idx} style={{
                      borderBottom:`1px solid rgba(255,255,255,0.03)`,
                      background: i%2===0 ? "transparent" : "rgba(255,255,255,0.012)",
                    }}>
                      <td style={{ padding:"6px 14px", fontSize:12, color:C.text, fontWeight:500 }}>{r.month}</td>
                      <td style={{ padding:"6px 10px", textAlign:"right", fontSize:12, color:"rgba(255,255,255,0.4)" }}>{r.model_fte > 0 ? r.model_fte.toFixed(1) : "—"}</td>
                      <td style={{ padding:"6px 10px", textAlign:"right", fontSize:12, color:"rgba(255,255,255,0.4)" }}>{r.model_cost > 0 ? r.model_cost.toLocaleString() : "—"}</td>
                      <td style={{ padding:"6px 4px", textAlign:"center", fontSize:12, color:"rgba(255,255,255,0.1)" }}>│</td>
                      <td style={{ padding:"4px 10px" }}>
                        <input {...inp(
                          e.asis_fte || "",
                          ev => setEdit(r.month_idx, "asis_fte", ev.target.value),
                          hasFte
                        )} type="number" min="0" step="0.01" placeholder="0.00" />
                      </td>
                      <td style={{ padding:"4px 10px" }}>
                        <input {...inp(
                          e.asis_cost || "",
                          ev => setEdit(r.month_idx, "asis_cost", ev.target.value),
                          hasCost
                        )} type="number" min="0" step="1" placeholder="0" />
                      </td>
                      <td style={{ padding:"6px 10px", textAlign:"right", fontSize:12, fontWeight:600, color:gapColor }}>
                        {gap !== null ? `${gap}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Summary footer */}
              {filledMonths > 0 && (
                <tfoot>
                  <tr style={{ borderTop:`1px solid ${C.border}`, background:"rgba(255,255,255,0.02)" }}>
                    <td colSpan={2} style={{ padding:"8px 14px", fontSize:11, color:C.muted, fontFamily:C.font }}>Totals / Peak</td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontSize:12, color:"rgba(255,255,255,0.5)" }}>
                      R{rows.reduce((s,r)=>s+(r.model_cost||0),0).toLocaleString()}k
                    </td>
                    <td />
                    <td style={{ padding:"8px 10px", textAlign:"right", fontSize:12, fontWeight:600, color:"#34d399" }}>
                      {Math.max(...Object.values(edits).map(e=>parseFloat(e.asis_fte)||0), 0).toFixed(1)} peak
                    </td>
                    <td style={{ padding:"8px 10px", textAlign:"right", fontSize:12, fontWeight:600, color:"#34d399" }}>
                      R{Object.values(edits).reduce((s,e)=>s+(parseFloat(e.asis_cost)||0),0).toLocaleString()}k total
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Action bar */}
          {err && <div style={{ color:"#f87171", fontSize:13, marginBottom:12, fontFamily:C.font }}>{err}</div>}
          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
            <button onClick={handleSave} disabled={saving} style={{
              padding:"10px 28px", borderRadius:8, border:"none",
              background: saving ? "rgba(16,185,129,0.4)" : "#10b981",
              color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:C.font,
            }}>
              {saving ? "Saving…" : `Save Actuals${filledMonths > 0 ? ` (${filledMonths} months)` : ""}`}
            </button>
            <button onClick={handleClear} disabled={saving} style={{
              padding:"10px 20px", borderRadius:8,
              border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.08)",
              color:"#f87171", fontSize:13, cursor:"pointer", fontFamily:C.font,
            }}>
              Clear All
            </button>
            {saved && <span style={{ color:"#34d399", fontSize:13, fontFamily:C.font }}>✓ Saved successfully</span>}
          </div>
        </div>
      )}

      {selectedId && loading && (
        <div style={{ color:C.muted, fontFamily:C.font, fontSize:13 }}>Loading…</div>
      )}

      {!selectedId && (
        <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:10, padding:"32px", textAlign:"center", color:C.muted, fontSize:13, fontFamily:C.font }}>
          Select a project above to start entering actuals
        </div>
      )}
    </div>
  );
};

// ─── CAPACITY LIMITS EDITOR ───────────────────────────────────────────────────
const CapacityLimitsEditor = ({ onReload }) => {
  const [data,   setData]   = useState(null);
  const [form,   setForm]   = useState({});
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const PHASES = [
    "PFS High","PFS Low",
    "FS High","FS Low",
    "FEED High","FEED Low",
    "Execution High","Execution Low",
  ];

  useEffect(() => {
    sbFetch("model_config", "?category=eq.capacity&select=*")
      .then(rows => {
        const d = {};
        rows.forEach(r => {
          if (!d[r.key]) d[r.key] = {};
          d[r.key][r.sub_key] = r.value;
        });
        setData(d);
        // Initialise form with current values
        const f = {};
        PHASES.forEach(phase => {
          f[`${phase}__max`]          = d[phase]?.max          ?? 1;
          f[`${phase}__avg_duration`] = d[phase]?.avg_duration ?? 13;
        });
        setForm(f);
      });
  }, []);

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      for (const phase of PHASES) {
        for (const sub_key of ["max","avg_duration"]) {
          const val = parseFloat(form[`${phase}__${sub_key}`]);
          if (isNaN(val)) continue;
          const r = await fetch(
            `${SB_URL}/rest/v1/model_config?category=eq.capacity&key=eq.${encodeURIComponent(phase)}&sub_key=eq.${sub_key}`,
            { method:"PATCH",
              headers:{ ...sbHeaders, "Content-Type":"application/json", "Prefer":"return=minimal" },
              body: JSON.stringify({ value: val, updated_at: new Date().toISOString() }) }
          );
          if (!r.ok) throw new Error(`Failed saving ${phase} ${sub_key}: ${await r.text()}`);
        }
      }
      setSaved(true); setTimeout(()=>setSaved(false), 3000);
      onReload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const inp = { padding:"7px 10px", borderRadius:6, border:`1px solid rgba(255,255,255,0.1)`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, outline:"none", fontFamily:C.font, width:"100%", textAlign:"right", boxSizing:"border-box" };
  const lbl = { fontSize:10, color:C.muted, fontFamily:C.font, letterSpacing:0.5 };

  if (!data) return <div style={{ color:C.muted, fontFamily:C.font, fontSize:13 }}>Loading…</div>;

  // Group phases for display
  const GROUPS = [
    { label:"Pre-Feasibility Study (PFS)", phases:["PFS High","PFS Low"] },
    { label:"Feasibility Study (FS)",      phases:["FS High","FS Low"] },
    { label:"Front-End Engineering Design (FEED)", phases:["FEED High","FEED Low"] },
    { label:"Execution",                   phases:["Execution High","Execution Low"] },
  ];

  return (
    <div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:C.font }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${C.border}` }}>
            <th style={{ padding:"8px 14px", textAlign:"left",  fontSize:11, color:C.muted, fontWeight:500 }}>Phase</th>
            <th style={{ padding:"8px 14px", textAlign:"left",  fontSize:11, color:C.muted, fontWeight:500 }}>Complexity</th>
            <th style={{ padding:"8px 14px", textAlign:"right", fontSize:11, color:C.muted, fontWeight:500, width:140 }}>Max Concurrent</th>
            <th style={{ padding:"8px 14px", textAlign:"right", fontSize:11, color:C.muted, fontWeight:500, width:180 }}>Avg Duration (months)</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(group => (
            group.phases.map((phase, gi) => {
              const maxKey = `${phase}__max`;
              const durKey = `${phase}__avg_duration`;
              const maxChanged = parseFloat(form[maxKey]) !== data[phase]?.max;
              const durChanged = parseFloat(form[durKey]) !== data[phase]?.avg_duration;
              const complexity = phase.includes("High") ? "High" : "Low";

              return (
                <tr key={phase} style={{ borderBottom:`1px solid rgba(255,255,255,0.04)`, background: gi===0?"rgba(255,255,255,0.015)":"transparent" }}>
                  {gi===0 && (
                    <td rowSpan={2} style={{ padding:"10px 14px", fontSize:12, color:C.text, fontWeight:600, verticalAlign:"middle", borderRight:`1px solid rgba(255,255,255,0.04)` }}>
                      {group.label}
                    </td>
                  )}
                  <td style={{ padding:"8px 14px", fontSize:12, color:C.muted }}>
                    <span style={{ padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:500,
                      background: complexity==="High"?"rgba(59,130,246,0.15)":"rgba(255,255,255,0.06)",
                      color: complexity==="High"?"#60a5fa":"rgba(255,255,255,0.4)" }}>
                      {complexity}
                    </span>
                  </td>
                  <td style={{ padding:"6px 14px" }}>
                    <input
                      style={{ ...inp, border:`1px solid ${maxChanged?"#3b82f6":"rgba(255,255,255,0.1)"}` }}
                      type="number" min="1" max="10" step="1"
                      value={form[maxKey] ?? ""}
                      onChange={e=>setForm(f=>({...f,[maxKey]:e.target.value}))} />
                  </td>
                  <td style={{ padding:"6px 14px" }}>
                    <input
                      style={{ ...inp, border:`1px solid ${durChanged?"#3b82f6":"rgba(255,255,255,0.1)"}` }}
                      type="number" min="1" max="90" step="0.25"
                      value={form[durKey] ?? ""}
                      onChange={e=>setForm(f=>({...f,[durKey]:e.target.value}))} />
                  </td>
                </tr>
              );
            })
          ))}
        </tbody>
      </table>

      {/* Note about what these affect */}
      <div style={{ marginTop:16, padding:"10px 14px", background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:8, fontSize:11, color:C.muted, fontFamily:C.font, lineHeight:1.7 }}>
        <strong style={{ color:C.text }}>Max Concurrent</strong> is used by the Bottleneck Alerts to flag when too many projects of the same type overlap in the timeline.&nbsp;
        <strong style={{ color:C.text }}>Avg Duration</strong> pre-fills the duration field when adding a new project — the user can always override it.
      </div>

      {err && <div style={{ color:"#f87171", fontSize:13, marginTop:12, fontFamily:C.font }}>{err}</div>}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:20 }}>
        <button onClick={handleSave} disabled={saving} style={{ padding:"10px 28px", borderRadius:8, border:"none", background:saving?"rgba(59,130,246,0.4)":"#3b82f6", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>
          {saving ? "Saving…" : "Save Capacity Limits"}
        </button>
        <button onClick={()=>{ const f={}; PHASES.forEach(p=>{ f[`${p}__max`]=data[p]?.max??1; f[`${p}__avg_duration`]=data[p]?.avg_duration??13; }); setForm(f); }} style={{ padding:"10px 20px", borderRadius:8, border:`1px solid rgba(255,255,255,0.12)`, background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:C.font }}>
          Reset
        </button>
        {saved && <span style={{ color:"#34d399", fontSize:13, fontFamily:C.font }}>✓ Saved</span>}
      </div>
    </div>
  );
};

// ─── RATE CARD EDITOR ─────────────────────────────────────────────────────────
const RateCardEditor = ({ onReload }) => {
  const [rates, setRates]   = useState(null);
  const [form,  setForm]    = useState({});
  const [saving,setSaving]  = useState(false);
  const [saved, setSaved]   = useState(false);
  const [err,   setErr]     = useState("");

  useEffect(() => {
    sbFetch("model_config", "?category=eq.rate_card&select=*")
      .then(rows => {
        const r = {};
        rows.forEach(row => { r[row.key] = row.value; });
        setRates(r);
        setForm({...r});
      });
  }, []);

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      for (const [key, value] of Object.entries(form)) {
        const r = await fetch(`${SB_URL}/rest/v1/model_config?category=eq.rate_card&key=eq.${key}`, {
          method:"PATCH",
          headers: { ...sbHeaders, "Content-Type":"application/json", "Prefer":"return=minimal" },
          body: JSON.stringify({ value: parseFloat(value), updated_at: new Date().toISOString() }),
        });
        if (!r.ok) throw new Error(`Failed saving ${key}: ${await r.text()}`);
      }
      setSaved(true); setTimeout(()=>setSaved(false), 3000);
      onReload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const inp = { width:"100%", padding:"8px 12px", borderRadius:7, border:`1px solid rgba(255,255,255,0.12)`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:14, outline:"none", fontFamily:C.font };
  const lbl = { display:"block", fontSize:10, color:C.muted, marginBottom:4, letterSpacing:0.5, fontFamily:C.font };

  if (!rates) return <div style={{ color:C.muted, fontFamily:C.font }}>Loading…</div>;

  const ENTITIES = [
    { key:"OT",   label:"Owners Team (OT)",  desc:"Owner's internal project staff" },
    { key:"CPMO", label:"CPMO",              desc:"Capital Portfolio Management Office" },
    { key:"PMO",  label:"Site PMO",          desc:"Site-based Project Management Office" },
    { key:"EPCM", label:"EPCM",              desc:"Engineering, Procurement & Construction contractor" },
  ];

  return (
    <div>
      <div style={{ fontSize:14, fontWeight:600, color:C.text, fontFamily:C.font, marginBottom:4 }}>Rate Cards</div>
      <div style={{ fontSize:13, color:C.muted, fontFamily:C.font, marginBottom:20, lineHeight:1.6 }}>
        Average hourly rates per entity. These drive the cost calculations for new projects added through the app.
        Existing project monthly cost arrays are not affected — only new projects use these rates.
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:16, marginBottom:24 }}>
        {ENTITIES.map(({ key, label, desc }) => {
          const current = rates[key];
          const changed = form[key] !== current;
          return (
            <div key={key} style={{ background:C.surface, border:`1px solid ${changed?"#3b82f6":C.border}`, borderRadius:10, padding:"16px", transition:"border 0.2s" }}>
              <label style={lbl}>{label}</label>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ color:C.muted, fontSize:13, fontFamily:C.font }}>R</span>
                <input style={{...inp, flex:1}} type="number" min="0" step="10"
                  value={form[key] || ""}
                  onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} />
                <span style={{ color:C.muted, fontSize:13, fontFamily:C.font }}>/hr</span>
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:6, fontFamily:C.font }}>
                {desc} · R{((form[key]||0)*160/1000).toFixed(0)}k/FTE/month
                {changed && <span style={{ color:"#f59e0b", marginLeft:8 }}>● Changed</span>}
              </div>
            </div>
          );
        })}
      </div>
      {err && <div style={{ color:"#f87171", fontSize:13, marginBottom:12, fontFamily:C.font }}>{err}</div>}
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <button onClick={handleSave} disabled={saving} style={{ padding:"10px 28px", borderRadius:8, border:"none", background:saving?"rgba(59,130,246,0.4)":"#3b82f6", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>
          {saving ? "Saving…" : "Save Rate Cards"}
        </button>
        <button onClick={()=>setForm({...rates})} style={{ padding:"10px 20px", borderRadius:8, border:`1px solid rgba(255,255,255,0.12)`, background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:C.font }}>
          Reset
        </button>
        {saved && <span style={{ color:"#34d399", fontSize:13, fontFamily:C.font }}>✓ Saved</span>}
      </div>
    </div>
  );
};

// ─── PM&D RATIO EDITOR ────────────────────────────────────────────────────────
const PMDRatioEditor = ({ onReload }) => {
  const [ratios, setRatios] = useState(null);
  const [form,   setForm]   = useState({});
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  useEffect(() => {
    sbFetch("model_config","?category=eq.pmd_ratio&select=*").then(rows => {
      const r = {};
      rows.forEach(row => {
        const k = `${row.key}__${row.sub_key}`;
        r[k] = row.value;
      });
      setRatios(r);
      setForm({...r});
    });
  }, []);

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      for (const [combo, value] of Object.entries(form)) {
        const [key, sub_key] = combo.split("__");
        const r = await fetch(
          `${SB_URL}/rest/v1/model_config?category=eq.pmd_ratio&key=eq.${encodeURIComponent(key)}&sub_key=eq.${sub_key}`,
          { method:"PATCH", headers:{...sbHeaders,"Content-Type":"application/json","Prefer":"return=minimal"},
            body: JSON.stringify({ value: parseFloat(value), updated_at: new Date().toISOString() }) }
        );
        if (!r.ok) throw new Error(`Failed ${combo}: ${await r.text()}`);
      }
      setSaved(true); setTimeout(()=>setSaved(false), 3000);
      onReload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const PHASES   = ["PFS High","PFS Low","FS High","FS Low","FEED High","FEED Low","Execution High","Execution Low"];
  const SCOPES   = ["Mining","Full"];
  const inp = { width:"100%", padding:"6px 10px", borderRadius:6, border:`1px solid rgba(255,255,255,0.1)`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:12, outline:"none", fontFamily:C.font, textAlign:"right" };

  if (!ratios) return <div style={{ color:C.muted, fontFamily:C.font }}>Loading…</div>;

  return (
    <div>
      <div style={{ fontSize:14, fontWeight:600, color:C.text, fontFamily:C.font, marginBottom:4 }}>PM&D Ratios</div>
      <div style={{ fontSize:13, color:C.muted, fontFamily:C.font, marginBottom:20, lineHeight:1.6 }}>
        PM&D cost as a percentage of execution capital, by phase and scope. Sourced from the Twickenham and Tumela benchmark projects.
        Used to derive resource requirements for new projects added through the app.
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:C.font }}>
        <thead>
          <tr>
            <th style={{ padding:"8px 12px", textAlign:"left", fontSize:11, color:C.muted, borderBottom:`1px solid ${C.border}` }}>Phase / Complexity</th>
            {SCOPES.map(s=><th key={s} style={{ padding:"8px 12px", textAlign:"right", fontSize:11, color:C.muted, borderBottom:`1px solid ${C.border}` }}>{s} Scope</th>)}
          </tr>
        </thead>
        <tbody>
          {PHASES.map((phase,i) => (
            <tr key={phase} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"8px 12px", fontSize:13, color:C.text }}>{phase}</td>
              {SCOPES.map(scope => {
                const k = `${phase}__${scope}`;
                const current = ratios[k];
                const changed = form[k] !== current;
                return (
                  <td key={scope} style={{ padding:"6px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
                      <input style={{...inp, width:100, border:`1px solid ${changed?"#3b82f6":"rgba(255,255,255,0.1)"}`}}
                        type="number" step="0.0001" min="0" max="1"
                        value={form[k] !== undefined ? (form[k]*100).toFixed(4) : ""}
                        onChange={e=>setForm(f=>({...f,[k]:parseFloat(e.target.value)/100||0}))} />
                      <span style={{ fontSize:11, color:C.muted }}>%</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop:20, display:"flex", gap:12, alignItems:"center" }}>
        {err && <div style={{ color:"#f87171", fontSize:13, fontFamily:C.font }}>{err}</div>}
        <button onClick={handleSave} disabled={saving} style={{ padding:"10px 28px", borderRadius:8, border:"none", background:saving?"rgba(59,130,246,0.4)":"#3b82f6", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:C.font }}>
          {saving ? "Saving…" : "Save Ratios"}
        </button>
        <button onClick={()=>setForm({...ratios})} style={{ padding:"10px 20px", borderRadius:8, border:`1px solid rgba(255,255,255,0.12)`, background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:C.font }}>Reset</button>
        {saved && <span style={{ color:"#34d399", fontSize:13, fontFamily:C.font }}>✓ Saved</span>}
      </div>
    </div>
  );
};

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight:"100vh", background:"#0d1117", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Calibri, sans-serif" }}>
        <div style={{ textAlign:"center", maxWidth:480, padding:32 }}>
          <div style={{ fontSize:40, marginBottom:16 }}>⚠</div>
          <div style={{ fontSize:18, fontWeight:700, color:"#e2e8f0", marginBottom:8 }}>Something went wrong</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginBottom:24, lineHeight:1.6 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </div>
          <button
            onClick={() => { this.setState({ hasError:false, error:null }); window.location.reload(); }}
            style={{ padding:"10px 28px", borderRadius:8, border:"none", background:"#3b82f6", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            Reload App
          </button>
        </div>
      </div>
    );
  }
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;

function App() {
  const [appData, setAppData]   = useState(null);
  const [loadErr, setLoadErr]   = useState(null);

  useEffect(() => {
    loadAppData()
      .then(setAppData)
      .catch(e => setLoadErr(e.message));
    // Expose reload so AppInner can trigger a full data refresh
    window._reloadAppData = (fresh) => setAppData(fresh);
    return () => { delete window._reloadAppData; };
  }, []);

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (loadErr) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:C.font }}>
      <div style={{ textAlign:"center", maxWidth:420 }}>
        <div style={{ fontSize:32, marginBottom:16 }}>⚠</div>
        <div style={{ fontSize:16, fontWeight:600, color:C.text, marginBottom:8 }}>Failed to load data</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:24, lineHeight:1.6 }}>{loadErr}</div>
        <button onClick={()=>{ setLoadErr(null); loadAppData().then(setAppData).catch(e=>setLoadErr(e.message)); }}
          style={{ padding:"10px 24px", borderRadius:8, border:"none", background:C.model, color:"#fff", fontSize:13, cursor:"pointer", fontFamily:C.font }}>
          Retry
        </button>
      </div>
    </div>
  );

  if (!appData) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:C.font, gap:20 }}>
      <div style={{ fontSize:13, color:C.muted, letterSpacing:2, textTransform:"uppercase" }}>Loading Harmony Resource Model</div>
      <div style={{ display:"flex", gap:8 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width:8, height:8, borderRadius:"50%", background:C.model,
            animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite`,
          }} />
        ))}
      </div>
      <style>{`@keyframes pulse { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );

  // Data loaded — render the full app
  return <AppInner data={appData} />;
}

function AppInner({ data }) {
  const {
    PROJECTS: BASE_PROJECTS,
    MODEL_MH, MODEL_FTE, MODEL_COST,
    ASIS_MH, ASIS_FTE, ASIS_COST,
    ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS,
    PMD_RATIOS, PHASE_DURATIONS, RATE_CARDS: DB_RATE_CARDS, RAMP_SHAPES: DB_RAMP_SHAPES,
  } = data;

  const [view, setView] = useState("asis");
  const [settingsTarget, setSettingsTarget] = useState(null); // { section, projectId }
  const [customProjects, setCustomProjects] = useState([]);
  const allProjects = useMemo(() => [...BASE_PROJECTS, ...customProjects], [BASE_PROJECTS, customProjects]);

  const addProject = useCallback((p) => {
    setCustomProjects(prev => [...prev, p]);
    setView("model");
    loadAppData().then(fresh => {
      setCustomProjects([]);
      window._reloadAppData && window._reloadAppData(fresh);
    }).catch(() => {});
  }, []);

  // Navigate to settings for a specific project
  const goToProjectSettings = useCallback((projectId, section = "projects") => {
    setSettingsTarget({ section, projectId });
    setView("settings");
  }, []);

  const VIEWS = [
    { id:"asis",     label:"As-Is",          icon:"◎", sub:"Current state" },
    { id:"model",    label:"Resource Model", icon:"◈", sub:"Required capacity" },
    { id:"scenario", label:"Scenarios",      icon:"◇", sub:"What-if analysis" },
    { id:"add",      label:"Add Project",    icon:"+", sub:"Add to portfolio" },
    { id:"settings", label:"Settings",       icon:"⚙", sub:"Model configuration" },
  ];

  return (
    <ProjectsCtx.Provider value={{
      projects: allProjects, addProject, goToProjectSettings,
      MODEL_MH, MODEL_FTE, MODEL_COST,
      ASIS_MH, ASIS_FTE, ASIS_COST,
      ENT_MODEL, ENT_ASIS, DISC_MODEL, DISC_ASIS,
      PMD_RATIOS, PHASE_DURATIONS,
      RATE_CARDS: DB_RATE_CARDS,
      RAMP_SHAPES: DB_RAMP_SHAPES,
    }}>
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:C.font }}>
      <style>{`
        * { box-sizing: border-box; }
        body, button, input, select { font-family: Calibri, sans-serif; }
        input[type=range] { -webkit-appearance:none; height:4px; border-radius:2px; background:rgba(255,255,255,0.1); outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; cursor:pointer; background:#fff; }
        input[type=range]::-moz-range-thumb { width:14px; height:14px; border-radius:50%; cursor:pointer; background:#fff; border:none; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
        tr:hover td { transition: background 0.12s; }
      `}</style>

      {/* Top nav */}
      <div style={{ position:"sticky", top:0, zIndex:100, background:"rgba(13,17,23,0.96)", backdropFilter:"blur(12px)", borderBottom:`1px solid ${C.border}`, padding:"0 36px", display:"flex", alignItems:"center", gap:28, height:58 }}>
        {/* Brand */}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:"linear-gradient(135deg,#3b82f6,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:"#fff", fontFamily:C.font }}>M</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:"#fff", fontFamily:C.font, lineHeight:1.1 }}>Mventech</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", fontFamily:C.font, letterSpacing:1.5 }}>PROJECT INTELLIGENCE</div>
          </div>
        </div>

        {/* Nav tabs */}
        <nav style={{ display:"flex", flex:1, alignItems:"center" }}>
          {VIEWS.filter(v=>v.id!=="add"&&v.id!=="settings").map(v=>(
            <button key={v.id} onClick={()=>setView(v.id)} style={{
              padding:"0 18px", height:58, background:"transparent", border:"none", cursor:"pointer", fontFamily:C.font, fontSize:13,
              color:view===v.id?C.text:C.muted, fontWeight:view===v.id?600:400, display:"flex", alignItems:"center", gap:6,
              borderBottom:`2px solid ${view===v.id?C.model:"transparent"}`,
            }}>
              <span style={{fontSize:11}}>{v.icon}</span>{v.label}
            </button>
          ))}
          {/* Add Project — distinct CTA button */}
          <button onClick={()=>setView("add")} style={{
            marginLeft:16, padding:"6px 16px", height:32, borderRadius:20,
            border:`1px solid ${view==="add"?"#10b981":"rgba(16,185,129,0.4)"}`,
            background: view==="add"?"rgba(16,185,129,0.2)":"rgba(16,185,129,0.08)",
            color: view==="add"?"#34d399":"rgba(16,185,129,0.7)",
            fontFamily:C.font, fontSize:12, fontWeight:600, cursor:"pointer",
            display:"flex", alignItems:"center", gap:6,
          }}>
            <span style={{ fontSize:16, lineHeight:1 }}>+</span> Add Project
          </button>
          {/* Settings — gear icon at far right */}
          <button onClick={()=>{ setSettingsTarget(null); setView("settings"); }} style={{
            marginLeft:"auto", padding:"0 12px", height:58, background:"transparent", border:"none", cursor:"pointer",
            color:view==="settings"?C.text:C.muted, borderBottom:`2px solid ${view==="settings"?C.model:"transparent"}`,
            fontSize:18, display:"flex", alignItems:"center",
          }}>⚙</button>
        </nav>

        {/* Status */}
        <div style={{ display:"flex", gap:20, flexShrink:0 }}>
          {[
            { label:"Model Peak FTE", value:fmt.fte(Math.max(...MODEL_FTE)), color:"#60a5fa" },
            { label:"As-Is Peak FTE", value:fmt.fte(Math.max(...ASIS_FTE)), color:"#34d399" },
            { label:"Total Model Cost", value:fmt.cost(MODEL_COST.reduce((a,b)=>a+b,0)), color:"#a78bfa" },
          ].map(s=>(
            <div key={s.label} style={{ textAlign:"right" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:C.font, letterSpacing:1 }}>{s.label}</div>
              <div style={{ fontSize:14, fontWeight:700, color:s.color, fontFamily:C.font }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Page header */}
      <div style={{ padding:"28px 36px 18px", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:2, marginBottom:5, textTransform:"uppercase", fontFamily:C.font }}>
              {VIEWS.find(v=>v.id===view)?.sub}
            </div>
            <h1 style={{ fontSize:28, fontWeight:800, color:"#fff", fontFamily:C.font, margin:0, lineHeight:1.1 }}>
              {view==="asis" && "Current Deployment vs Required"}
              {view==="model" && "Resource Model — Required Capacity"}
              {view==="scenario" && "Scenario Modeller"}
              {view==="add" && "Add New Project"}
              {view==="settings" && "Settings"}
            </h1>
            <p style={{ fontSize:13, color:C.muted, margin:"6px 0 0", maxWidth:640, lineHeight:1.6, fontFamily:C.font }}>
              {view==="asis" && "Comparison of current resource deployment against the benchmarked model requirement. 18 projects · 2 with actual As-Is data · Jan 2026 – Jun 2033"}
              {view==="model" && "Benchmarked resource requirements by project type, phase, complexity and scope. Manhours, FTE and cost by entity and discipline across the 90-month horizon."}
              {view==="scenario" && "Build and compare what-if scenarios by adjusting FTE scale, cost assumptions and portfolio timing. Export comparisons to CSV."}
              {view==="add" && "Add a new project to the portfolio. Resource requirements are calculated from the benchmarking model using your capital cost, scope, and phase inputs."}
              {view==="settings" && "Edit project details, update As-Is actuals, and manage model configuration. Changes are saved directly to the database."}
            </p>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <Tag label={`${allProjects.filter(p=>p.type==="Underground").length} Underground`} color="#a78bfa" bg="rgba(139,92,246,0.15)" />
            <Tag label={`${allProjects.filter(p=>p.type==="Surface").length} Surface`} color="#34d399" bg="rgba(16,185,129,0.12)" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding:"28px 36px 48px" }}>
        {view==="asis"     && <AsIsView />}
        {view==="model"    && <ModelView />}
        {view==="scenario" && <ScenarioView />}
        {view==="add"      && <AddProjectInline onAdd={addProject} />}
        {view==="settings" && <SettingsView target={settingsTarget} onReload={()=>loadAppData().then(d=>window._reloadAppData&&window._reloadAppData(d))} />}
      </div>

      {/* Footer */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"14px 36px", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.015)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:20, height:20, borderRadius:5, background:"linear-gradient(135deg,#3b82f6,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:"#fff" }}>M</div>
          <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:C.font }}>© {new Date().getFullYear()} Mventech Pty Ltd. All rights reserved.</span>
        </div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:C.font, letterSpacing:1 }}>PROJECT INTELLIGENCE</div>
      </div>
    </div>
    </ProjectsCtx.Provider>
  );
}