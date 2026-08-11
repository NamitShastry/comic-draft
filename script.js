"use strict";

/* =========================================================
   UTILS
   ========================================================= */

function generateUniqueId(prefix) {
  return (prefix || "id") + "-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rectsOverlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"];

function isAcceptedImageFile(file) {
  return !!file && ACCEPTED_MIME.includes(file.type);
}

/* =========================================================
   SOURCE STATE
   ========================================================= */

const appState = {
  panels: [],
  settings: {
    pageSize: "A4",
    orientation: "portrait",
    layoutStyle: "balanced",
    borderStyle: "thin",
    background: "#ffffff",
    customBg: "#ffffff", // BUGFIX: initialize so state matches the swatch's default from the start,
                          // rather than staying undefined until the user touches the color input.
    customWidth: 6,
    customHeight: 9,
    customUnit: "in",
    defaultFont: "Comic Sans MS, Comic Neue, cursive",
    defaultFontSize: 8
  }
};

const MAX_PANELS = 10;
const MIN_PANELS = 1;
const MAX_CONTENT_PER_PANEL = 8;

/* ---- content elements (dialogue / narration) ---- */

function createContentElement(type) {
  const base = {
    id: generateUniqueId("srcContent"),
    type,
    text: "",
    font: appState.settings.defaultFont,
    fontSize: appState.settings.defaultFontSize,
    fontInherited: true // tracks the default-font/-size inheritance requirement
  };
  if (type === "dialogue") {
    base.bubbleStyle = "round";
  } else {
    base.narrationStyle = "rectangle";
    base.narrationColor = "#fdf3d0";
  }
  return base;
}

function createPanel() {
  return {
    id: generateUniqueId("panel"),
    order: 0,
    image: {
      file: null,
      src: null,
      width: null,
      height: null,
      aspectRatio: null,
      fileName: null
    },
    contentElements: [createContentElement("dialogue")], // every panel starts with one dialogue slot
    protectedRegions: [], // manual "never place text here" rects, fractions (0-1) of the NATURAL image
    ui: { collapsed: false, protecting: false }
  };
}

function normalizeOrder() {
  appState.panels.forEach((p, i) => (p.order = i + 1));
}

function findPanel(id) {
  return appState.panels.find((p) => p.id === id);
}

function findContentElement(panel, contentId) {
  return panel.contentElements.find((c) => c.id === contentId);
}

/* =========================================================
   PANEL OPERATIONS
   ========================================================= */

function addPanel() {
  if (appState.panels.length >= MAX_PANELS) return;
  appState.panels.push(createPanel());
  normalizeOrder();
  renderPanelList();
  updateAddPanelState();
}

function removePanel(id) {
  if (appState.panels.length <= MIN_PANELS) return;
  const panel = findPanel(id);
  if (panel && panel.image.src) URL.revokeObjectURL(panel.image.src);
  appState.panels = appState.panels.filter((p) => p.id !== id);
  normalizeOrder();
  renderPanelList();
  updateAddPanelState();
}

function reorderPanels(sourceId, targetId) {
  if (sourceId === targetId) return;
  const fromIndex = appState.panels.findIndex((p) => p.id === sourceId);
  const toIndex = appState.panels.findIndex((p) => p.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;
  const [moved] = appState.panels.splice(fromIndex, 1);
  appState.panels.splice(toIndex, 0, moved);
  normalizeOrder();
  renderPanelList();
}

function removePanelImage(id) {
  const panel = findPanel(id);
  if (!panel) return;
  if (panel.image.src) URL.revokeObjectURL(panel.image.src);
  panel.image = { file: null, src: null, width: null, height: null, aspectRatio: null, fileName: null };
  panel.protectedRegions = [];
  renderPanelList();
}

function handleImageUpload(id, file) {
  const panel = findPanel(id);
  if (!panel) return;

  if (!isAcceptedImageFile(file)) {
    showStatus("Please upload a JPG, PNG, or WEBP image.", true);
    return;
  }

  if (panel.image.src) URL.revokeObjectURL(panel.image.src);

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    panel.image.file = file;
    panel.image.src = objectUrl;
    panel.image.width = img.naturalWidth;
    panel.image.height = img.naturalHeight;
    panel.image.aspectRatio = img.naturalWidth / img.naturalHeight;
    panel.image.fileName = file.name;
    panel.image._loadedImg = img;
    panel.image._complexityGrid = null;
    panel.protectedRegions = [];
    renderPanelList();
  };
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    showStatus("Unable to load this image. Please try another image.", true);
  };
  img.src = objectUrl;
}

/* ---- content element CRUD (source layer, pre-generation) ---- */

function addContentElement(panel, type) {
  if (panel.contentElements.length >= MAX_CONTENT_PER_PANEL) {
    showStatus(`A panel can have at most ${MAX_CONTENT_PER_PANEL} content elements.`, true);
    return;
  }
  panel.contentElements.push(createContentElement(type));
  renderPanelList();
}

function duplicateContentElement(panel, contentId) {
  if (panel.contentElements.length >= MAX_CONTENT_PER_PANEL) {
    showStatus(`A panel can have at most ${MAX_CONTENT_PER_PANEL} content elements.`, true);
    return;
  }
  const original = findContentElement(panel, contentId);
  if (!original) return;
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = generateUniqueId("srcContent");
  const idx = panel.contentElements.findIndex((c) => c.id === contentId);
  panel.contentElements.splice(idx + 1, 0, copy);
  renderPanelList();
}

function removeContentElement(panel, contentId) {
  if (panel.contentElements.length <= 1) {
    // keep at least one slot so the panel always has somewhere to type into;
    // clearing its text is equivalent to "no content" for generation purposes
    const el = findContentElement(panel, contentId);
    if (el) el.text = "";
    renderPanelList();
    return;
  }
  panel.contentElements = panel.contentElements.filter((c) => c.id !== contentId);
  renderPanelList();
}

/* =========================================================
   UI RENDERING - PANEL LIST (source input cards, left column)
   ========================================================= */

const panelListEl = document.getElementById("panelList");

function panelStatusText(panel) {
  const hasImage = !!panel.image.src;
  const hasText = panel.contentElements.some((c) => c.text.trim().length > 0);
  if (hasImage && hasText) return "\u2713 Image \u00b7 \u2713 Text";
  if (hasImage) return "\u2713 Image \u00b7 \u25cb Text";
  if (hasText) return "\u25cb Image \u00b7 \u2713 Text";
  return "\u25cb Image \u00b7 \u25cb Text";
}

let dragSourceId = null;

function renderPanelList() {
  panelListEl.innerHTML = "";

  appState.panels.forEach((panel, index) => {
    const card = document.createElement("div");
    card.className = "panel-card" + (panel.ui.collapsed ? " collapsed" : "");
    card.dataset.panelId = panel.id;

    const header = document.createElement("div");
    header.className = "panel-card-header";

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "\u22ee\u22ee";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      dragSourceId = panel.id;
      e.dataTransfer.effectAllowed = "move";
    });
    header.appendChild(handle);

    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "PANEL " + String(index + 1).padStart(2, "0");
    header.appendChild(title);

    const status = document.createElement("span");
    status.className = "panel-status";
    status.textContent = panelStatusText(panel);
    header.appendChild(status);

    const collapseBtn = document.createElement("button");
    collapseBtn.className = "panel-collapse-btn";
    collapseBtn.textContent = panel.ui.collapsed ? "\u02c5" : "\u02c4";
    collapseBtn.setAttribute("aria-label", "Toggle panel");
    collapseBtn.addEventListener("click", () => {
      panel.ui.collapsed = !panel.ui.collapsed;
      renderPanelList();
    });
    header.appendChild(collapseBtn);

    const removeBtn = document.createElement("button");
    removeBtn.className = "panel-remove-btn";
    removeBtn.textContent = "\u2715";
    removeBtn.setAttribute("aria-label", "Remove panel");
    removeBtn.disabled = appState.panels.length <= MIN_PANELS;
    removeBtn.addEventListener("click", () => removePanel(panel.id));
    header.appendChild(removeBtn);

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (dragSourceId) reorderPanels(dragSourceId, panel.id);
      dragSourceId = null;
    });

    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "panel-card-body";

    if (panel.image.src) {
      body.appendChild(buildImagePreviewWithProtection(panel));
    } else {
      const zone = document.createElement("div");
      zone.className = "upload-zone";
      zone.innerHTML = "<strong>Upload Panel Image</strong><span>Drag &amp; drop or click to browse</span>";
      zone.addEventListener("click", () => triggerFilePicker(panel.id));
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("drag-active");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-active"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drag-active");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleImageUpload(panel.id, file);
      });
      body.appendChild(zone);

      const drawBtn = document.createElement("button");
      drawBtn.className = "btn btn-secondary btn-small btn-block";
      drawBtn.style.marginTop = "8px";
      drawBtn.textContent = "\u270e Draw Manually";
      drawBtn.addEventListener("click", () => openDrawModal(panel.id));
      body.appendChild(drawBtn);
    }

    const contentLabel = document.createElement("label");
    contentLabel.className = "field-label";
    contentLabel.style.marginTop = "4px";
    contentLabel.textContent = "Content";
    body.appendChild(contentLabel);

    const listWrap = document.createElement("div");
    listWrap.className = "content-elements-list";
    panel.contentElements.forEach((el, i) => {
      listWrap.appendChild(buildContentElementCard(panel, el, i));
    });
    body.appendChild(listWrap);

    const addRow = document.createElement("div");
    addRow.className = "add-element-row";
    const addDialogueBtn = document.createElement("button");
    addDialogueBtn.className = "btn btn-secondary btn-small";
    addDialogueBtn.textContent = "+ Add Dialogue";
    addDialogueBtn.disabled = panel.contentElements.length >= MAX_CONTENT_PER_PANEL;
    addDialogueBtn.addEventListener("click", () => addContentElement(panel, "dialogue"));
    const addNarrationBtn = document.createElement("button");
    addNarrationBtn.className = "btn btn-secondary btn-small";
    addNarrationBtn.textContent = "+ Add Narration";
    addNarrationBtn.disabled = panel.contentElements.length >= MAX_CONTENT_PER_PANEL;
    addNarrationBtn.addEventListener("click", () => addContentElement(panel, "narration"));
    addRow.appendChild(addDialogueBtn);
    addRow.appendChild(addNarrationBtn);
    body.appendChild(addRow);

    card.appendChild(body);
    panelListEl.appendChild(card);
  });
}

