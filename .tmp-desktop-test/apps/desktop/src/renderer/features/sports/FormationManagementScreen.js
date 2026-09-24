import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
const defaultSlots = [
    { x: 50, y: 90, label: "GK" }, { x: 18, y: 70, label: "LB" }, { x: 40, y: 70, label: "CB" }, { x: 60, y: 70, label: "CB" }, { x: 82, y: 70, label: "RB" },
    { x: 32, y: 48, label: "CM" }, { x: 50, y: 48, label: "CM" }, { x: 68, y: 48, label: "CM" }, { x: 20, y: 25, label: "LW" }, { x: 50, y: 25, label: "ST" }, { x: 80, y: 25, label: "RW" },
];
export function FormationManagementScreen({ accessToken }) {
    const [sports, setSports] = useState([]);
    const [sportId, setSportId] = useState("");
    const [templates, setTemplates] = useState([]);
    const [selected, setSelected] = useState(null);
    const [name, setName] = useState("");
    const [formation, setFormation] = useState("");
    const [slotLabel, setSlotLabel] = useState("");
    const [slotX, setSlotX] = useState("50");
    const [slotY, setSlotY] = useState("50");
    const [editingSlot, setEditingSlot] = useState(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("Ready");
    const loadTemplates = async (nextSportId = sportId) => { if (!nextSportId) {
        setTemplates([]);
        return;
    } try {
        setTemplates(await apiClient.listFormationTemplates({ sportId: nextSportId }));
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to load formations");
    } };
    useEffect(() => { void apiClient.listSports().then((data) => { setSports(data); setSportId(data[0]?.id ?? ""); }).catch(() => setMessage("Failed to load sports")); }, []);
    useEffect(() => { void loadTemplates(); }, [sportId]);
    const slots = selected?.positions ?? [];
    const selectedSport = sports.find((sport) => sport.id === sportId);
    const openTemplate = (template) => { setSelected(template); setName(template.name); setFormation(template.formation); setMessage("Loaded"); setEditingSlot(null); };
    const clear = () => { setSelected(null); setName(""); setFormation(""); setSlotLabel(""); setSlotX("50"); setSlotY("50"); setEditingSlot(null); };
    const saveFormation = async () => {
        if (!sportId || !name.trim() || saving) {
            setMessage("Sport and formation name are required");
            return;
        }
        setSaving(true);
        setMessage("Saving...");
        try {
            const result = selected ? await apiClient.updateFormationTemplate(selected.id, { sportId, name: name.trim(), formation: formation.trim() || name.trim(), positions: selected.positions }, accessToken) : await apiClient.createFormationTemplate({ sportId, name: name.trim(), formation: formation.trim() || name.trim(), positions: defaultSlots }, accessToken);
            await loadTemplates();
            openTemplate(result);
            setMessage(selected ? "Saved" : "Formation created");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Save failed");
        }
        finally {
            setSaving(false);
        }
    };
    const saveSlots = async (nextSlots) => { if (!selected || saving)
        return; setSaving(true); setMessage("Saving..."); try {
        const result = await apiClient.updateFormationTemplate(selected.id, { positions: nextSlots }, accessToken);
        setSelected(result);
        setTemplates((items) => items.map((item) => item.id === result.id ? result : item));
        setMessage("Slot saved");
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : "Slot save failed");
    }
    finally {
        setSaving(false);
    } };
    const addOrUpdateSlot = async () => { const point = { x: Math.max(0, Math.min(100, Number(slotX))), y: Math.max(0, Math.min(100, Number(slotY))), label: slotLabel.trim() || "POS" }; const next = [...slots]; if (editingSlot === null)
        next.push(point);
    else
        next[editingSlot] = point; await saveSlots(next); setSlotLabel(""); setEditingSlot(null); };
    const editSlot = (index) => { const slot = slots[index]; if (!slot)
        return; setEditingSlot(index); setSlotLabel(slot.label ?? ""); setSlotX(String(slot.x)); setSlotY(String(slot.y)); };
    const removeSlot = (index) => void saveSlots(slots.filter((_, slotIndex) => slotIndex !== index));
    return _jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Sports / Formations" }), _jsx("h2", { children: "Formation Templates" }), _jsx("span", { children: "Reusable sport-aware templates for future lineups." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Sport" }), _jsx("span", { className: "status-pill", children: message })] }), _jsxs("label", { children: ["Sport", _jsxs("select", { value: sportId, onChange: (event) => { setSportId(event.target.value); clear(); }, children: [_jsx("option", { value: "", children: "Select sport" }), sports.map((sport) => _jsx("option", { value: sport.id, children: sport.name }, sport.id))] })] })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selected ? "Edit Formation" : "Create Formation" }), _jsx("button", { type: "button", className: "secondary", onClick: clear, children: "Clear" })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Formation Name", _jsx("input", { value: name, onChange: (event) => setName(event.target.value), placeholder: "4-3-3" })] }), _jsxs("label", { children: ["Description", _jsx("input", { value: formation, onChange: (event) => setFormation(event.target.value), placeholder: "Optional description" })] })] }), _jsx("div", { className: "button-row", children: _jsx("button", { type: "button", onClick: saveFormation, disabled: saving, children: saving ? "Saving..." : selected ? "Save Formation" : "Create Formation" }) })] }), _jsxs("section", { className: "catalog-split", children: [_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedSport?.name ?? "Formations" }), _jsxs("span", { children: [templates.length, " templates"] })] }), _jsx("div", { className: "formation-list", children: templates.map((template) => _jsxs("button", { type: "button", className: selected?.id === template.id ? "selected" : "", onClick: () => openTemplate(template), children: [_jsx("strong", { children: template.name }), _jsxs("small", { children: [template.positions.length, " slots"] })] }, template.id)) })] }), selected ? _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selected.formation }), _jsx("span", { children: "Formation preview" })] }), _jsx("div", { className: "football-pitch", "aria-label": `${selected.name} pitch preview`, children: slots.map((slot, index) => _jsx("button", { type: "button", className: "pitch-slot", style: { left: `${slot.x}%`, top: `${slot.y}%` }, onClick: () => editSlot(index), title: "Edit slot", children: slot.label ?? "POS" }, `${index}-${slot.label ?? "slot"}`)) }), _jsxs("div", { className: "slot-editor", children: [_jsx("h4", { children: editingSlot === null ? "Add slot" : "Edit slot" }), _jsxs("div", { className: "form-grid three-column", children: [_jsxs("label", { children: ["Position", _jsx("input", { value: slotLabel, onChange: (event) => setSlotLabel(event.target.value) })] }), _jsxs("label", { children: ["X", _jsx("input", { type: "number", min: "0", max: "100", value: slotX, onChange: (event) => setSlotX(event.target.value) })] }), _jsxs("label", { children: ["Y", _jsx("input", { type: "number", min: "0", max: "100", value: slotY, onChange: (event) => setSlotY(event.target.value) })] })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: () => void addOrUpdateSlot(), disabled: saving, children: saving ? "Saving..." : "Slot saved" }), editingSlot !== null ? _jsx("button", { type: "button", className: "secondary", onClick: () => removeSlot(editingSlot), disabled: saving, children: "Remove slot" }) : null] })] }), _jsx("div", { className: "slot-list", children: slots.map((slot, index) => _jsxs("div", { children: [_jsxs("span", { children: [index + 1, ". ", slot.label ?? "POS", " (", slot.x, ", ", slot.y, ")"] }), _jsx("button", { type: "button", onClick: () => editSlot(index), children: "Edit" })] }, `${index}-${slot.label ?? "slot"}`)) })] }) : null] })] });
}
