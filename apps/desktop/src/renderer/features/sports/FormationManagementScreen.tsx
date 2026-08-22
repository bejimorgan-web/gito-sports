import React, { useEffect, useMemo, useState } from "react";
import type { FormationPositionPoint, FormationTemplate, Sport } from "@gito/shared";
import { apiClient } from "../../services/api-client";

const defaultSlots: FormationPositionPoint[] = [
  { x: 50, y: 90, label: "GK" }, { x: 18, y: 70, label: "LB" }, { x: 40, y: 70, label: "CB" }, { x: 60, y: 70, label: "CB" }, { x: 82, y: 70, label: "RB" },
  { x: 32, y: 48, label: "CM" }, { x: 50, y: 48, label: "CM" }, { x: 68, y: 48, label: "CM" }, { x: 20, y: 25, label: "LW" }, { x: 50, y: 25, label: "ST" }, { x: 80, y: 25, label: "RW" },
];

export function FormationManagementScreen({ accessToken }: { accessToken: string }) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [sportId, setSportId] = useState("");
  const [templates, setTemplates] = useState<FormationTemplate[]>([]);
  const [selected, setSelected] = useState<FormationTemplate | null>(null);
  const [name, setName] = useState("");
  const [formation, setFormation] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [slotX, setSlotX] = useState("50");
  const [slotY, setSlotY] = useState("50");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Ready");

  const loadTemplates = async (nextSportId = sportId) => { if (!nextSportId) { setTemplates([]); return; } try { setTemplates(await apiClient.listFormationTemplates({ sportId: nextSportId })); } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to load formations"); } };
  useEffect(() => { void apiClient.listSports().then((data) => { setSports(data); setSportId(data[0]?.id ?? ""); }).catch(() => setMessage("Failed to load sports")); }, []);
  useEffect(() => { void loadTemplates(); }, [sportId]);

  const slots = selected?.positions ?? [];
  const selectedSport = sports.find((sport) => sport.id === sportId);
  const openTemplate = (template: FormationTemplate) => { setSelected(template); setName(template.name); setFormation(template.formation); setMessage("Loaded"); setEditingSlot(null); };
  const clear = () => { setSelected(null); setName(""); setFormation(""); setSlotLabel(""); setSlotX("50"); setSlotY("50"); setEditingSlot(null); };
  const saveFormation = async () => {
    if (!sportId || !name.trim() || saving) { setMessage("Sport and formation name are required"); return; }
    setSaving(true); setMessage("Saving...");
    try { const result = selected ? await apiClient.updateFormationTemplate(selected.id, { sportId, name: name.trim(), formation: formation.trim() || name.trim(), positions: selected.positions }, accessToken) : await apiClient.createFormationTemplate({ sportId, name: name.trim(), formation: formation.trim() || name.trim(), positions: defaultSlots }, accessToken); await loadTemplates(); openTemplate(result); setMessage(selected ? "Saved" : "Formation created"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); } finally { setSaving(false); }
  };
  const saveSlots = async (nextSlots: FormationPositionPoint[]) => { if (!selected || saving) return; setSaving(true); setMessage("Saving..."); try { const result = await apiClient.updateFormationTemplate(selected.id, { positions: nextSlots }, accessToken); setSelected(result); setTemplates((items) => items.map((item) => item.id === result.id ? result : item)); setMessage("Slot saved"); } catch (error) { setMessage(error instanceof Error ? error.message : "Slot save failed"); } finally { setSaving(false); } };
  const addOrUpdateSlot = async () => { const point = { x: Math.max(0, Math.min(100, Number(slotX))), y: Math.max(0, Math.min(100, Number(slotY))), label: slotLabel.trim() || "POS" }; const next = [...slots]; if (editingSlot === null) next.push(point); else next[editingSlot] = point; await saveSlots(next); setSlotLabel(""); setEditingSlot(null); };
  const editSlot = (index: number) => { const slot = slots[index]; if (!slot) return; setEditingSlot(index); setSlotLabel(slot.label ?? ""); setSlotX(String(slot.x)); setSlotY(String(slot.y)); };
  const removeSlot = (index: number) => void saveSlots(slots.filter((_, slotIndex) => slotIndex !== index));

  return <section className="screen-stack">
    <header className="screen-header"><p className="eyebrow">Sports / Formations</p><h2>Formation Templates</h2><span>Reusable sport-aware templates for future lineups.</span></header>
    <section className="console-panel"><div className="panel-heading"><h3>Sport</h3><span className="status-pill">{message}</span></div><label>Sport<select value={sportId} onChange={(event) => { setSportId(event.target.value); clear(); }}><option value="">Select sport</option>{sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label></section>
    <section className="console-panel"><div className="panel-heading"><h3>{selected ? "Edit Formation" : "Create Formation"}</h3><button type="button" className="secondary" onClick={clear}>Clear</button></div><div className="form-grid two-column"><label>Formation Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="4-3-3" /></label><label>Description<input value={formation} onChange={(event) => setFormation(event.target.value)} placeholder="Optional description" /></label></div><div className="button-row"><button type="button" onClick={saveFormation} disabled={saving}>{saving ? "Saving..." : selected ? "Save Formation" : "Create Formation"}</button></div></section>
    <section className="catalog-split"><section className="console-panel"><div className="panel-heading"><h3>{selectedSport?.name ?? "Formations"}</h3><span>{templates.length} templates</span></div><div className="formation-list">{templates.map((template) => <button type="button" className={selected?.id === template.id ? "selected" : ""} key={template.id} onClick={() => openTemplate(template)}><strong>{template.name}</strong><small>{template.positions.length} slots</small></button>)}</div></section>
      {selected ? <section className="console-panel"><div className="panel-heading"><h3>{selected.formation}</h3><span>Formation preview</span></div><div className="football-pitch" aria-label={`${selected.name} pitch preview`}>{slots.map((slot, index) => <button type="button" className="pitch-slot" style={{ left: `${slot.x}%`, top: `${slot.y}%` }} key={`${index}-${slot.label ?? "slot"}`} onClick={() => editSlot(index)} title="Edit slot">{slot.label ?? "POS"}</button>)}</div><div className="slot-editor"><h4>{editingSlot === null ? "Add slot" : "Edit slot"}</h4><div className="form-grid three-column"><label>Position<input value={slotLabel} onChange={(event) => setSlotLabel(event.target.value)} /></label><label>X<input type="number" min="0" max="100" value={slotX} onChange={(event) => setSlotX(event.target.value)} /></label><label>Y<input type="number" min="0" max="100" value={slotY} onChange={(event) => setSlotY(event.target.value)} /></label></div><div className="button-row"><button type="button" onClick={() => void addOrUpdateSlot()} disabled={saving}>{saving ? "Saving..." : "Slot saved"}</button>{editingSlot !== null ? <button type="button" className="secondary" onClick={() => removeSlot(editingSlot)} disabled={saving}>Remove slot</button> : null}</div></div><div className="slot-list">{slots.map((slot, index) => <div key={`${index}-${slot.label ?? "slot"}`}><span>{index + 1}. {slot.label ?? "POS"} ({slot.x}, {slot.y})</span><button type="button" onClick={() => editSlot(index)}>Edit</button></div>)}</div></section> : null}
    </section>
  </section>;
}