function buildContentElementCard(panel, el, index) {
  const card = document.createElement("div");
  card.className = "content-element-card";

  const header = document.createElement("div");
  header.className = "content-element-header";
  const label = document.createElement("span");
  label.textContent = (el.type === "dialogue" ? "Dialogue " : "Narration ") + (index + 1);
  header.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "ce-actions";
  const dupBtn = document.createElement("button");
  dupBtn.title = "Duplicate";
  dupBtn.textContent = "\u2398";
  dupBtn.addEventListener("click", () => duplicateContentElement(panel, el.id));
  actions.appendChild(dupBtn);
  const delBtn = document.createElement("button");
  delBtn.title = "Delete";
  delBtn.textContent = "\u2715";
  delBtn.addEventListener("click", () => removeContentElement(panel, el.id));
  actions.appendChild(delBtn);
  header.appendChild(actions);
  card.appendChild(header);

  const row = document.createElement("div");
  row.className = "content-type-row";

  const typeCol = document.createElement("div");
  const typeLbl = document.createElement("label");
  typeLbl.className = "field-label";
  typeLbl.textContent = "Type";
  typeCol.appendChild(typeLbl);
  const typeSelect = document.createElement("select");
  typeSelect.className = "panel-select";
  [["dialogue", "Dialogue"], ["narration", "Narration"]].forEach(([val, lbl]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = lbl;
    if (el.type === val) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => {
    const newType = typeSelect.value;
    if (newType === el.type) return;
    el.type = newType;
    if (newType === "dialogue") {
      el.bubbleStyle = el.bubbleStyle || "round";
      delete el.narrationStyle;
      delete el.narrationColor;
    } else {
      el.narrationStyle = el.narrationStyle || "rectangle";
      el.narrationColor = el.narrationColor || "#fdf3d0";
      delete el.bubbleStyle;
    }
    renderPanelList();
  });
  typeCol.appendChild(typeSelect);
  row.appendChild(typeCol);

  const styleCol = document.createElement("div");
  const styleLbl = document.createElement("label");
  styleLbl.className = "field-label";
  styleLbl.textContent = el.type === "dialogue" ? "Bubble Style" : "Narration Style";
  styleCol.appendChild(styleLbl);
  const styleSelect = document.createElement("select");
  styleSelect.className = "panel-select";
  const styleOptions =
    el.type === "dialogue"
      ? [["round", "Round"], ["oval", "Oval"], ["cloud", "Cloud"], ["rounded", "Rounded"], ["jagged", "Jagged"], ["burst", "Burst / Shout"], ["whisper", "Whisper"], ["thought", "Thought"]]
      : [["rectangle", "Rectangle"], ["rounded", "Rounded Rect."]];
  styleOptions.forEach(([val, lbl]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = lbl;
    if ((el.type === "dialogue" ? el.bubbleStyle : el.narrationStyle) === val) opt.selected = true;
    styleSelect.appendChild(opt);
  });
  styleSelect.addEventListener("change", () => {
    if (el.type === "dialogue") el.bubbleStyle = styleSelect.value;
    else el.narrationStyle = styleSelect.value;
  });
  styleCol.appendChild(styleSelect);
  row.appendChild(styleCol);
  card.appendChild(row);

  if (el.type === "narration") {
    const colorLbl = document.createElement("label");
    colorLbl.className = "field-label";
    colorLbl.textContent = "Narration Color";
    card.appendChild(colorLbl);
    const colorRow = document.createElement("div");
    colorRow.className = "narration-color-row";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = el.narrationColor;
    colorInput.addEventListener("input", () => (el.narrationColor = colorInput.value));
    colorRow.appendChild(colorInput);
    ["#fdf3d0", "#fbe98a", "#ffffff"].forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shape-option" + (el.narrationColor === preset ? " active" : "");
      btn.style.background = preset;
      btn.style.width = "26px";
      btn.style.height = "26px";
      btn.style.padding = "0";
      btn.addEventListener("click", () => {
        el.narrationColor = preset;
        colorInput.value = preset;
      });
      colorRow.appendChild(btn);
    });
    card.appendChild(colorRow);
  }

  const textLbl = document.createElement("label");
  textLbl.className = "field-label";
  textLbl.textContent = "Text";
  card.appendChild(textLbl);
  const textarea = document.createElement("textarea");
  textarea.className = "panel-text";
  textarea.style.minHeight = "50px";
  textarea.placeholder = el.type === "narration" ? "Enter the narration..." : "Enter the dialogue...";
  textarea.value = el.text;
  textarea.addEventListener("input", (e) => {
    el.text = e.target.value;
  });
  card.appendChild(textarea);

  // Advanced (font) controls, progressively disclosed
  const advToggle = document.createElement("button");
  advToggle.type = "button";
  advToggle.className = "ce-advanced-toggle";
  let advOpen = false;
  advToggle.textContent = "Advanced (font) \u25be";
  card.appendChild(advToggle);

  const advPanel = document.createElement("div");
  advPanel.className = "ce-advanced-panel";
  advPanel.hidden = true;

  const fontRow = document.createElement("div");
  fontRow.className = "content-type-row";
  const fontCol = document.createElement("div");
  const fontLbl = document.createElement("label");
  fontLbl.className = "field-label";
  fontLbl.textContent = "Font";
  fontCol.appendChild(fontLbl);
  const fontSelect = document.createElement("select");
  fontSelect.className = "panel-select";
  FONT_OPTIONS.forEach(([val, lbl]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = lbl;
    if (el.font === val) opt.selected = true;
    fontSelect.appendChild(opt);
  });
  fontSelect.addEventListener("change", () => {
    el.font = fontSelect.value;
    el.fontInherited = false;
  });
  fontCol.appendChild(fontSelect);
  fontRow.appendChild(fontCol);

  const sizeCol = document.createElement("div");
  const sizeLbl = document.createElement("label");
  sizeLbl.className = "field-label";
  sizeLbl.textContent = "Size (pt)";
  sizeCol.appendChild(sizeLbl);
  const sizeSelect = document.createElement("select");
  sizeSelect.className = "panel-select";
  [6, 7, 8, 9, 10, 11, 12, 14, 16].forEach((sz) => {
    const opt = document.createElement("option");
    opt.value = String(sz); opt.textContent = String(sz);
    if (Number(el.fontSize) === sz) opt.selected = true;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.addEventListener("change", () => {
    el.fontSize = Number(sizeSelect.value);
    el.fontInherited = false;
  });
  sizeCol.appendChild(sizeSelect);
  fontRow.appendChild(sizeCol);
  advPanel.appendChild(fontRow);

  const inheritedNote = document.createElement("p");
  inheritedNote.className = "prop-empty";
  inheritedNote.style.margin = "0";
  inheritedNote.textContent = el.fontInherited
    ? "Using the page's default font/size. Changing either field above switches this to a custom font."
    : "Using a custom font for this element.";
  advPanel.appendChild(inheritedNote);

  if (!el.fontInherited) {
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn btn-outline btn-small";
    resetBtn.textContent = "Use Default Font";
    resetBtn.addEventListener("click", () => {
      el.font = appState.settings.defaultFont;
      el.fontSize = appState.settings.defaultFontSize;
      el.fontInherited = true;
      renderPanelList();
    });
    advPanel.appendChild(resetBtn);
  }

  card.appendChild(advPanel);
  advToggle.addEventListener("click", () => {
    advOpen = !advOpen;
    advPanel.hidden = !advOpen;
    advToggle.textContent = advOpen ? "Advanced (font) \u25b4" : "Advanced (font) \u25be";
  });

  return card;
}

const FONT_OPTIONS = [
  ["Comic Sans MS, Comic Neue, cursive", "Comic (Comic Neue / Comic Sans)"],
  ["Bangers, Arial, sans-serif", "Bangers-style Display"],
  ["Arial, sans-serif", "Arial (Clean)"],
  ["Georgia, serif", "Georgia (Classic)"],
  ["Courier New, monospace", "Courier (Typewriter)"]
];

/* =========================================================
   MANUAL "PROTECT CHARACTER AREA" TOOL (fractions of NATURAL image)
   ========================================================= */

function getContainedImageRect(imgEl) {
  const rect = imgEl.getBoundingClientRect();
  const natRatio = imgEl.naturalWidth / imgEl.naturalHeight;
  const boxRatio = rect.width / rect.height;
  let dispW, dispH, offX, offY;
  if (natRatio > boxRatio) {
    dispW = rect.width;
    dispH = rect.width / natRatio;
    offX = 0;
    offY = (rect.height - dispH) / 2;
  } else {
    dispH = rect.height;
    dispW = rect.height * natRatio;
    offY = 0;
    offX = (rect.width - dispW) / 2;
  }
  return { rect, dispW, dispH, offX, offY };
}

function buildImagePreviewWithProtection(panel) {
  const wrap = document.createElement("div");
  wrap.className = "image-preview-wrap";

  const box = document.createElement("div");
  box.className = "image-preview-box";

  const img = document.createElement("img");
  img.src = panel.image.src;
  img.alt = "Panel image preview";
  img.draggable = false;
  box.appendChild(img);

  function renderProtectedRectOverlays() {
    box.querySelectorAll(".protect-rect").forEach((el) => el.remove());
    if (!img.complete || img.naturalWidth === 0) return;
    const { dispW, dispH, offX, offY } = getContainedImageRect(img);
    panel.protectedRegions.forEach((region) => {
      const rectEl = document.createElement("div");
      rectEl.className = "protect-rect";
      rectEl.style.left = offX + region.x * dispW + "px";
      rectEl.style.top = offY + region.y * dispH + "px";
      rectEl.style.width = region.width * dispW + "px";
      rectEl.style.height = region.height * dispH + "px";
      const removeBtn = document.createElement("button");
      removeBtn.className = "protect-rect-remove";
      removeBtn.textContent = "\u2715";
      removeBtn.title = "Remove protected area";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.protectedRegions = panel.protectedRegions.filter((r) => r.id !== region.id);
        renderProtectedRectOverlays();
      });
      rectEl.appendChild(removeBtn);
      box.appendChild(rectEl);
    });
  }

  img.addEventListener("load", renderProtectedRectOverlays);
  if (img.complete) renderProtectedRectOverlays();

  let drawing = null;

  box.addEventListener("pointerdown", (e) => {
    if (!panel.ui.protecting) return;
    if (e.target !== box && e.target !== img) return;
    const { dispW, dispH, offX, offY } = getContainedImageRect(img);
    const boxRect = box.getBoundingClientRect();
    const startX = clamp(e.clientX - boxRect.left - offX, 0, dispW);
    const startY = clamp(e.clientY - boxRect.top - offY, 0, dispH);

    const previewEl = document.createElement("div");
    previewEl.className = "protect-rect";
    box.appendChild(previewEl);

    drawing = { startX, startY, dispW, dispH, offX, offY, previewEl };

    function move(ev) {
      const curX = clamp(ev.clientX - boxRect.left - offX, 0, dispW);
      const curY = clamp(ev.clientY - boxRect.top - offY, 0, dispH);
      const x = Math.min(curX, drawing.startX);
      const y = Math.min(curY, drawing.startY);
      const w = Math.abs(curX - drawing.startX);
      const h = Math.abs(curY - drawing.startY);
      previewEl.style.left = offX + x + "px";
      previewEl.style.top = offY + y + "px";
      previewEl.style.width = w + "px";
      previewEl.style.height = h + "px";
      drawing.current = { x, y, w, h };
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      previewEl.remove();
      if (drawing.current && drawing.current.w > 8 && drawing.current.h > 8) {
        panel.protectedRegions.push({
          id: generateUniqueId("protect"),
          x: drawing.current.x / dispW,
          y: drawing.current.y / dispH,
          width: drawing.current.w / dispW,
          height: drawing.current.h / dispH,
          source: "manual"
        });
        renderProtectedRectOverlays();
      }
      drawing = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  wrap.appendChild(box);

  const meta = document.createElement("div");
  meta.className = "image-preview-meta";
  meta.textContent = `${panel.image.fileName || "image"} \u2014 ${panel.image.width}\u00d7${panel.image.height}`;
  wrap.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "image-preview-actions";

  const replaceBtn = document.createElement("button");
  replaceBtn.className = "btn btn-secondary btn-small";
  replaceBtn.textContent = "Replace Image";
  replaceBtn.addEventListener("click", () => triggerFilePicker(panel.id));
  actions.appendChild(replaceBtn);

  const drawBtn = document.createElement("button");
  drawBtn.className = "btn btn-secondary btn-small";
  drawBtn.textContent = "\u270e Draw New";
  drawBtn.addEventListener("click", () => openDrawModal(panel.id));
  actions.appendChild(drawBtn);

  const removeImgBtn = document.createElement("button");
  removeImgBtn.className = "btn btn-outline btn-small";
  removeImgBtn.textContent = "Remove Image";
  removeImgBtn.addEventListener("click", () => removePanelImage(panel.id));
  actions.appendChild(removeImgBtn);

  const protectBtn = document.createElement("button");
  protectBtn.className = "btn btn-outline btn-small" + (panel.ui.protecting ? " active" : "");
  protectBtn.textContent = panel.ui.protecting ? "Done Protecting" : "Protect Character Area";
  protectBtn.title = "Draw a box over a character so text is never placed on top of it.";
  protectBtn.addEventListener("click", () => {
    panel.ui.protecting = !panel.ui.protecting;
    box.classList.toggle("protecting", panel.ui.protecting);
    protectBtn.classList.toggle("active", panel.ui.protecting);
    protectBtn.textContent = panel.ui.protecting ? "Done Protecting" : "Protect Character Area";
  });
  actions.appendChild(protectBtn);

  if (panel.protectedRegions.length > 0) {
    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn-outline btn-small";
    clearBtn.textContent = `Clear Protected Areas (${panel.protectedRegions.length})`;
    clearBtn.addEventListener("click", () => {
      panel.protectedRegions = [];
      renderProtectedRectOverlays();
    });
    actions.appendChild(clearBtn);
  }

  wrap.appendChild(actions);
  return wrap;
}

// A single hidden file input, reused for every panel and kept attached to
// the DOM (a detached <input> fails silently in some browsers on .click()).
let hiddenFileInput = null;

function getHiddenFileInput() {
  if (hiddenFileInput) return hiddenFileInput;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "-9999px";
  document.body.appendChild(input);
  hiddenFileInput = input;
  return input;
}

function triggerFilePicker(panelId) {
  const input = getHiddenFileInput();
  input.value = "";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (file) handleImageUpload(panelId, file);
    input.onchange = null;
  };
  input.click();
}

function updateAddPanelState() {
  const addBtn = document.getElementById("addPanelBtn");
  const limitMsg = document.getElementById("panelLimitMsg");
  const atMax = appState.panels.length >= MAX_PANELS;
  addBtn.disabled = atMax;
  limitMsg.hidden = !atMax;
}

/* =========================================================
   STATUS
   ========================================================= */

function showStatus(msg, isError) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.className = "status-msg" + (isError ? " error" : "");
}

/* =========================================================
   GLOBAL FONT DEFAULTS — cascades to every content element (source
   panels AND, if already generated, the live pageState) that is
   still marked as "inherited". Explicitly customized elements are
   left untouched.
   ========================================================= */

function applyGlobalFontDefaults(font, size) {
  appState.settings.defaultFont = font;
  appState.settings.defaultFontSize = size;

  appState.panels.forEach((panel) => {
    panel.contentElements.forEach((el) => {
      if (el.fontInherited) {
        el.font = font;
        el.fontSize = size;
      }
    });
  });
  renderPanelList();

  if (pageState) {
    pageState.panels.forEach((panel) => {
      panel.contents.forEach((c) => {
        if (c.style.fontInherited) {
          c.style.font = font;
          c.style.fontSize = null; // null = auto-fit at the (new) default proportions
          c.style.fontSizePt = size;
        }
      });
    });
    markEdited();
    renderEditor();
  }
}

/* =========================================================
   PAGE SIZE SYSTEM — real physical dimensions (mm) -> pixels via DPI
   ========================================================= */

const EXPORT_DPI = 300;

function ptToPx(pt) {
  return Math.round((Number(pt) || 8) * (EXPORT_DPI / 72));
}

const ISO_SIZES_MM = {
  A4: { wmm: 210, hmm: 297 },
  A5: { wmm: 148, hmm: 210 },
  A3: { wmm: 297, hmm: 420 },
  B5: { wmm: 176, hmm: 250 },
  B4: { wmm: 250, hmm: 353 }
};

const COMIC_SIZES_IN = {
  "6x9": { win: 6, hin: 9 },
  "7x10": { win: 7, hin: 10 },
  "6.625x10.25": { win: 6.625, hin: 10.25 },
  "6.5x10": { win: 6.5, hin: 10 },
  "7.5x10": { win: 7.5, hin: 10 },
  "8x10": { win: 8, hin: 10 },
  "8.5x11": { win: 8.5, hin: 11 }
};

function inToMm(v) { return v * 25.4; }
function cmToMm(v) { return v * 10; }

function unitToMm(value, unit) {
  if (unit === "in") return inToMm(value);
  if (unit === "cm") return cmToMm(value);
  return value;
}

function mmToPx(mm) {
  return Math.round((mm / 25.4) * EXPORT_DPI);
}

const CUSTOM_SIZE_MIN_MM = 40;
const CUSTOM_SIZE_MAX_MM = 1500;

function resolvePageMm(settings) {
  if (settings.pageSize === "custom") {
    const w = unitToMm(Number(settings.customWidth) || 0, settings.customUnit);
    const h = unitToMm(Number(settings.customHeight) || 0, settings.customUnit);
    if (!isFinite(w) || !isFinite(h) || w < CUSTOM_SIZE_MIN_MM || h < CUSTOM_SIZE_MIN_MM || w > CUSTOM_SIZE_MAX_MM || h > CUSTOM_SIZE_MAX_MM) {
      return { wmm: 210, hmm: 297, invalid: true };
    }
    return { wmm: w, hmm: h };
  }
  if (ISO_SIZES_MM[settings.pageSize]) return ISO_SIZES_MM[settings.pageSize];
  if (COMIC_SIZES_IN[settings.pageSize]) {
    const size = COMIC_SIZES_IN[settings.pageSize];
    return { wmm: inToMm(size.win), hmm: inToMm(size.hin) };
  }
  return ISO_SIZES_MM.A4;
}

function getPageDimensions(settings) {
  const { wmm, hmm } = resolvePageMm(settings);
  let w = mmToPx(wmm);
  let h = mmToPx(hmm);
  if (settings.orientation === "landscape") { [w, h] = [h, w]; }
  return { width: w, height: h };
}

function formatSelectedSizeInfo(settings) {
  const { wmm, hmm, invalid } = resolvePageMm(settings);
  let effWmm = wmm, effHmm = hmm;
  if (settings.orientation === "landscape") { [effWmm, effHmm] = [hmm, wmm]; }
  const wIn = (effWmm / 25.4).toFixed(2);
  const hIn = (effHmm / 25.4).toFixed(2);
  return invalid
    ? "Invalid custom size \u2014 using A4 as a fallback."
    : `${effWmm.toFixed(1)} \u00d7 ${effHmm.toFixed(1)} mm  (${wIn} \u00d7 ${hIn} in)`;
}

function updateSelectedSizeInfo() {
  document.getElementById("selectedSizeInfo").textContent = formatSelectedSizeInfo(appState.settings);
}

// BUGFIX (background = custom): resolveBackground now always resolves to a
// real color value. appState.settings.customBg is initialized up front (see
// settings object above) so it's never undefined even before the user first
// touches the color swatch.
function resolveBackground(settings) {
  if (settings.background === "custom") return settings.customBg || "#ffffff";
  return settings.background;
}

/* =========================================================
   IMAGE COMPLEXITY ANALYSIS (negative-space heuristic — no AI)
   ========================================================= */

const COMPLEXITY_GRID_SIZE = 48;

function computeComplexityGrid(imgEl) {
  const size = COMPLEXITY_GRID_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, size, size);
  let data;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch (err) {
    return null;
  }
  const lum = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { size, lum };
}

function getComplexityGridForPanelImage(panelImage) {
  if (!panelImage || !panelImage._loadedImg) return null;
  if (!panelImage._complexityGrid) {
    panelImage._complexityGrid = computeComplexityGrid(panelImage._loadedImg);
  }
  return panelImage._complexityGrid;
}

function regionBusyness(grid, fx0, fy0, fx1, fy1) {
  if (!grid) return 0;
  const { size, lum } = grid;
  const cx0 = clamp(Math.floor(fx0 * size), 0, size - 1);
  const cx1 = clamp(Math.ceil(fx1 * size), cx0 + 1, size);
  const cy0 = clamp(Math.floor(fy0 * size), 0, size - 1);
  const cy1 = clamp(Math.ceil(fy1 * size), cy0 + 1, size);
  let sum = 0, sumSq = 0, n = 0;
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const v = lum[y * size + x];
      sum += v; sumSq += v * v; n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return Math.sqrt(variance);
}

function computeCoverFit(natW, natH, boxW, boxH) {
  return Math.max(boxW / natW, boxH / natH);
}

function panelRectToImageFraction(panelLike, rectX, rectY, rectW, rectH) {
  const image = panelLike.image;
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;
  const natW = image.naturalWidth, natH = image.naturalHeight;
  const scale = image.scale || 1;
  const offsetX = image.offsetX || 0;
  const offsetY = image.offsetY || 0;

  const coverScale = computeCoverFit(natW, natH, panelLike.width, panelLike.height);
  const finalScale = coverScale * scale;
  const drawW = natW * finalScale;
  const drawH = natH * finalScale;
  const centerX = panelLike.width / 2 + offsetX;
  const centerY = panelLike.height / 2 + offsetY;
  const imgLeft = centerX - drawW / 2;
  const imgTop = centerY - drawH / 2;

  const localX = rectX - imgLeft;
  const localY = rectY - imgTop;
  const natX = localX / finalScale;
  const natY = localY / finalScale;
  const natRectW = rectW / finalScale;
  const natRectH = rectH / finalScale;

  return {
    fx0: natX / natW,
    fy0: natY / natH,
    fx1: (natX + natRectW) / natW,
    fy1: (natY + natRectH) / natH
  };
}

function rectOverlapsProtectedRegions(panelLike, regions, rectX, rectY, rectW, rectH) {
  if (!regions || regions.length === 0) return false;
  const frac = panelRectToImageFraction(panelLike, rectX, rectY, rectW, rectH);
  if (!frac) return false;
  return regions.some((r) =>
    rectsOverlap(frac.fx0, frac.fy0, frac.fx1, frac.fy1, r.x, r.y, r.x + r.width, r.y + r.height)
  );
}

// Content-vs-content collision: panel-local rects, no fraction conversion needed.
function rectOverlapsOccupied(occupied, x, y, w, h, excludeId) {
  return occupied.some((o) => o.id !== excludeId && rectsOverlap(x, y, x + w, y + h, o.x, o.y, o.x + o.width, o.y + o.height));
}

function contentIsUnsafe(panel, content) {
  const protectedHit = rectOverlapsProtectedRegions(panel, panel.protectedRegions, content.x, content.y, content.width, content.height);
  if (protectedHit) return true;
  const siblingOccupied = panel.contents
    .filter((c) => c.id !== content.id)
    .map((c) => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height }));
  return rectOverlapsOccupied(siblingOccupied, content.x, content.y, content.width, content.height, content.id);
}

/* =========================================================
   AUTOMATIC PANEL LAYOUT (frames only)
   ========================================================= */

function classifyAspect(ratio) {
  if (ratio < 0.75) return "portrait";
  if (ratio > 1.25) return "landscape";
  return "square";
}

function getRowTemplates(count, style) {
  const templates = {
    1: [[[1]]],
    2: [[[1], [1]], [[1, 1]]],
    3: [[[1], [1, 1]], [[1, 1], [1]]],
    4: [[[1, 1], [1, 1]], [[1], [1, 1], [1]]],
    5: [
      [[1], [1, 1], [1], [1]],
      [[1, 1], [1], [1, 1]],
      [[1], [1, 1], [1, 1]],
      [[1.3, 0.7], [1], [1, 1]]
    ],
    6: [[[1, 1], [1, 1], [1, 1]], [[1], [1, 1], [1, 1, 1]]],
    7: [[[1], [1, 1], [1, 1], [1, 1]]],
    8: [[[1, 1], [1, 1], [1, 1], [1, 1]]],
    9: [[[1, 1, 1], [1, 1, 1], [1, 1, 1]]],
    10: [[[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]]
  };
  const list = templates[count] || templates[10];
  const styleIndexPref = { balanced: 0, classic: 0, cinematic: list.length - 1, grid: 0 };
  const preferred = styleIndexPref[style] ?? 0;
  return { list, preferredIndex: clamp(preferred, 0, list.length - 1) };
}

function buildFramesFromTemplate(template, count, pageW, pageH, margins, gutter) {
  const usableW = pageW - margins.left - margins.right;
  const usableH = pageH - margins.top - margins.bottom;
  const rows = template;
  const rowHeight = (usableH - gutter * (rows.length - 1)) / rows.length;
  const frames = [];
  let y = margins.top;
  for (let r = 0; r < rows.length; r++) {
    const weights = rows[r];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let x = margins.left;
    for (let c = 0; c < weights.length; c++) {
      const w = ((usableW - gutter * (weights.length - 1)) * weights[c]) / totalWeight;
      frames.push({ x, y, width: w, height: rowHeight });
      x += w + gutter;
    }
    y += rowHeight + gutter;
  }
  return frames.slice(0, count);
}

function scoreFrames(frames, panels) {
  let score = 0;
  frames.forEach((frame, i) => {
    const panel = panels[i];
    if (!panel || !panel.image.aspectRatio) return;
    const frameRatio = frame.width / frame.height;
    const imgRatio = panel.image.aspectRatio;
    if (classifyAspect(frameRatio) !== classifyAspect(imgRatio)) score -= 2;
  });
  return score;
}

function calculateAutoLayoutFrames(panels, settings) {
  const { width: pageWidth, height: pageHeight } = getPageDimensions(settings);
  const margins = {
    top: Math.round(pageHeight * 0.05),
    bottom: Math.round(pageHeight * 0.05),
    left: Math.round(pageWidth * 0.05),
    right: Math.round(pageWidth * 0.05)
  };
  const gutter = Math.round(pageWidth * 0.02);
  const count = clamp(panels.length, 1, 10);
  const { list, preferredIndex } = getRowTemplates(count, settings.layoutStyle);

  const candidates = list.map((tpl) => buildFramesFromTemplate(tpl, count, pageWidth, pageHeight, margins, gutter));
  let best = candidates[preferredIndex];
  let bestScore = scoreFrames(best, panels);
  candidates.forEach((c) => {
    const s = scoreFrames(c, panels);
    if (s > bestScore) { bestScore = s; best = c; }
  });

  return { page: { width: pageWidth, height: pageHeight, background: resolveBackground(settings) }, margins, gutter, frames: best };
}

/* =========================================================
   CHARACTER-SAFE + CONTENT-SAFE PLACEMENT
   Tests 8 candidate positions, rejects any overlapping a manually
   protected region OR an already-placed sibling content element in
   the same panel, then among survivors picks the least "busy" spot
   by real pixel analysis of the artwork.
   ========================================================= */

function buildPlacementCandidates(frame, boxW, boxH) {
  const margin = Math.min(frame.width, frame.height) * 0.06;
  return [
    { name: "top-left", x: margin, y: margin },
    { name: "top-center", x: (frame.width - boxW) / 2, y: margin },
    { name: "top-right", x: frame.width - boxW - margin, y: margin },
    { name: "middle-left", x: margin, y: (frame.height - boxH) / 2 },
    { name: "middle-right", x: frame.width - boxW - margin, y: (frame.height - boxH) / 2 },
    { name: "bottom-left", x: margin, y: frame.height - boxH - margin },
    { name: "bottom-center", x: (frame.width - boxW) / 2, y: frame.height - boxH - margin },
    { name: "bottom-right", x: frame.width - boxW - margin, y: frame.height - boxH - margin }
  ].map((c) => ({ ...c, x: clamp(c.x, 0, Math.max(0, frame.width - boxW)), y: clamp(c.y, 0, Math.max(0, frame.height - boxH)) }));
}

function findSafeContentPosition(panel, frame, boxW, boxH, occupied) {
  const panelLike = { width: frame.width, height: frame.height, image: panel.image._loadedImg ? panel.image : null };
  const candidates = buildPlacementCandidates(frame, boxW, boxH);
  const grid = getComplexityGridForPanelImage(panel.image);
  const regions = panel.protectedRegions;
  occupied = occupied || [];

  let safeCandidates = candidates.filter(
    (c) =>
      !rectOverlapsProtectedRegions(panelLike, regions, c.x, c.y, boxW, boxH) &&
      !rectOverlapsOccupied(occupied, c.x, c.y, boxW, boxH)
  );

  let usedFallback = false;
  if (safeCandidates.length === 0) {
    safeCandidates = candidates.filter((c) => !rectOverlapsOccupied(occupied, c.x, c.y, boxW, boxH));
    if (safeCandidates.length === 0) safeCandidates = candidates;
    usedFallback = true;
  }

  let best = safeCandidates[0];
  let bestScore = Infinity;
  safeCandidates.forEach((c) => {
    let score = 0;
    if (grid && panel.image._loadedImg) {
      const frac = panelRectToImageFraction(panelLike, c.x, c.y, boxW, boxH);
      if (frac) score = regionBusyness(grid, frac.fx0, frac.fy0, frac.fx1, frac.fy1);
    }
    const tieBreak = ["top-left", "top-center", "top-right"].includes(c.name) ? -0.001 : 0;
    score += tieBreak;
    if (score < bestScore) { bestScore = score; best = c; }
  });

  return { x: best.x, y: best.y, needsManualAdjustment: usedFallback };
}

/* =========================================================
   EDITABLE PAGE STATE — single source of truth for editor + exporter
   ========================================================= */

function defaultDialogueStyle(bubbleStyle, font, fontSizePt, fontInherited) {
  return {
    shape: bubbleStyle || "round",
    fill: "#ffffff",
    borderColor: "#000000",
    borderWidth: 3,
    font: font || appState.settings.defaultFont,
    fontSizePt: fontSizePt || appState.settings.defaultFontSize,
    fontInherited: fontInherited !== false,
    color: "#000000",
    align: "center",
    opacity: 1
  };
}

function defaultNarrationStyle(narrationStyle, color, font, fontSizePt, fontInherited) {
  return {
    fill: color || "#fdf3d0",
    borderColor: "#000000",
    borderWidth: 2,
    font: font || appState.settings.defaultFont,
    fontSizePt: fontSizePt || appState.settings.defaultFontSize,
    fontInherited: fontInherited !== false,
    color: "#000000",
    align: "center",
    cornerRadius: narrationStyle === "rounded" ? 20 : 6,
    opacity: 1
  };
}

const BORDER_WIDTHS = { none: 0, thin: 3, medium: 7, thick: 13 };

function buildPageStateFromAuto(panels, settings) {
  const auto = calculateAutoLayoutFrames(panels, settings);
  let anyNeedsManualAdjustment = false;

  const statePanels = panels.slice(0, auto.frames.length).map((panel, i) => {
    const frame = auto.frames[i];
    const occupied = [];
    const contents = [];

    panel.contentElements.forEach((el) => {
      if (!el.text || !el.text.trim().length) return;

      const boxW = clamp(frame.width * 0.5, frame.width * 0.3, frame.width * 0.75);
      const boxH = clamp(frame.height * (el.type === "dialogue" ? 0.24 : 0.16), 50, frame.height * 0.42);

      const placement = findSafeContentPosition(panel, frame, boxW, boxH, occupied);
      if (placement.needsManualAdjustment) anyNeedsManualAdjustment = true;

      const content = {
        id: generateUniqueId("content"),
        type: el.type,
        text: el.text,
        x: placement.x,
        y: placement.y,
        width: boxW,
        height: boxH,
        style:
          el.type === "dialogue"
            ? defaultDialogueStyle(el.bubbleStyle, el.font, el.fontSize, el.fontInherited)
            : defaultNarrationStyle(el.narrationStyle, el.narrationColor, el.font, el.fontSize, el.fontInherited),
        zIndex: contents.length + 1
      };
      if (el.type === "dialogue") {
        content.tailX = placement.x + boxW * 0.3;
        content.tailY = placement.y + boxH + Math.min(50, frame.height * 0.15);
      }
      contents.push(content);
      occupied.push({ id: content.id, x: placement.x, y: placement.y, width: boxW, height: boxH });
    });

    return {
      id: panel.id,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      borderWidth: BORDER_WIDTHS[settings.borderStyle] ?? 3,
      borderColor: "#000000",
      image: panel.image.src
        ? {
            src: panel.image.src,
            naturalWidth: panel.image.width,
            naturalHeight: panel.image.height,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            fit: "cover"
          }
        : null,
      protectedRegions: panel.protectedRegions.map((r) => ({ ...r })),
      contents
    };
  });

  return {
    page: auto.page,
    panels: statePanels,
    needsManualAdjustment: anyNeedsManualAdjustment
  };
}

/* =========================================================
   EDITOR RUNTIME STATE
   ========================================================= */

let pageState = null;
let selection = null;
let editorScale = 0.5;
let editedSinceGenerate = false;
let safeModeEnabled = true;

const history = [];
let historyIndex = -1;
const HISTORY_LIMIT = 60;

function snapshotPageState() {
  return JSON.parse(JSON.stringify(pageState));
}

function pushHistory() {
  if (!pageState) return;
  history.splice(historyIndex + 1);
  history.push(snapshotPageState());
  if (history.length > HISTORY_LIMIT) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedoButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  pageState = JSON.parse(JSON.stringify(history[historyIndex]));
  clampSelectionToState();
  renderEditor();
  updateUndoRedoButtons();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  pageState = JSON.parse(JSON.stringify(history[historyIndex]));
  clampSelectionToState();
  renderEditor();
  updateUndoRedoButtons();
}

function clampSelectionToState() {
  if (!selection || !pageState) { selection = null; return; }
  const panel = pageState.panels.find((p) => p.id === selection.panelId);
  if (!panel) { selection = null; return; }
  if (selection.type === "content" && !panel.contents.find((c) => c.id === selection.contentId)) {
    selection = null;
  }
}

function updateUndoRedoButtons() {
  document.getElementById("undoBtn").disabled = historyIndex <= 0;
  document.getElementById("redoBtn").disabled = historyIndex >= history.length - 1;
}

function findStatePanel(panelId) {
  return pageState.panels.find((p) => p.id === panelId);
}

function findStateContent(panelId, contentId) {
  const panel = findStatePanel(panelId);
  if (!panel) return null;
  return panel.contents.find((c) => c.id === contentId);
}

/* =========================================================
   IMAGE PRELOADING
   ========================================================= */

function preloadPanelImages(panels) {
  const jobs = panels
    .filter((p) => p.image.src)
    .map(
      (p) =>
        new Promise((resolve) => {
          if (p.image._loadedImg && p.image._loadedImg.complete) { resolve(); return; }
          const img = new Image();
          img.onload = () => { p.image._loadedImg = img; resolve(); };
          img.onerror = () => resolve();
          img.src = p.image.src;
        })
    );
  return Promise.all(jobs);
}

/* =========================================================
   GENERATE / RESET
   ========================================================= */

async function requestGenerate() {
  if (appState.panels.length === 0) {
    showStatus("Add at least one panel before generating.", true);
    return;
  }
  if (pageState && editedSinceGenerate) {
    const ok = window.confirm("Regenerating will reset your manual layout changes. Continue?");
    if (!ok) return;
  }
  await generateComicPage();
}

async function generateComicPage() {
  showStatus("Analyzing artwork and composing the page\u2026");
  await preloadPanelImages(appState.panels);

  const result = buildPageStateFromAuto(appState.panels, appState.settings);
  pageState = { page: result.page, panels: result.panels };
  selection = null;
  editedSinceGenerate = false;
  history.length = 0;
  historyIndex = -1;
  pushHistory();

  document.getElementById("previewEmptyState").hidden = true;
  document.getElementById("editorStageWrap").hidden = false;
  document.getElementById("editorToolbar").hidden = false;
  document.getElementById("propertiesPanel").hidden = false;
  setModeIndicator("auto");

  renderEditor();

  if (result.needsManualAdjustment) {
    showStatus("Page generated. One or more panels had no fully clear spot for their text \u2014 please check and adjust them manually.", true);
  } else {
    showStatus("Page generated. Click any panel, image, bubble, or caption to fine-tune it.");
  }
}

function resetLayoutToAuto() {
  if (!pageState) return;
  const ok = window.confirm("Reset the page to the automatically generated layout? Manual adjustments will be lost.");
  if (!ok) return;
  generateComicPage();
}

function setModeIndicator(mode) {
  const el = document.getElementById("modeIndicator");
  if (mode === "auto") {
    el.textContent = "Auto Composed";
    el.classList.remove("editing");
  } else if (mode === "editing") {
    el.textContent = "Editing";
    el.classList.add("editing");
  } else {
    el.textContent = "Not generated yet";
    el.classList.remove("editing");
  }
}

function markEdited() {
  editedSinceGenerate = true;
  setModeIndicator("editing");
}

/* =========================================================
   INTERACTIVE EDITOR — DOM RENDERING
   ========================================================= */

const editorPageEl = document.getElementById("editorPage");
const editorStageWrapEl = document.getElementById("editorStageWrap");

function renderEditor() {
  if (!pageState) return;

  editorPageEl.style.width = pageState.page.width + "px";
  editorPageEl.style.height = pageState.page.height + "px";
  editorPageEl.style.background = pageState.page.background;
  editorPageEl.style.transform = `scale(${editorScale})`;
  editorStageWrapEl.style.width = pageState.page.width * editorScale + "px";
  editorStageWrapEl.style.height = pageState.page.height * editorScale + "px";

  editorPageEl.innerHTML = "";
  pageState.panels.forEach((panel) => editorPageEl.appendChild(buildPanelElement(panel)));
  renderPropertiesPanel();
}

function buildPanelElement(panel) {
  const panelEl = document.createElement("div");
  panelEl.className = "panel-el" + (isSelected("panel", panel.id) ? " selected" : "");
  panelEl.style.left = panel.x + "px";
  panelEl.style.top = panel.y + "px";
  panelEl.style.width = panel.width + "px";
  panelEl.style.height = panel.height + "px";
  panelEl.style.border = panel.borderWidth > 0 ? `${panel.borderWidth}px solid ${panel.borderColor}` : "none";
  panelEl.dataset.panelId = panel.id;

  panelEl.addEventListener("pointerdown", (e) => {
    if (e.target !== panelEl) return;
    e.stopPropagation();
    selectObject("panel", panel.id, null);
    startDragPanel(e, panel);
  });

  if (panel.image) panelEl.appendChild(buildImageElement(panel));

  if (isSelected("panel", panel.id) && panel.protectedRegions && panel.protectedRegions.length) {
    panel.protectedRegions.forEach((region) => panelEl.appendChild(buildProtectedRegionOverlay(panel, region)));
  }

  panel.contents.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).forEach((content) => {
    panelEl.appendChild(buildContentElement(panel, content));
  });

  if (isSelected("panel", panel.id)) {
    panelEl.appendChild(buildResizeHandles((dx, dy, corner) => resizePanel(panel, dx, dy, corner)));
  }

  return panelEl;
}

function buildProtectedRegionOverlay(panel, region) {
  const el = document.createElement("div");
  el.className = "protected-region-overlay";
  if (!panel.image) return el;
  const natW = panel.image.naturalWidth, natH = panel.image.naturalHeight;
  const scale = panel.image.scale || 1;
  const offsetX = panel.image.offsetX || 0;
  const offsetY = panel.image.offsetY || 0;
  const coverScale = computeCoverFit(natW, natH, panel.width, panel.height);
  const finalScale = coverScale * scale;
  const drawW = natW * finalScale, drawH = natH * finalScale;
  const centerX = panel.width / 2 + offsetX;
  const centerY = panel.height / 2 + offsetY;
  const imgLeft = centerX - drawW / 2;
  const imgTop = centerY - drawH / 2;

  el.style.left = imgLeft + region.x * drawW + "px";
  el.style.top = imgTop + region.y * drawH + "px";
  el.style.width = region.width * drawW + "px";
  el.style.height = region.height * drawH + "px";
  return el;
}

function buildImageElement(panel) {
  const img = document.createElement("img");
  img.className = "panel-image-el" + (isSelected("image", panel.id) ? " selected-image" : "");
  img.src = panel.image.src;
  img.draggable = false;
  img.alt = "";

  const coverScale = computeCoverFit(panel.image.naturalWidth, panel.image.naturalHeight, panel.width, panel.height);
  const finalScale = coverScale * panel.image.scale;
  const drawW = panel.image.naturalWidth * finalScale;
  const drawH = panel.image.naturalHeight * finalScale;
  const centerX = panel.width / 2 + panel.image.offsetX;
  const centerY = panel.height / 2 + panel.image.offsetY;
  const left = centerX - drawW / 2;
  const top = centerY - drawH / 2;

  img.style.left = left + "px";
  img.style.top = top + "px";
  img.style.width = drawW + "px";
  img.style.height = drawH + "px";

  img.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    selectObject("image", panel.id, null);
    startDragImage(e, panel);
  });

  return img;
}

function buildContentElement(panel, content) {
  const el = document.createElement("div");
  const shapeClass = content.type === "dialogue" ? " shape-" + content.style.shape : "";
  const narrClass = content.type === "narration" && content.style.cornerRadius > 12 ? " narr-rounded" : "";
  el.className =
    `content-el ${content.type}${shapeClass}${narrClass}` +
    (isSelected("content", panel.id, content.id) ? " selected" : "") +
    (content._unsafe ? " unsafe" : "");
  el.style.left = content.x + "px";
  el.style.top = content.y + "px";
  el.style.width = content.width + "px";
  el.style.height = content.height + "px";
  el.style.opacity = content.style.opacity ?? 1;
  el.style.zIndex = String(10 + (content.zIndex || 0));

  const shape = document.createElement("div");
  shape.className = "content-shape";
  shape.style.background = content.style.fill;
  shape.style.borderColor = content.style.borderColor;
  shape.style.borderWidth = content.style.borderWidth + "px";
  if (content.type === "narration") shape.style.borderRadius = content.style.cornerRadius + "px";
  el.appendChild(shape);

  const textEl = document.createElement("div");
  textEl.className = "content-text";
  textEl.textContent = content.text;
  textEl.style.color = content.style.color;
  textEl.style.fontFamily = content.style.font;
  textEl.style.fontSize = ptToPx(content.style.fontSizePt) + "px";
  textEl.style.textAlign = content.style.align;
  el.appendChild(textEl);

  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    selectObject("content", panel.id, content.id);
    startDragContent(e, panel, content);
  });

  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    beginInlineTextEdit(el, textEl, panel, content);
  });

  if (isSelected("content", panel.id, content.id)) {
    el.appendChild(buildResizeHandles((dx, dy, corner) => resizeContent(panel, content, dx, dy, corner)));
    if (content.type === "dialogue" && content.style.shape === "thought") {
      buildThoughtDots(content).forEach((dot) => el.appendChild(dot));
    } else if (content.type === "dialogue") {
      el.appendChild(buildTailHandle(panel, content));
      el.appendChild(buildTailLine(content));
    }
  } else if (content.type === "dialogue" && content.style.shape === "thought") {
    buildThoughtDots(content).forEach((dot) => el.appendChild(dot));
  }

  return el;
}

function buildThoughtDots(content) {
  const dots = [];
  const startX = content.width * 0.25, startY = content.height;
  const endX = content.tailX - content.x, endY = content.tailY - content.y;
  const sizes = [14, 10, 6];
  for (let i = 0; i < sizes.length; i++) {
    const t = (i + 1) / (sizes.length + 1);
    const dot = document.createElement("div");
    dot.className = "thought-dot";
    const dx = startX + (endX - startX) * t;
    const dy = startY + (endY - startY) * t;
    dot.style.left = dx - sizes[i] / 2 + "px";
    dot.style.top = dy - sizes[i] / 2 + "px";
    dot.style.width = sizes[i] + "px";
    dot.style.height = sizes[i] + "px";
    dots.push(dot);
  }
  return dots;
}

function buildTailLine(content) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("tail-line");
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.overflow = "visible";
  svg.style.width = "1px";
  svg.style.height = "1px";
  const line = document.createElementNS(svgNS, "line");
  const startX = content.width * 0.3;
  const startY = content.height;
  const endX = content.tailX - content.x;
  const endY = content.tailY - content.y;
  line.setAttribute("x1", startX);
  line.setAttribute("y1", startY);
  line.setAttribute("x2", endX);
  line.setAttribute("y2", endY);
  line.setAttribute("stroke", "#000");
  line.setAttribute("stroke-width", "3");
  svg.appendChild(line);
  return svg;
}

function buildTailHandle(panel, content) {
  const handle = document.createElement("div");
  handle.className = "tail-handle";
  handle.style.left = (content.tailX - content.x) + "px";
  handle.style.top = (content.tailY - content.y) + "px";
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    startDragTail(e, panel, content);
  });
  return handle;
}

function buildResizeHandles(onResize) {
  const wrap = document.createElement("div");
  ["nw", "ne", "sw", "se"].forEach((corner) => {
    const h = document.createElement("div");
    h.className = "resize-handle " + corner;
    h.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      startResizeDrag(e, corner, onResize);
    });
    wrap.appendChild(h);
  });
  return wrap;
}

function isSelected(type, panelId, contentId) {
  if (!selection) return false;
  if (selection.type !== type) return false;
  if (selection.panelId !== panelId) return false;
  if (type === "content" && selection.contentId !== contentId) return false;
  return true;
}

function selectObject(type, panelId, contentId) {
  selection = { type, panelId, contentId: contentId || null };
  renderEditor();
}

function deselect() {
  selection = null;
  renderEditor();
}

editorStageWrapEl.addEventListener("pointerdown", (e) => {
  if (e.target === editorPageEl) deselect();
});

/* =========================================================
   POINTER DRAG HELPERS
   ========================================================= */

function trackPointerDrag(e, onMove, onEnd) {
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;

  function move(ev) {
    const dx = (ev.clientX - startX) / editorScale;
    const dy = (ev.clientY - startY) / editorScale;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;
    onMove(dx, dy, ev);
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved) {
      markEdited();
      pushHistory();
    }
    if (onEnd) onEnd(moved);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startDragPanel(e, panel) {
  const origX = panel.x, origY = panel.y;
  trackPointerDrag(e, (dx, dy) => {
    panel.x = clamp(origX + dx, 0, pageState.page.width - panel.width);
    panel.y = clamp(origY + dy, 0, pageState.page.height - panel.height);
    renderEditor();
  });
}

function startDragImage(e, panel) {
  const origX = panel.image.offsetX, origY = panel.image.offsetY;
  trackPointerDrag(e, (dx, dy) => {
    panel.image.offsetX = origX + dx;
    panel.image.offsetY = origY + dy;
    renderEditor();
  });
}

// Content dragging is collision-aware against BOTH protected character
// regions and sibling content boxes in the same panel.
function startDragContent(e, panel, content) {
  const origX = content.x, origY = content.y;
  const origTailX = content.tailX, origTailY = content.tailY;
  const startX = e.clientX, startY = e.clientY;
  let moved = false;

  function move(ev) {
    const dx = (ev.clientX - startX) / editorScale;
    const dy = (ev.clientY - startY) / editorScale;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;

    content.x = clamp(origX + dx, -content.width * 0.3, panel.width - content.width * 0.7);
    content.y = clamp(origY + dy, -content.height * 0.3, panel.height - content.height * 0.7);
    if (content.type === "dialogue") {
      content.tailX = origTailX + dx;
      content.tailY = origTailY + dy;
    }
    content._unsafe = contentIsUnsafe(panel, content);
    renderEditor();
  }

  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!moved) return;

    if (content._unsafe && safeModeEnabled) {
      content.x = origX;
      content.y = origY;
      content.tailX = origTailX;
      content.tailY = origTailY;
      content._unsafe = false;
      showStatus("Move blocked: overlaps a protected character area or another bubble. Turn off Character Safe Mode to override.", true);
    } else {
      content._unsafe = false;
      markEdited();
    }
    pushHistory();
    renderEditor();
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startDragTail(e, panel, content) {
  const origX = content.tailX, origY = content.tailY;
  trackPointerDrag(e, (dx, dy) => {
    content.tailX = clamp(origX + dx, panel.x, panel.x + panel.width);
    content.tailY = clamp(origY + dy, panel.y, panel.y + panel.height);
    renderEditor();
  });
}

function startResizeDrag(e, corner, onResize) {
  trackPointerDrag(e, (dx, dy) => {
    onResize(dx, dy, corner);
    renderEditor();
  });
}

function resizePanel(panel, dx, dy, corner) {
  const minW = 60, minH = 60;
  if (!panel._resizeOrig) panel._resizeOrig = { x: panel.x, y: panel.y, w: panel.width, h: panel.height };
  const o = panel._resizeOrig;
  let { x, y, width, height } = { x: o.x, y: o.y, width: o.w, height: o.h };

  if (corner.includes("e")) width = Math.max(minW, o.w + dx);
  if (corner.includes("s")) height = Math.max(minH, o.h + dy);
  if (corner.includes("w")) { width = Math.max(minW, o.w - dx); x = o.x + (o.w - width); }
  if (corner.includes("n")) { height = Math.max(minH, o.h - dy); y = o.y + (o.h - height); }

  panel.x = clamp(x, 0, pageState.page.width - width);
  panel.y = clamp(y, 0, pageState.page.height - height);
  panel.width = width;
  panel.height = height;
}

function resizeContent(panel, content, dx, dy, corner) {
  const minW = 40, minH = 30;
  if (!content._resizeOrig) content._resizeOrig = { x: content.x, y: content.y, w: content.width, h: content.height };
  const o = content._resizeOrig;
  let { x, y, width, height } = { x: o.x, y: o.y, width: o.w, height: o.h };

  if (corner.includes("e")) width = Math.max(minW, o.w + dx);
  if (corner.includes("s")) height = Math.max(minH, o.h + dy);
  if (corner.includes("w")) { width = Math.max(minW, o.w - dx); x = o.x + (o.w - width); }
  if (corner.includes("n")) { height = Math.max(minH, o.h - dy); y = o.y + (o.h - height); }

  content.x = x;
  content.y = y;
  content.width = width;
  content.height = height;
}

window.addEventListener("pointerup", () => {
  if (!pageState) return;
  pageState.panels.forEach((p) => {
    delete p._resizeOrig;
    p.contents.forEach((c) => delete c._resizeOrig);
  });
});

function beginInlineTextEdit(contentEl, textEl, panel, content) {
  textEl.contentEditable = "true";
  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finish() {
    textEl.contentEditable = "false";
    content.text = textEl.textContent;
    markEdited();
    pushHistory();
    renderEditor();
  }

  textEl.addEventListener("blur", finish, { once: true });
  textEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
    if (e.key === "Escape") { e.preventDefault(); textEl.blur(); }
  });
}

/* =========================================================
   PROPERTIES PANEL (contextual toolbar)
   ========================================================= */

const propertiesContentEl = document.getElementById("propertiesContent");

function renderPropertiesPanel() {
  propertiesContentEl.innerHTML = "";
  if (!selection) { renderNothingSelectedProps(); return; }
  if (selection.type === "panel") renderPanelProps(findStatePanel(selection.panelId));
  else if (selection.type === "image") renderImageProps(findStatePanel(selection.panelId));
  else if (selection.type === "content") {
    const panel = findStatePanel(selection.panelId);
    const content = findStateContent(selection.panelId, selection.contentId);
    if (!panel || !content) { renderNothingSelectedProps(); return; }
    renderContentProps(panel, content);
  }
}

function propTitle(text) {
  const h = document.createElement("p");
  h.className = "prop-title";
  h.textContent = text;
  return h;
}

function renderNothingSelectedProps() {
  propertiesContentEl.appendChild(propTitle("Page"));
  const p = document.createElement("p");
  p.className = "prop-empty";
  p.textContent = "Click a panel, image, speech bubble, or caption on the page to edit it. Drag the panel handle to move it, or the corner squares to resize.";
  propertiesContentEl.appendChild(p);
}

function makeField(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "prop-group";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function renderPanelProps(panel) {
  if (!panel) return;
  propertiesContentEl.appendChild(propTitle("Panel"));

  if (panel.protectedRegions && panel.protectedRegions.length > 0) {
    const note = document.createElement("p");
    note.className = "prop-warning";
    note.textContent = `${panel.protectedRegions.length} protected character area(s) here. Dialogue/narration avoid them (dashed outline while this panel is selected).`;
    propertiesContentEl.appendChild(note);
  }

  const rowW = document.createElement("input");
  rowW.type = "number";
  rowW.value = Math.round(panel.width);
  rowW.addEventListener("change", () => {
    panel.width = clamp(Number(rowW.value) || panel.width, 60, pageState.page.width);
    markEdited(); pushHistory(); renderEditor();
  });
  const rowH = document.createElement("input");
  rowH.type = "number";
  rowH.value = Math.round(panel.height);
  rowH.addEventListener("change", () => {
    panel.height = clamp(Number(rowH.value) || panel.height, 60, pageState.page.height);
    markEdited(); pushHistory(); renderEditor();
  });
  const dimRow = document.createElement("div");
  dimRow.className = "prop-row";
  dimRow.appendChild(makeField("Width (px)", rowW));
  dimRow.appendChild(makeField("Height (px)", rowH));
  propertiesContentEl.appendChild(dimRow);

  const borderW = document.createElement("input");
  borderW.type = "number";
  borderW.min = 0;
  borderW.value = panel.borderWidth;
  borderW.addEventListener("change", () => {
    panel.borderWidth = Math.max(0, Number(borderW.value) || 0);
    markEdited(); pushHistory(); renderEditor();
  });
  propertiesContentEl.appendChild(makeField("Border Width (px)", borderW));

  const borderColor = document.createElement("input");
  borderColor.type = "color";
  borderColor.value = panel.borderColor;
  borderColor.addEventListener("input", () => { panel.borderColor = borderColor.value; markEdited(); renderEditor(); });
  borderColor.addEventListener("change", () => pushHistory());
  propertiesContentEl.appendChild(makeField("Border Color", borderColor));

  const hr = document.createElement("hr");
  hr.className = "prop-divider";
  propertiesContentEl.appendChild(hr);

  const addRow = document.createElement("div");
  addRow.className = "add-content-row";
  const addDialogue = document.createElement("button");
  addDialogue.className = "btn btn-secondary btn-small";
  addDialogue.textContent = "+ Dialogue";
  addDialogue.addEventListener("click", () => addContentToPanel(panel, "dialogue"));
  const addNarration = document.createElement("button");
  addNarration.className = "btn btn-secondary btn-small";
  addNarration.textContent = "+ Narration";
  addNarration.addEventListener("click", () => addContentToPanel(panel, "narration"));
  addRow.appendChild(addDialogue);
  addRow.appendChild(addNarration);
  propertiesContentEl.appendChild(addRow);

  const hr2 = document.createElement("hr");
  hr2.className = "prop-divider";
  propertiesContentEl.appendChild(hr2);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger btn-block";
  deleteBtn.textContent = "Delete Panel";
  deleteBtn.disabled = pageState.panels.length <= 1;
  deleteBtn.addEventListener("click", () => deletePanel(panel.id));
  propertiesContentEl.appendChild(deleteBtn);
}

function renderImageProps(panel) {
  if (!panel || !panel.image) return;
  propertiesContentEl.appendChild(propTitle("Image"));

  const zoomLabel = document.createElement("label");
  zoomLabel.textContent = `Zoom (${Math.round(panel.image.scale * 100)}%)`;
  const zoom = document.createElement("input");
  zoom.type = "range";
  zoom.min = "0.5"; zoom.max = "3"; zoom.step = "0.01";
  zoom.value = panel.image.scale;
  zoom.addEventListener("input", () => {
    panel.image.scale = Number(zoom.value);
    zoomLabel.textContent = `Zoom (${Math.round(panel.image.scale * 100)}%)`;
    markEdited(); renderEditor();
  });
  zoom.addEventListener("change", () => pushHistory());
  const zoomWrap = document.createElement("div");
  zoomWrap.className = "prop-group";
  zoomWrap.appendChild(zoomLabel);
  zoomWrap.appendChild(zoom);
  propertiesContentEl.appendChild(zoomWrap);

  const p = document.createElement("p");
  p.className = "prop-empty";
  p.textContent = "Drag the image directly on the page to pan it within the panel.";
  propertiesContentEl.appendChild(p);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn btn-outline btn-block";
  resetBtn.textContent = "Reset Image Position";
  resetBtn.addEventListener("click", () => {
    panel.image.scale = 1; panel.image.offsetX = 0; panel.image.offsetY = 0;
    markEdited(); pushHistory(); renderEditor();
  });
  propertiesContentEl.appendChild(resetBtn);
}

const DIALOGUE_SHAPES = [
  { id: "round", label: "Round" },
  { id: "oval", label: "Oval" },
  { id: "cloud", label: "Cloud" },
  { id: "rounded", label: "Rounded" },
  { id: "jagged", label: "Jagged" },
  { id: "burst", label: "Burst/Shout" },
  { id: "whisper", label: "Whisper" },
  { id: "thought", label: "Thought" }
];

const NARRATION_PRESETS = [
  { label: "Cream", value: "#fdf3d0" },
  { label: "Yellow", value: "#fbe98a" },
  { label: "White", value: "#ffffff" }
];

function renderContentProps(panel, content) {
  propertiesContentEl.appendChild(propTitle(content.type === "dialogue" ? "Dialogue" : "Narration"));

  if (content._unsafe) {
    const warn = document.createElement("p");
    warn.className = "prop-warning";
    warn.textContent = "This currently overlaps a protected character area or another bubble.";
    propertiesContentEl.appendChild(warn);
  }

  const typeSelect = document.createElement("select");
  [["dialogue", "Dialogue"], ["narration", "Narration"]].forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    if (content.type === val) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => convertContentType(panel, content, typeSelect.value));
  propertiesContentEl.appendChild(makeField("Content Type", typeSelect));

  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.value = content.text;
  textarea.addEventListener("input", () => { content.text = textarea.value; markEdited(); renderEditor(); });
  textarea.addEventListener("change", () => pushHistory());
  propertiesContentEl.appendChild(makeField("Text", textarea));

  if (content.type === "dialogue") {
    const shapeWrap = document.createElement("div");
    shapeWrap.className = "shape-options";
    DIALOGUE_SHAPES.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shape-option" + (content.style.shape === s.id ? " active" : "");
      btn.textContent = s.label;
      btn.addEventListener("click", () => { content.style.shape = s.id; markEdited(); pushHistory(); renderEditor(); });
      shapeWrap.appendChild(btn);
    });
    propertiesContentEl.appendChild(makeField("Bubble Shape", shapeWrap));
  } else {
    const presetWrap = document.createElement("div");
    presetWrap.className = "shape-options";
    NARRATION_PRESETS.forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shape-option" + (content.style.fill === preset.value ? " active" : "");
      btn.textContent = preset.label;
      btn.addEventListener("click", () => { content.style.fill = preset.value; markEdited(); pushHistory(); renderEditor(); });
      presetWrap.appendChild(btn);
    });
    propertiesContentEl.appendChild(makeField("Background Presets", presetWrap));
    propertiesContentEl.appendChild(numberField("Corner Radius", content.style.cornerRadius, 0, 60, (v) => (content.style.cornerRadius = v)));
  }

  propertiesContentEl.appendChild(colorField("Fill / Background", content.style.fill, (v) => (content.style.fill = v)));
  propertiesContentEl.appendChild(colorField("Border Color", content.style.borderColor, (v) => (content.style.borderColor = v)));
  propertiesContentEl.appendChild(numberField("Border Width", content.style.borderWidth, 0, 20, (v) => (content.style.borderWidth = v)));
  propertiesContentEl.appendChild(colorField("Text Color", content.style.color, (v) => (content.style.color = v)));

  // Font controls mirror the source panel's system: a global default that
  // cascades to inherited elements, with an explicit per-element override.
  const fontRow = document.createElement("div");
  fontRow.className = "prop-row";
  const fontSelect = document.createElement("select");
  FONT_OPTIONS.forEach(([val, lbl]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = lbl;
    if (content.style.font === val) opt.selected = true;
    fontSelect.appendChild(opt);
  });
  fontSelect.addEventListener("change", () => {
    content.style.font = fontSelect.value;
    content.style.fontInherited = false;
    markEdited(); pushHistory(); renderEditor();
  });
  const sizeSelect = document.createElement("select");
  [6, 7, 8, 9, 10, 11, 12, 14, 16].forEach((sz) => {
    const opt = document.createElement("option");
    opt.value = String(sz); opt.textContent = sz + " pt";
    if (Number(content.style.fontSizePt) === sz) opt.selected = true;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.addEventListener("change", () => {
    content.style.fontSizePt = Number(sizeSelect.value);
    content.style.fontInherited = false;
    markEdited(); pushHistory(); renderEditor();
  });
  fontRow.appendChild(makeField("Font", fontSelect));
  fontRow.appendChild(makeField("Size", sizeSelect));
  propertiesContentEl.appendChild(fontRow);

  const fontNote = document.createElement("p");
  fontNote.className = "prop-empty";
  fontNote.style.margin = "-6px 0 10px";
  fontNote.textContent = content.style.fontInherited ? "Using the page default font/size." : "Custom font for this element.";
  propertiesContentEl.appendChild(fontNote);
  if (!content.style.fontInherited) {
    const useDefaultBtn = document.createElement("button");
    useDefaultBtn.className = "btn btn-outline btn-small btn-block";
    useDefaultBtn.style.marginBottom = "10px";
    useDefaultBtn.textContent = "Use Default Font";
    useDefaultBtn.addEventListener("click", () => {
      content.style.font = appState.settings.defaultFont;
      content.style.fontSizePt = appState.settings.defaultFontSize;
      content.style.fontInherited = true;
      markEdited(); pushHistory(); renderEditor();
    });
    propertiesContentEl.appendChild(useDefaultBtn);
  }

  const alignSelect = document.createElement("select");
  ["left", "center", "right"].forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a; opt.textContent = a[0].toUpperCase() + a.slice(1);
    if (content.style.align === a) opt.selected = true;
    alignSelect.appendChild(opt);
  });
  alignSelect.addEventListener("change", () => { content.style.align = alignSelect.value; markEdited(); pushHistory(); renderEditor(); });
  propertiesContentEl.appendChild(makeField("Text Align", alignSelect));

  if (content.type === "dialogue" && content.style.shape !== "thought") {
    const p = document.createElement("p");
    p.className = "prop-empty";
    p.textContent = "Drag the small dot below the bubble to point the tail at the speaking character.";
    propertiesContentEl.appendChild(p);
  } else if (content.type === "dialogue" && content.style.shape === "thought") {
    const p = document.createElement("p");
    p.className = "prop-empty";
    p.textContent = "Thought bubbles trail small circles instead of a tail \u2014 drag the bubble to reposition them.";
    propertiesContentEl.appendChild(p);
  }

  const duplicateBtn = document.createElement("button");
  duplicateBtn.className = "btn btn-outline btn-block";
  duplicateBtn.style.marginBottom = "8px";
  duplicateBtn.textContent = "Duplicate";
  duplicateBtn.addEventListener("click", () => duplicateStateContent(panel, content));
  propertiesContentEl.appendChild(duplicateBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger btn-block";
  deleteBtn.textContent = content.type === "dialogue" ? "Delete Dialogue" : "Delete Narration";
  deleteBtn.addEventListener("click", () => deleteContent(panel, content.id));
  propertiesContentEl.appendChild(deleteBtn);
}

function convertContentType(panel, content, newType) {
  if (content.type === newType) return;
  content.type = newType;
  const font = content.style.font, fontSizePt = content.style.fontSizePt, fontInherited = content.style.fontInherited;
  const preservedColor = content.style.fill;
  if (newType === "dialogue") {
    content.style = defaultDialogueStyle("round", font, fontSizePt, fontInherited);
    if (content.tailX == null || content.tailY == null) {
      content.tailX = content.x + content.width * 0.3;
      content.tailY = content.y + content.height + 40;
    }
  } else {
    content.style = defaultNarrationStyle("rectangle", preservedColor === "#ffffff" ? "#fdf3d0" : preservedColor, font, fontSizePt, fontInherited);
  }
  markEdited(); pushHistory(); renderEditor();
}

function colorField(label, value, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.addEventListener("input", () => { onChange(input.value); markEdited(); renderEditor(); });
  input.addEventListener("change", () => pushHistory());
  return makeField(label, input);
}

function numberField(label, value, min, max, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min); input.max = String(max);
  input.value = value;
  input.addEventListener("change", () => {
    onChange(clamp(Number(input.value) || 0, min, max));
    markEdited(); pushHistory(); renderEditor();
  });
  return makeField(label, input);
}

function findSafeSpotInStatePanel(panel, boxW, boxH) {
  const frame = { width: panel.width, height: panel.height };
  const candidates = buildPlacementCandidates(frame, boxW, boxH);
  const regions = panel.protectedRegions || [];
  const occupied = panel.contents.map((c) => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height }));

  let safe = candidates.filter(
    (c) => !rectOverlapsProtectedRegions(panel, regions, c.x, c.y, boxW, boxH) && !rectOverlapsOccupied(occupied, c.x, c.y, boxW, boxH)
  );
  if (safe.length === 0) safe = candidates.filter((c) => !rectOverlapsOccupied(occupied, c.x, c.y, boxW, boxH));
  if (safe.length === 0) safe = candidates;

  const grid = panel.image && panel.image._loadedImg ? getComplexityGridForPanelImage(panel.image) : null;
  let best = safe[0];
  let bestScore = Infinity;
  safe.forEach((c) => {
    let score = ["top-left", "top-center", "top-right"].includes(c.name) ? -0.001 : 0;
    if (grid) {
      const frac = panelRectToImageFraction(panel, c.x, c.y, boxW, boxH);
      if (frac) score += regionBusyness(grid, frac.fx0, frac.fy0, frac.fx1, frac.fy1);
    }
    if (score < bestScore) { bestScore = score; best = c; }
  });
  return { x: best.x, y: best.y };
}

function addContentToPanel(panel, type) {
  const width = panel.width * 0.5;
  const height = type === "dialogue" ? panel.height * 0.24 : panel.height * 0.16;
  const placement = findSafeSpotInStatePanel(panel, width, height);

  const content = {
    id: generateUniqueId("content"),
    type,
    text: type === "dialogue" ? "New dialogue" : "New narration",
    x: placement.x, y: placement.y, width, height,
    style:
      type === "dialogue"
        ? defaultDialogueStyle("round", appState.settings.defaultFont, appState.settings.defaultFontSize, true)
        : defaultNarrationStyle("rectangle", "#fdf3d0", appState.settings.defaultFont, appState.settings.defaultFontSize, true),
    zIndex: panel.contents.length + 1
  };
  if (type === "dialogue") {
    content.tailX = placement.x + width * 0.3;
    content.tailY = placement.y + height + 40;
  }
  panel.contents.push(content);
  selection = { type: "content", panelId: panel.id, contentId: content.id };
  markEdited(); pushHistory(); renderEditor();
}

function duplicateStateContent(panel, content) {
  const copy = JSON.parse(JSON.stringify(content));
  copy.id = generateUniqueId("content");
  copy.x = clamp(content.x + 24, 0, panel.width - content.width);
  copy.y = clamp(content.y + 24, 0, panel.height - content.height);
  if (copy.type === "dialogue") {
    copy.tailX = content.tailX + 24;
    copy.tailY = content.tailY + 24;
  }
  copy.zIndex = panel.contents.length + 1;
  panel.contents.push(copy);
  selection = { type: "content", panelId: panel.id, contentId: copy.id };
  markEdited(); pushHistory(); renderEditor();
}

function deleteContent(panel, contentId) {
  panel.contents = panel.contents.filter((c) => c.id !== contentId);
  selection = { type: "panel", panelId: panel.id, contentId: null };
  markEdited(); pushHistory(); renderEditor();
}

function deletePanel(panelId) {
  if (pageState.panels.length <= 1) return;
  pageState.panels = pageState.panels.filter((p) => p.id !== panelId);
  selection = null;
  markEdited(); pushHistory(); renderEditor();
}

/* =========================================================
   TEXT WRAPPING / FITTING
   ========================================================= */

function wrapText(ctx, text, maxWidth) {
  const paragraphs = text.split("\n");
  const lines = [];
  paragraphs.forEach((para) => {
    if (para === "") { lines.push(""); return; }
    const words = para.split(" ");
    let current = "";
    words.forEach((word) => {
      const test = current ? current + " " + word : word;
      if (ctx.measureText(test).width <= maxWidth || current === "") current = test;
      else { lines.push(current); current = word; }
    });
    if (current) lines.push(current);
  });
  return lines;
}

// Starts from the requested (pt-derived) size and shrinks only as far as
// needed to avoid clipping — the point size is a preference, not a promise
// to overflow the bubble.
function fitTextToBox(ctx, text, maxWidth, maxHeight, preferredFontSizePx) {
  let fontSize = preferredFontSizePx || Math.max(14, Math.floor(maxHeight * 0.18));
  const minFontSize = 8;
  let lines, lineHeight;
  while (fontSize >= minFontSize) {
    ctx.font = `${fontSize}px Arial, sans-serif`;
    lines = wrapText(ctx, text, maxWidth * 0.92);
    lineHeight = fontSize * 1.3;
    if (lines.length * lineHeight <= maxHeight * 0.9) break;
    fontSize -= 1;
  }
  return { fontSize: Math.max(fontSize, minFontSize), lines, lineHeight };
}

/* =========================================================
   CANVAS EXPORT RENDERER — reads pageState only
   ========================================================= */

function drawDialogueShapePath(ctx, x, y, w, h, shape) {
  ctx.beginPath();
  if (shape === "oval") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === "cloud" || shape === "thought") {
    const bumps = 8;
    const cx = x + w / 2, cy = y + h / 2;
    for (let i = 0; i <= bumps; i++) {
      const angle = (i / bumps) * Math.PI * 2;
      const rx = (w / 2) * (0.9 + 0.1 * Math.sin(i * 2.3));
      const ry = (h / 2) * (0.9 + 0.1 * Math.cos(i * 1.7));
      const px = cx + Math.cos(angle) * rx;
      const py = cy + Math.sin(angle) * ry;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === "jagged" || shape === "burst") {
    const spikes = shape === "burst" ? 11 : 13;
    const cx = x + w / 2, cy = y + h / 2;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * (shape === "burst" ? 0.62 : 0.82);
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const px = cx + Math.cos(angle) * r * (w / (2 * outerR));
      const py = cy + Math.sin(angle) * r * (h / (2 * outerR));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    const r = shape === "rounded" || shape === "whisper" ? Math.min(w, h) * 0.14 : Math.min(w, h) * 0.28;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

function drawThoughtDots(ctx, x, y, w, h, tailX, tailY) {
  const startX = x + w * 0.25, startY = y + h;
  const sizes = [14, 10, 6];
  for (let i = 0; i < sizes.length; i++) {
    const t = (i + 1) / (sizes.length + 1);
    const cx = startX + (tailX - startX) * t;
    const cy = startY + (tailY - startY) * t;
    ctx.beginPath();
    ctx.arc(cx, cy, sizes[i] / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000000";
    ctx.stroke();
  }
}

function drawDialogueContent(ctx, panelX, panelY, content) {
  const x = panelX + content.x, y = panelY + content.y, w = content.width, h = content.height;
  const style = content.style;
  const tailX = panelX + content.tailX, tailY = panelY + content.tailY;

  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;

  if (style.shape === "thought") {
    drawDialogueShapePath(ctx, x, y, w, h, style.shape);
    ctx.fillStyle = style.fill;
    ctx.fill();
    if (style.borderWidth > 0) { ctx.lineWidth = style.borderWidth; ctx.strokeStyle = style.borderColor; ctx.stroke(); }
    ctx.restore();
    drawThoughtDots(ctx, x, y, w, h, tailX, tailY);
  } else {
    const baseX = clamp(tailX, x + w * 0.15, x + w * 0.55);
    const baseY = y + h;
    ctx.beginPath();
    ctx.moveTo(baseX - w * 0.06, baseY - 2);
    ctx.lineTo(tailX, tailY);
    ctx.lineTo(baseX + w * 0.1, baseY - 2);
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    if (style.shape === "whisper") ctx.setLineDash([6, 5]);
    ctx.lineWidth = style.borderWidth;
    ctx.strokeStyle = style.borderColor;
    if (style.borderWidth > 0) ctx.stroke();
    ctx.setLineDash([]);

    drawDialogueShapePath(ctx, x, y, w, h, style.shape);
    ctx.fillStyle = style.fill;
    ctx.fill();
    if (style.borderWidth > 0) {
      if (style.shape === "whisper") ctx.setLineDash([6, 5]);
      ctx.lineWidth = style.borderWidth;
      ctx.strokeStyle = style.borderColor;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawContentText(ctx, x, y, w, h, content);
}

function drawNarrationContent(ctx, panelX, panelY, content) {
  const x = panelX + content.x, y = panelY + content.y, w = content.width, h = content.height;
  const style = content.style;

  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  const r = clamp(style.cornerRadius, 0, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (style.borderWidth > 0) { ctx.lineWidth = style.borderWidth; ctx.strokeStyle = style.borderColor; ctx.stroke(); }
  ctx.restore();

  drawContentText(ctx, x, y, w, h, content);
}

function drawContentText(ctx, x, y, w, h, content) {
  const style = content.style;
  const padding = w * 0.08;
  const textMaxWidth = w - padding * 2;
  const textMaxHeight = h - padding * 2;
  if (!content.text || !content.text.trim()) return;

  const preferredPx = ptToPx(style.fontSizePt);
  const { fontSize, lines, lineHeight } = fitTextToBox(ctx, content.text, textMaxWidth, textMaxHeight, preferredPx);

  ctx.save();
  ctx.font = `${fontSize}px ${style.font || "Arial"}, sans-serif`;
  ctx.fillStyle = style.color || "#000000";
  ctx.textAlign = style.align || "center";
  ctx.textBaseline = "middle";

  const totalTextHeight = lines.length * lineHeight;
  let ty = y + h / 2 - totalTextHeight / 2 + lineHeight / 2;
  let tx = x + w / 2;
  if (style.align === "left") tx = x + padding;
  if (style.align === "right") tx = x + w - padding;

  lines.forEach((line) => { ctx.fillText(line, tx, ty, textMaxWidth); ty += lineHeight; });
  ctx.restore();
}

function drawPanelImage(ctx, panel) {
  const imgEl = panel.image._loadedImg;
  if (!imgEl) return;
  const coverScale = computeCoverFit(panel.image.naturalWidth, panel.image.naturalHeight, panel.width, panel.height);
  const finalScale = coverScale * panel.image.scale;
  const drawW = panel.image.naturalWidth * finalScale;
  const drawH = panel.image.naturalHeight * finalScale;
  const centerX = panel.x + panel.width / 2 + panel.image.offsetX;
  const centerY = panel.y + panel.height / 2 + panel.image.offsetY;
  const left = centerX - drawW / 2;
  const top = centerY - drawH / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imgEl, left, top, drawW, drawH);
}

function drawStatePanel(ctx, panel) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(panel.x, panel.y, panel.width, panel.height);
  ctx.clip();

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);

  if (panel.image) drawPanelImage(ctx, panel);

  panel.contents
    .slice()
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    .forEach((content) => {
      if (content.type === "dialogue") drawDialogueContent(ctx, panel.x, panel.y, content);
      else drawNarrationContent(ctx, panel.x, panel.y, content);
    });

  ctx.restore();

  if (panel.borderWidth > 0) {
    ctx.save();
    ctx.lineWidth = panel.borderWidth;
    ctx.strokeStyle = panel.borderColor;
    ctx.strokeRect(panel.x + panel.borderWidth / 2, panel.y + panel.borderWidth / 2, panel.width - panel.borderWidth, panel.height - panel.borderWidth);
    ctx.restore();
  }
}

function renderPageStateToCanvas(canvas, state) {
  canvas.width = state.page.width;
  canvas.height = state.page.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = state.page.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  state.panels.forEach((panel) => drawStatePanel(ctx, panel));
}

function preloadStateImages(state) {
  const jobs = state.panels
    .filter((p) => p.image && p.image.src)
    .map(
      (p) =>
        new Promise((resolve) => {
          if (p.image._loadedImg) { resolve(); return; }
          const img = new Image();
          img.onload = () => { p.image._loadedImg = img; resolve(); };
          img.onerror = () => resolve();
          img.src = p.image.src;
        })
    );
  return Promise.all(jobs);
}

/* =========================================================
   EXPORT
   ========================================================= */

async function exportImage(format) {
  if (!pageState || pageState.panels.length === 0) {
    showStatus("Generate a comic page before exporting.", true);
    return;
  }
  showStatus("Rendering\u2026");
  await preloadStateImages(pageState);

  const exportCanvas = document.getElementById("exportCanvas");
  renderPageStateToCanvas(exportCanvas, pageState);

  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = format === "jpeg" ? 0.95 : undefined;

  exportCanvas.toBlob(
    (blob) => {
      if (!blob) { showStatus("Export failed. Please try again.", true); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comic-page-01.${format === "jpeg" ? "jpg" : "png"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showStatus("Export complete \u2014 this reflects your edited page exactly.");
    },
    mime,
    quality
  );
}

/* =========================================================
   MANUAL / ASSISTED DRAWING
   A stroke-based canvas tool. Every pencil/brush/eraser stroke and
   every assisted shape (line/rectangle/ellipse) is stored as its
   own object, so Undo/Redo removes exactly one operation at a time
   rather than resetting the whole drawing. "Apply" rasterizes the
   canvas to a PNG and feeds it through the normal image-upload
   pipeline, so a drawing becomes an ordinary panel image afterward.
   ========================================================= */

const drawState = {
  panelId: null,
  tool: "pencil",
  color: "#1c1b1a",
  size: 4,
  bgColor: "#ffffff",
  strokes: [],
  redoStack: [],
  activeStroke: null
};

const drawModalEl = document.getElementById("drawModal");
const drawCanvasEl = document.getElementById("drawCanvas");
const drawCtx = drawCanvasEl.getContext("2d");

function openDrawModal(panelId) {
  drawState.panelId = panelId;
  drawState.strokes = [];
  drawState.redoStack = [];
  drawState.activeStroke = null;
  drawState.tool = "pencil";
  drawState.color = "#1c1b1a";
  drawState.size = 4;
  drawState.bgColor = "#ffffff";

  document.getElementById("drawColor").value = drawState.color;
  document.getElementById("drawSize").value = String(drawState.size);
  document.getElementById("drawSizeLabel").textContent = `Size (${drawState.size}px)`;
  document.getElementById("drawBgColor").value = drawState.bgColor;
  document.querySelectorAll(".draw-tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === "pencil"));

  redrawDrawCanvas();
  updateDrawUndoRedoButtons();

  // FIX 10: if a previous Apply click left the button disabled (e.g. while
  // toBlob() was still running), a fresh drawing session must start usable.
  const applyBtn = document.getElementById("drawApplyBtn");
  if (applyBtn) applyBtn.disabled = false;

  drawModalEl.hidden = false;
}

function closeDrawModal() {
  drawModalEl.hidden = true;
}

function updateDrawUndoRedoButtons() {
  document.getElementById("drawUndoBtn").disabled = drawState.strokes.length === 0;
  document.getElementById("drawRedoBtn").disabled = drawState.redoStack.length === 0;
}

function redrawDrawCanvas() {
  drawCtx.fillStyle = drawState.bgColor;
  drawCtx.fillRect(0, 0, drawCanvasEl.width, drawCanvasEl.height);
  drawState.strokes.forEach((s) => paintStroke(drawCtx, s));
  if (drawState.activeStroke) paintStroke(drawCtx, drawState.activeStroke);
}

function paintStroke(ctx, stroke) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const isEraser = stroke.tool === "eraser";
  ctx.strokeStyle = isEraser ? drawState.bgColor : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.size;

  if (stroke.tool === "pencil" || stroke.tool === "brush" || stroke.tool === "eraser") {
    if (!stroke.points || stroke.points.length === 0) { ctx.restore(); return; }
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = stroke.tool === "brush" ? (stroke.opacity ?? 1) : 1;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();
    }
  } else if (stroke.tool === "line") {
    ctx.beginPath();
    ctx.moveTo(stroke.x0, stroke.y0);
    ctx.lineTo(stroke.x1, stroke.y1);
    ctx.stroke();
  } else if (stroke.tool === "rect") {
    const x = Math.min(stroke.x0, stroke.x1), y = Math.min(stroke.y0, stroke.y1);
    const w = Math.abs(stroke.x1 - stroke.x0), h = Math.abs(stroke.y1 - stroke.y0);
    ctx.strokeRect(x, y, w, h);
  } else if (stroke.tool === "ellipse") {
    const cx = (stroke.x0 + stroke.x1) / 2, cy = (stroke.y0 + stroke.y1) / 2;
    const rx = Math.abs(stroke.x1 - stroke.x0) / 2, ry = Math.abs(stroke.y1 - stroke.y0) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanvasPoint(e) {
  const rect = drawCanvasEl.getBoundingClientRect();
  const scaleX = drawCanvasEl.width / rect.width;
  const scaleY = drawCanvasEl.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function bindDrawCanvasEvents() {
  drawCanvasEl.addEventListener("pointerdown", (e) => {
    const pt = drawCanvasPoint(e);
    const tool = drawState.tool;
    if (tool === "pencil" || tool === "brush" || tool === "eraser") {
      drawState.activeStroke = { tool, color: drawState.color, size: tool === "eraser" ? drawState.size * 1.6 : drawState.size, opacity: tool === "brush" ? 0.85 : 1, points: [pt] };
    } else {
      drawState.activeStroke = { tool, color: drawState.color, size: drawState.size, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    }
    const pointerId = e.pointerId;
    drawCanvasEl.setPointerCapture(pointerId);

    function move(ev) {
      const p = drawCanvasPoint(ev);
      if (!drawState.activeStroke) return;
      if (drawState.activeStroke.points) drawState.activeStroke.points.push(p);
      else { drawState.activeStroke.x1 = p.x; drawState.activeStroke.y1 = p.y; }
      redrawDrawCanvas();
    }
    function finish() {
      drawCanvasEl.removeEventListener("pointermove", move);
      drawCanvasEl.removeEventListener("pointerup", finish);
      drawCanvasEl.removeEventListener("pointercancel", finish);
      // BUGFIX: pointer capture must be released explicitly. Left uncaptured,
      // some browsers (notably Safari) keep routing pointer events to the
      // canvas afterward, which makes buttons elsewhere in the modal (like
      // Cancel/Apply) stop receiving clicks until the page is reloaded.
      try {
        if (drawCanvasEl.hasPointerCapture && drawCanvasEl.hasPointerCapture(pointerId)) {
          drawCanvasEl.releasePointerCapture(pointerId);
        }
      } catch (err) { /* no-op — capture may already be gone */ }

      if (drawState.activeStroke) {
        drawState.strokes.push(drawState.activeStroke);
        drawState.redoStack = [];
        drawState.activeStroke = null;
        updateDrawUndoRedoButtons();
        redrawDrawCanvas();
      }
    }
    drawCanvasEl.addEventListener("pointermove", move);
    drawCanvasEl.addEventListener("pointerup", finish);
    drawCanvasEl.addEventListener("pointercancel", finish);
  });
}

function drawUndo() {
  if (drawState.strokes.length === 0) return;
  drawState.redoStack.push(drawState.strokes.pop());
  redrawDrawCanvas();
  updateDrawUndoRedoButtons();
}

function drawRedo() {
  if (drawState.redoStack.length === 0) return;
  drawState.strokes.push(drawState.redoStack.pop());
  redrawDrawCanvas();
  updateDrawUndoRedoButtons();
}

function drawClear() {
  if (drawState.strokes.length === 0) return;
  const ok = window.confirm("Clear all drawing strokes?");
  if (!ok) return;
  drawState.strokes = [];
  drawState.redoStack = [];
  redrawDrawCanvas();
  updateDrawUndoRedoButtons();
}

function applyDrawing() {
  if (!drawState.panelId) return;

  const applyBtn = document.getElementById("drawApplyBtn");
  // FIX 5: disable immediately so a rapid double-click can't fire toBlob()
  // twice and upload two images.
  if (applyBtn) applyBtn.disabled = true;

  drawCanvasEl.toBlob((blob) => {
    if (!blob) {
      showStatus("Could not save the drawing. Please try again.", true);
      if (applyBtn) applyBtn.disabled = false; // re-enable so the user can retry
      return;
    }
    const file = new File([blob], `drawing-${Date.now()}.png`, { type: "image/png" });
    handleImageUpload(drawState.panelId, file); // existing image pipeline — unchanged
    closeDrawModal(); // only close once the upload has actually been handed off
  }, "image/png");
}

function bindDrawModal() {
  bindDrawCanvasEvents();

  document.getElementById("drawColor").addEventListener("input", (e) => (drawState.color = e.target.value));
  document.getElementById("drawSize").addEventListener("input", (e) => {
    drawState.size = Number(e.target.value);
    document.getElementById("drawSizeLabel").textContent = `Size (${drawState.size}px)`;
  });
  document.getElementById("drawBgColor").addEventListener("input", (e) => {
    drawState.bgColor = e.target.value;
    redrawDrawCanvas();
  });

  // FIX 7/9: a single, robust delegated click handler for the whole modal.
  // Backdrop click (target is the modal's own background) closes it;
  // any button inside the modal card is routed and the event is stopped
  // from bubbling to any parent handler or triggering a default action
  // (form submit / navigation) — this is what made Cancel/Apply unreliable.
  drawModalEl.addEventListener("click", (e) => {
    if (e.target === drawModalEl) {
      closeDrawModal();
      return;
    }

    const btn = e.target.closest("button");
    if (!btn || !drawModalEl.contains(btn)) return;

    e.preventDefault();
    e.stopPropagation();

    if (btn.id === "drawCloseBtn") { closeDrawModal(); return; }
    if (btn.id === "drawApplyBtn") { applyDrawing(); return; }
    if (btn.id === "drawUndoBtn") { drawUndo(); return; }
    if (btn.id === "drawRedoBtn") { drawRedo(); return; }
    if (btn.id === "drawClearBtn") { drawClear(); return; }
    if (btn.classList.contains("draw-tool-btn")) {
      document.querySelectorAll(".draw-tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      drawState.tool = btn.dataset.tool;
    }
  });
}

/* =========================================================
   SETTINGS BINDING
   ========================================================= */

function bindSettings() {
  const pageSizeSelect = document.getElementById("settingPageSize");
  const customSizeRow = document.getElementById("customSizeRow");
  const customWidth = document.getElementById("customWidth");
  const customHeight = document.getElementById("customHeight");
  const customUnit = document.getElementById("customUnit");

  function syncCustomVisibility() { customSizeRow.hidden = pageSizeSelect.value !== "custom"; }

  pageSizeSelect.addEventListener("change", (e) => {
    appState.settings.pageSize = e.target.value;
    syncCustomVisibility();
    updateSelectedSizeInfo();
  });
  customWidth.addEventListener("input", () => { appState.settings.customWidth = Number(customWidth.value); updateSelectedSizeInfo(); });
  customHeight.addEventListener("input", () => { appState.settings.customHeight = Number(customHeight.value); updateSelectedSizeInfo(); });
  customUnit.addEventListener("change", () => { appState.settings.customUnit = customUnit.value; updateSelectedSizeInfo(); });

  document.getElementById("settingOrientation").addEventListener("change", (e) => {
    appState.settings.orientation = e.target.value;
    updateSelectedSizeInfo();
  });
  document.getElementById("settingLayoutStyle").addEventListener("change", (e) => (appState.settings.layoutStyle = e.target.value));
  document.getElementById("settingBorderStyle").addEventListener("change", (e) => (appState.settings.borderStyle = e.target.value));

  // ---- Background color, including the Custom-color bug fix ----
  const bgSelect = document.getElementById("settingBackground");
  const customBgWrap = document.getElementById("customBgWrap");
  const customBgInput = document.getElementById("settingCustomBg");

  bgSelect.addEventListener("change", (e) => {
    appState.settings.background = e.target.value;
    customBgWrap.hidden = e.target.value !== "custom";
    if (e.target.value === "custom") {
      // BUGFIX: make sure state is synced to whatever the swatch is
      // currently showing the instant Custom is chosen, not only after
      // the user separately interacts with the color input.
      appState.settings.customBg = customBgInput.value;
    }
  });
  // Both 'input' (live drag feedback) and 'change' (final commit, which is
  // what some OS color dialogs fire instead of continuous 'input') are
  // bound so the custom color reliably reaches state on every platform.
  function syncCustomBg(e) { appState.settings.customBg = e.target.value; }
  customBgInput.addEventListener("input", syncCustomBg);
  customBgInput.addEventListener("change", syncCustomBg);

  // ---- Global font defaults ----
  const defaultFontSelect = document.getElementById("settingDefaultFont");
  const defaultFontSizeSelect = document.getElementById("settingDefaultFontSize");
  defaultFontSelect.addEventListener("change", () => {
    applyGlobalFontDefaults(defaultFontSelect.value, appState.settings.defaultFontSize);
  });
  defaultFontSizeSelect.addEventListener("change", () => {
    applyGlobalFontDefaults(appState.settings.defaultFont, Number(defaultFontSizeSelect.value));
  });

  syncCustomVisibility();
  updateSelectedSizeInfo();
}

/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || el.isContentEditable;
}

function nudgeSelection(dx, dy) {
  if (!selection) return;
  const panel = findStatePanel(selection.panelId);
  if (!panel) return;

  if (selection.type === "panel") {
    panel.x = clamp(panel.x + dx, 0, pageState.page.width - panel.width);
    panel.y = clamp(panel.y + dy, 0, pageState.page.height - panel.height);
  } else if (selection.type === "image" && panel.image) {
    panel.image.offsetX += dx;
    panel.image.offsetY += dy;
  } else if (selection.type === "content") {
    const content = findStateContent(selection.panelId, selection.contentId);
    if (!content) return;
    const testX = content.x + dx, testY = content.y + dy;
    const testRect = { ...content, x: testX, y: testY };
    const unsafe = contentIsUnsafe(panel, testRect);
    if (unsafe && safeModeEnabled) {
      showStatus("Move blocked: overlaps a protected character area or another bubble.", true);
      return;
    }
    content.x = testX; content.y = testY;
    if (content.type === "dialogue") { content.tailX += dx; content.tailY += dy; }
  }
  markEdited();
  renderEditor();
}

document.addEventListener("keydown", (e) => {
  if (isTypingTarget(document.activeElement)) return;
  if (!drawModalEl.hidden) return;
  if (!pageState) return;

  const step = e.shiftKey ? 20 : 4;

  if (e.key === "ArrowLeft") { e.preventDefault(); nudgeSelection(-step, 0); }
  else if (e.key === "ArrowRight") { e.preventDefault(); nudgeSelection(step, 0); }
  else if (e.key === "ArrowUp") { e.preventDefault(); nudgeSelection(0, -step); }
  else if (e.key === "ArrowDown") { e.preventDefault(); nudgeSelection(0, step); }
  else if (e.key === "Delete" || e.key === "Backspace") {
    if (selection && selection.type === "content") {
      e.preventDefault();
      const panel = findStatePanel(selection.panelId);
      if (panel) deleteContent(panel, selection.contentId);
    }
  } else if (e.key === "Escape") {
    deselect();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  } else {
    return;
  }
  if (e.key.startsWith("Arrow")) pushHistory();
});

/* =========================================================
   INITIALIZATION
   ========================================================= */

function init() {
  for (let i = 0; i < 5; i++) appState.panels.push(createPanel());
  normalizeOrder();
  renderPanelList();
  updateAddPanelState();
  bindSettings();
  bindDrawModal();
  setModeIndicator("none");

  document.getElementById("addPanelBtn").addEventListener("click", addPanel);
  document.getElementById("generateBtn").addEventListener("click", requestGenerate);
  document.getElementById("exportPngBtn").addEventListener("click", () => exportImage("png"));
  document.getElementById("exportJpgBtn").addEventListener("click", () => exportImage("jpeg"));
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("redoBtn").addEventListener("click", redo);
  document.getElementById("resetLayoutBtn").addEventListener("click", resetLayoutToAuto);
  document.getElementById("editorZoom").addEventListener("change", (e) => {
    editorScale = Number(e.target.value);
    if (pageState) renderEditor();
  });
  document.getElementById("safeModeToggle").addEventListener("change", (e) => { safeModeEnabled = e.target.checked; });
}

document.addEventListener("DOMContentLoaded", init);
