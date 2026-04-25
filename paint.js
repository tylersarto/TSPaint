/* ============================================
   THEME TOGGLE
============================================ */
(function () {
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }

  document.querySelectorAll('.nav-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(!document.documentElement.classList.contains('dark'));
    });
  });
})();

/* ============================================
   TSPAINT — Illustrator & Designer modes
============================================ */
(function () {
  const canvas = document.getElementById('paintCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const canvasArea = canvas.parentElement;

  const isDark = () => document.documentElement.classList.contains('dark');
  const bgColor = () => isDark() ? '#1a1a18' : '#ffffff';

  /* ── Shared state ── */
  let activeMode = 'illustrator'; // 'illustrator' | 'designer'

  /* ──────────────────────────────────────────
     RESIZE
  ────────────────────────────────────────── */
  function resizeCanvas() {
    const topbar  = document.getElementById('tspTopbar');
    const toolbar = activeMode === 'illustrator'
      ? document.getElementById('paintToolbar')
      : document.getElementById('designerToolbar');
    const w = canvasArea.clientWidth;
    const h = canvasArea.clientHeight - topbar.offsetHeight - toolbar.offsetHeight;

    if (activeMode === 'illustrator') {
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width  = w;
      canvas.height = h;
      ctx.fillStyle = bgColor();
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(tmp, 0, 0);
    } else {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      renderDesigner();
    }
  }

  window.addEventListener('resize', resizeCanvas);

  /* ──────────────────────────────────────────
     MODE INDICATOR (animate-ui spring slide)
  ────────────────────────────────────────── */
  const modeIndicator  = document.getElementById('tspModeIndicator');
  const modeSwitcherEl = document.getElementById('tspModeSwitcher');

  function updateModeIndicator() {
    const activeBtn = modeSwitcherEl.querySelector('.tsp-mode-btn.is-active');
    if (!activeBtn) return;
    const sr = modeSwitcherEl.getBoundingClientRect();
    const br = activeBtn.getBoundingClientRect();
    modeIndicator.style.top    = (br.top    - sr.top)  + 'px';
    modeIndicator.style.left   = (br.left   - sr.left) + 'px';
    modeIndicator.style.width  = br.width  + 'px';
    modeIndicator.style.height = br.height + 'px';
    modeIndicator.style.opacity = '1';
  }

  modeIndicator.style.transition = 'none';
  requestAnimationFrame(() => {
    updateModeIndicator();
    requestAnimationFrame(() => { modeIndicator.style.transition = ''; });
  });
  window.addEventListener('resize', updateModeIndicator);

  /* ──────────────────────────────────────────
     MODE SWITCHING
  ────────────────────────────────────────── */
  let illustratorSnapshot = null; // offscreen canvas saved when leaving illustrator

  document.querySelectorAll('.tsp-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === activeMode) return;

      document.querySelectorAll('.tsp-mode-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      updateModeIndicator();

      if (mode === 'designer') {
        // Save illustrator canvas as an offscreen canvas (avoids ImageData size-mismatch issues)
        const off = document.createElement('canvas');
        off.width = canvas.width; off.height = canvas.height;
        off.getContext('2d').drawImage(canvas, 0, 0);
        illustratorSnapshot = off;

        activeMode = 'designer';
        document.getElementById('paintToolbar').style.display    = 'none';
        document.getElementById('designerToolbar').style.display = '';
        canvas.style.cursor = 'default';
        cursorEl.style.display = 'none';
        resizeCanvas(); // sets DPR dimensions and calls renderDesigner() with current dsgnObjects
      } else {
        activeMode = 'illustrator';
        document.getElementById('designerToolbar').style.display = 'none';
        document.getElementById('paintToolbar').style.display    = '';
        cancelPen(); cancelQuad();
        dismissTextOverlay(false);

        // Size canvas for illustrator (CSS px, no DPR scaling) and restore saved artwork
        const topbar  = document.getElementById('tspTopbar');
        const toolbar = document.getElementById('paintToolbar');
        const w = canvasArea.clientWidth;
        const h = canvasArea.clientHeight - topbar.offsetHeight - toolbar.offsetHeight;
        canvas.width        = w;
        canvas.height       = h;
        canvas.style.width  = '';
        canvas.style.height = '';
        ctx.fillStyle = bgColor();
        ctx.fillRect(0, 0, w, h);
        if (illustratorSnapshot) {
          ctx.drawImage(illustratorSnapshot, 0, 0, w, h);
        }

        canvas.style.cursor = 'none';
        updateCursorStyle();
      }
    });
  });

  /* ──────────────────────────────────────────
     SCREENSHOT
  ────────────────────────────────────────── */
  document.getElementById('paintCapture').addEventListener('click', () => {
    const sel = dsgnSelected;
    dsgnSelected = null;
    if (activeMode === 'designer') renderDesigner();

    const link = document.createElement('a');
    link.download = 'canvas-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();

    dsgnSelected = sel;
    if (activeMode === 'designer') renderDesigner();
  });

  /* ══════════════════════════════════════════
     ILLUSTRATOR MODE
  ══════════════════════════════════════════ */
  const COLORS = [
    '#000000','#808080','#c0c0c0','#ffffff',
    '#800000','#ff0000','#ff8040','#ffaa00',
    '#808000','#ffff00','#008000','#00ff00',
    '#008080','#00ffff','#000080','#0000ff',
    '#800080','#ff00ff','#ff80c0','#804000',
  ];

  let tool    = 'pencil';
  let color   = '#000000';
  let size    = 12;
  let drawing = false;
  let lastX   = 0, lastY = 0;
  let sprayTimer = null;

  /* ── History ── */
  const undoStack = [], redoStack = [];
  const MAX_HISTORY = 40;
  const undoBtn = document.getElementById('paintUndo');
  const redoBtn = document.getElementById('paintRedo');

  function syncHistoryBtns() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }
  function saveSnapshot() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    syncHistoryBtns();
  }

  undoBtn.addEventListener('click', () => {
    if (!undoStack.length) return;
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(undoStack.pop(), 0, 0);
    syncHistoryBtns();
  });
  redoBtn.addEventListener('click', () => {
    if (!redoStack.length) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(redoStack.pop(), 0, 0);
    syncHistoryBtns();
  });

  /* ── Custom cursor ── */
  const cursorEl = document.createElement('div');
  cursorEl.className = 'paint-cursor';
  canvasArea.appendChild(cursorEl);

  function getCursorDiameter() {
    if (tool === 'pencil') return Math.max(4, size * 0.8);
    if (tool === 'pen')    return Math.max(4, size * 1.3);
    if (tool === 'brush')  return size * 7;
    if (tool === 'spray')  return size * 10;
    if (tool === 'eraser') return size * 8;
    if (tool === 'fill')   return 14;
    return 8;
  }
  function updateCursorStyle() {
    cursorEl.classList.toggle('is-eraser', tool === 'eraser');
  }
  function moveCursor(e) {
    const rect = canvasArea.getBoundingClientRect();
    cursorEl.style.left   = (e.clientX - rect.left)  + 'px';
    cursorEl.style.top    = (e.clientY - rect.top)   + 'px';
    const d = getCursorDiameter();
    cursorEl.style.width  = d + 'px';
    cursorEl.style.height = d + 'px';
    updateCursorStyle();
  }

  canvas.addEventListener('mouseenter', e => {
    if (activeMode !== 'illustrator') return;
    cursorEl.style.display = 'block';
    moveCursor(e);
  });
  canvas.addEventListener('mouseleave', () => { cursorEl.style.display = 'none'; });
  canvas.addEventListener('mousemove',  e => {
    if (activeMode === 'illustrator') moveCursor(e);
  });

  /* ── Color palette ── */
  const grid          = document.getElementById('paintColorGrid');
  const activeColorEl = document.getElementById('paintActiveColor');
  activeColorEl.style.background = color;

  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'paint-swatch' + (c === color ? ' is-active' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      grid.querySelectorAll('.paint-swatch').forEach(s => s.classList.remove('is-active'));
      sw.classList.add('is-active');
      color = c;
      activeColorEl.style.background = c;
    });
    grid.appendChild(sw);
  });

  /* ── Tool buttons ── */
  document.querySelectorAll('#paintToolbar .paint-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#paintToolbar .paint-tool-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      tool = btn.dataset.tool;
    });
  });

  /* ── Size stepper ── */
  const sizeValueEl = document.getElementById('paintSizeValue');
  function setSize(val) {
    size = Math.min(30, Math.max(1, val || 1));
    sizeValueEl.value = size;
  }
  document.getElementById('paintSizeMinus').addEventListener('click', () => setSize(size - 1));
  document.getElementById('paintSizePlus').addEventListener('click',  () => setSize(size + 1));
  sizeValueEl.addEventListener('input', () => setSize(parseInt(sizeValueEl.value)));
  sizeValueEl.addEventListener('blur',  () => setSize(parseInt(sizeValueEl.value)));

  /* ── Clear ── */
  document.getElementById('paintClear').addEventListener('click', () => {
    saveSnapshot();
    ctx.fillStyle = bgColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  /* ── Coordinate helper ── */
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    if (activeMode === 'designer') {
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  /* ── Drawing routines ── */
  function stroke(x, y, lx, ly, width, alpha, cap) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = width;
    ctx.lineCap     = cap;
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawPencil(x, y, lx, ly) { stroke(x, y, lx, ly, Math.max(1, size * 0.4), 1, 'square'); }
  function drawPen(x, y, lx, ly)    { stroke(x, y, lx, ly, Math.max(1, size * 0.65), 1, 'round'); }
  function drawBrush(x, y, lx, ly)  { stroke(x, y, lx, ly, size * 3.5, 0.3, 'round'); }

  function drawSpray(x, y) {
    const radius  = size * 5;
    const density = 40;
    ctx.fillStyle = color;
    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * radius;
      ctx.fillRect(x + r * Math.cos(angle), y + r * Math.sin(angle), 1.5, 1.5);
    }
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function floodFill(startX, startY) {
    startX = Math.round(startX); startY = Math.round(startY);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width, h = canvas.height;
    const idx = (x, y) => (y * w + x) * 4;
    const target = data.slice(idx(startX, startY), idx(startX, startY) + 4);
    const [fr, fg, fb] = hexToRgb(color);
    if (target[0] === fr && target[1] === fg && target[2] === fb && target[3] === 255) return;
    const match = i => data[i]===target[0] && data[i+1]===target[1] && data[i+2]===target[2] && data[i+3]===target[3];
    const paint = i => { data[i]=fr; data[i+1]=fg; data[i+2]=fb; data[i+3]=255; };
    const stack = [[startX, startY]];
    const visited = new Uint8Array(w * h);
    while (stack.length) {
      let [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (visited[y * w + x]) continue;
      if (!match(idx(x, y))) continue;
      let lx = x; while (lx >= 0 && match(idx(lx, y))) lx--; lx++;
      let rx = x; while (rx < w  && match(idx(rx, y))) rx++; rx--;
      for (let i = lx; i <= rx; i++) {
        const vi = y * w + i;
        if (!visited[vi]) {
          paint(idx(i, y)); visited[vi] = 1;
          if (y > 0)     stack.push([i, y - 1]);
          if (y < h - 1) stack.push([i, y + 1]);
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function drawEraser(x, y, lx, ly) {
    ctx.lineWidth   = size * 4;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = bgColor();
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function applyTool(x, y) {
    if (tool === 'pencil') drawPencil(x, y, lastX, lastY);
    if (tool === 'pen')    drawPen(x, y, lastX, lastY);
    if (tool === 'brush')  drawBrush(x, y, lastX, lastY);
    if (tool === 'eraser') drawEraser(x, y, lastX, lastY);
    lastX = x; lastY = y;
  }

  /* ── Mouse events (illustrator) ── */
  canvas.addEventListener('mousedown', e => {
    if (activeMode !== 'illustrator') return;
    const {x, y} = getPos(e);
    if (tool === 'fill') { saveSnapshot(); floodFill(x, y); return; }
    saveSnapshot();
    drawing = true;
    lastX = x; lastY = y;
    if (tool === 'spray') {
      drawSpray(x, y);
      sprayTimer = setInterval(() => drawSpray(lastX, lastY), 25);
    } else {
      applyTool(x, y);
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (activeMode !== 'illustrator' || !drawing) return;
    const {x, y} = getPos(e);
    if (tool === 'spray') { lastX = x; lastY = y; }
    else applyTool(x, y);
  });

  function stopDrawing() { drawing = false; clearInterval(sprayTimer); }
  canvas.addEventListener('mouseup',    stopDrawing);
  canvas.addEventListener('mouseleave', e => { if (activeMode === 'illustrator') stopDrawing(); });

  /* ── Touch events (illustrator) ── */
  canvas.addEventListener('touchstart', e => {
    if (activeMode !== 'illustrator') return;
    e.preventDefault();
    const {x, y} = getPos(e);
    if (tool === 'fill') { saveSnapshot(); floodFill(x, y); return; }
    saveSnapshot(); drawing = true; lastX = x; lastY = y;
    if (tool === 'spray') { drawSpray(x, y); sprayTimer = setInterval(() => drawSpray(lastX, lastY), 25); }
    else applyTool(x, y);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (activeMode !== 'illustrator' || !drawing) return;
    e.preventDefault();
    const {x, y} = getPos(e);
    if (tool === 'spray') { lastX = x; lastY = y; } else applyTool(x, y);
  }, { passive: false });

  canvas.addEventListener('touchend', e => { if (activeMode === 'illustrator') stopDrawing(); });

  /* ══════════════════════════════════════════
     DESIGNER MODE
  ══════════════════════════════════════════ */
  let dsgnTool        = 'move';
  let dsgnStrokeColor = '#000000';
  let dsgnFillColor   = 'rgba(0,0,0,0)'; // transparent by default
  let dsgnColorTarget = 'stroke';         // which swatch the palette controls
  let dsgnStroke      = 2;
  let dsgnObjects     = [];
  let dsgnSelected    = null;

  // Drag state (document-level)
  let dsgnDragging  = false;
  let dsgnDragStart = null;
  let dsgnObjOrigin = null; // deep clone of object at drag start

  // Resize state (document-level)
  let dsgnResizing     = false;
  let dsgnResizeHandle = null; // 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br'
  let dsgnResizeOrigin = null; // {x,y,w,h} normalized at resize start

  // Shape draw state
  let dsgnDrawing   = false;
  let dsgnDrawStart = null;

  // Pen path state — each point: { x, y, cpIn: {x,y}|null, cpOut: {x,y}|null }
  let penPath       = [];
  let penActive     = false;
  let penLastClick  = 0;
  let penMouseDown  = false;   // user is currently dragging out a handle
  let penMousePos   = null;    // current cursor (for rubber-band)
  let penEditTarget = null;    // { type:'anchor'|'cpIn'|'cpOut', ptIdx, startPos, ptsOrigin }

  // Quad state
  let quadPoints = [];

  // Text state
  let dsgnTextFont   = 'Inter';
  let dsgnTextSize   = 24;
  let dsgnTextWeight = '400';
  let textOverlay    = null;
  let textPlaceX = 0, textPlaceY = 0;

  // Marquee / multi-select state
  let dsgnSelectedSet    = new Set();
  let dsgnMarquee        = null;
  let dsgnMultiDragging  = false;
  let dsgnMultiDragStart = null;
  let dsgnMultiOrigins   = [];

  // Undo / redo
  const dsgnUndoStack = [], dsgnRedoStack = [];
  const dsgnUndoBtn = document.getElementById('dsgnUndo');
  const dsgnRedoBtn = document.getElementById('dsgnRedo');

  function syncDsgnHistory() {
    dsgnUndoBtn.disabled = !dsgnUndoStack.length;
    dsgnRedoBtn.disabled = !dsgnRedoStack.length;
  }
  function dsgnSaveSnapshot() {
    dsgnUndoStack.push(JSON.parse(JSON.stringify(dsgnObjects)));
    if (dsgnUndoStack.length > 40) dsgnUndoStack.shift();
    dsgnRedoStack.length = 0;
    syncDsgnHistory();
  }

  dsgnUndoBtn.addEventListener('click', () => {
    if (!dsgnUndoStack.length) return;
    dsgnRedoStack.push(JSON.parse(JSON.stringify(dsgnObjects)));
    dsgnObjects = dsgnUndoStack.pop();
    dsgnSelected = null; renderDesigner(); syncDsgnHistory();
  });
  dsgnRedoBtn.addEventListener('click', () => {
    if (!dsgnRedoStack.length) return;
    dsgnUndoStack.push(JSON.parse(JSON.stringify(dsgnObjects)));
    dsgnObjects = dsgnRedoStack.pop();
    dsgnSelected = null; renderDesigner(); syncDsgnHistory();
  });
  document.getElementById('dsgnClear').addEventListener('click', () => {
    dsgnSaveSnapshot();
    dsgnObjects = []; dsgnSelected = null;
    cancelPen(); cancelQuad(); renderDesigner();
  });

  /* ── Fill / Stroke color indicator ── */
  const dsgnFillSwatch   = document.getElementById('dsgnFillSwatch');
  const dsgnStrokeSwatch = document.getElementById('dsgnStrokeSwatch');
  const dsgnColorGrid    = document.getElementById('dsgnColorGrid');

  function updateColorIndicator() {
    const fillTransparent = dsgnFillColor === 'rgba(0,0,0,0)' || dsgnFillColor === 'transparent';
    dsgnFillSwatch.style.background = fillTransparent
      ? 'linear-gradient(to bottom right,#fff calc(50% - 1px),#e00 calc(50% - 1px),#e00 calc(50% + 1px),#fff calc(50% + 1px))'
      : dsgnFillColor;
    dsgnStrokeSwatch.style.borderColor = dsgnStrokeColor;
    dsgnFillSwatch.classList.toggle('is-active-target',   dsgnColorTarget === 'fill');
    dsgnStrokeSwatch.classList.toggle('is-active-target', dsgnColorTarget === 'stroke');
  }

  dsgnFillSwatch.addEventListener('click', () => { dsgnColorTarget = 'fill';   updateColorIndicator(); });
  dsgnStrokeSwatch.addEventListener('click',() => { dsgnColorTarget = 'stroke'; updateColorIndicator(); });

  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'paint-swatch';
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      if (dsgnColorTarget === 'fill') {
        dsgnFillColor = c;
      } else {
        dsgnStrokeColor = c;
      }
      updateColorIndicator();
      // Apply to selected object immediately
      if (dsgnSelected !== null) {
        dsgnSaveSnapshot();
        const obj = dsgnObjects[dsgnSelected];
        if (dsgnColorTarget === 'fill' && obj.type !== 'text') {
          obj.fillColor = c;
        } else {
          obj.color = c;
        }
        renderDesigner();
      }
    });
    dsgnColorGrid.appendChild(sw);
  });
  updateColorIndicator();

  /* ── Designer tool buttons ── */
  document.querySelectorAll('[data-dsgn-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      commitPen(); cancelQuad(); dismissTextOverlay(false);
      document.querySelectorAll('[data-dsgn-tool]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      dsgnTool = btn.dataset.dsgnTool;
      if (dsgnTool !== 'move') { dsgnSelected = null; dsgnSelectedSet.clear(); renderDesigner(); }
      updateMoveCursor();
      updateToolbarPanels();
    });
  });

  function updateToolbarPanels() {
    const textOpts   = document.getElementById('dsgnTextOpts');
    const strokeOpts = document.getElementById('dsgnStrokeOpts');
    if (dsgnTool === 'move' && dsgnSelected !== null) {
      const obj = dsgnObjects[dsgnSelected];
      textOpts.style.display   = obj.type === 'text' ? '' : 'none';
      strokeOpts.style.display = obj.type === 'text' ? 'none' : '';
    } else {
      textOpts.style.display   = dsgnTool === 'text'                       ? '' : 'none';
      strokeOpts.style.display = (dsgnTool === 'move' || dsgnTool === 'text') ? 'none' : '';
    }
  }

  /* ── Designer hotkeys ── */
  document.addEventListener('keydown', e => {
    if (activeMode !== 'designer') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const key = e.key;

    // Cmd+Z / Cmd+Shift+Z undo / redo
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === 'z') { e.preventDefault(); document.getElementById('dsgnUndo').click(); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey  && key === 'z') { e.preventDefault(); document.getElementById('dsgnRedo').click(); return; }

    let toolToActivate = null;
    if (!e.shiftKey && key === 'v') toolToActivate = 'move';
    else if (!e.shiftKey && key === 'p') toolToActivate = 'pen';
    else if (!e.shiftKey && key === 'r') toolToActivate = 'rect';
    else if (!e.shiftKey && key === 'o') toolToActivate = 'circle';
    else if (e.shiftKey  && key === 'R') toolToActivate = 'triangle';
    else if (!e.shiftKey && key === 't') toolToActivate = 'text';
    if (!toolToActivate) return;
    e.preventDefault();
    document.querySelector(`[data-dsgn-tool="${toolToActivate}"]`)?.click();
  });

  /* ── Stroke width ── */
  const dsgnStrokeEl = document.getElementById('dsgnStrokeValue');
  function setDsgnStroke(val) {
    dsgnStroke = Math.min(30, Math.max(1, val || 1));
    dsgnStrokeEl.value = dsgnStroke;
    if (dsgnSelected !== null && dsgnObjects[dsgnSelected]) {
      dsgnObjects[dsgnSelected].strokeWidth = dsgnStroke;
      renderDesigner();
    }
  }
  document.getElementById('dsgnStrokeMinus').addEventListener('click', () => setDsgnStroke(dsgnStroke - 1));
  document.getElementById('dsgnStrokePlus').addEventListener('click',  () => setDsgnStroke(dsgnStroke + 1));
  dsgnStrokeEl.addEventListener('input', () => setDsgnStroke(parseInt(dsgnStrokeEl.value)));
  dsgnStrokeEl.addEventListener('blur',  () => setDsgnStroke(parseInt(dsgnStrokeEl.value)));

  /* ── Text controls ── */
  const dsgnSizeEl = document.getElementById('dsgnSizeValue');
  function setDsgnSize(val) {
    dsgnTextSize = Math.min(200, Math.max(8, val || 8));
    dsgnSizeEl.value = dsgnTextSize;
    if (dsgnSelected !== null) {
      const obj = dsgnObjects[dsgnSelected];
      if (obj && obj.type === 'text') { obj.fontSize = dsgnTextSize; renderDesigner(); }
    }
  }
  document.getElementById('dsgnSizeMinus').addEventListener('click', () => setDsgnSize(dsgnTextSize - 1));
  document.getElementById('dsgnSizePlus').addEventListener('click',  () => setDsgnSize(dsgnTextSize + 1));
  dsgnSizeEl.addEventListener('input', () => setDsgnSize(parseInt(dsgnSizeEl.value)));
  dsgnSizeEl.addEventListener('blur',  () => setDsgnSize(parseInt(dsgnSizeEl.value)));

  document.getElementById('dsgnFontFamily').addEventListener('change', e => {
    dsgnTextFont = e.target.value;
    if (dsgnSelected !== null) {
      const obj = dsgnObjects[dsgnSelected];
      if (obj && obj.type === 'text') { obj.font = dsgnTextFont; renderDesigner(); }
    }
  });
  document.getElementById('dsgnFontWeight').addEventListener('change', e => {
    dsgnTextWeight = e.target.value;
    if (dsgnSelected !== null) {
      const obj = dsgnObjects[dsgnSelected];
      if (obj && obj.type === 'text') { obj.weight = dsgnTextWeight; renderDesigner(); }
    }
  });

  /* ──────────────────────────────────────────
     GEOMETRY HELPERS
  ────────────────────────────────────────── */
  function getBounds(obj) {
    const x = Math.min(obj.x, obj.x + obj.w);
    const y = Math.min(obj.y, obj.y + obj.h);
    const w = Math.abs(obj.w);
    const h = Math.abs(obj.h);
    return { x, y, w, h };
  }

  const HANDLE_NAMES = ['tl','tc','tr','ml','mr','bl','bc','br'];
  const HANDLE_CURSORS = {
    tl:'nwse-resize', br:'nwse-resize',
    tr:'nesw-resize', bl:'nesw-resize',
    tc:'ns-resize',   bc:'ns-resize',
    ml:'ew-resize',   mr:'ew-resize',
  };
  const HR = 6; // handle hit radius in canvas px

  function getHandlePoints(obj) {
    if (!obj || obj.type === 'text' || obj.type === 'pen' || obj.type === 'quad') return null;
    const { x, y, w, h } = getBounds(obj);
    return {
      tl:{x:x,     y:y    }, tc:{x:x+w/2,y:y    }, tr:{x:x+w, y:y    },
      ml:{x:x,     y:y+h/2},                        mr:{x:x+w, y:y+h/2},
      bl:{x:x,     y:y+h  }, bc:{x:x+w/2,y:y+h  }, br:{x:x+w, y:y+h  },
    };
  }

  function hitHandle(obj, px, py) {
    const handles = getHandlePoints(obj);
    if (!handles) return null;
    for (const name of HANDLE_NAMES) {
      const h = handles[name];
      if (Math.abs(px - h.x) <= HR && Math.abs(py - h.y) <= HR) return name;
    }
    return null;
  }

  /* ──────────────────────────────────────────
     CURSOR MANAGEMENT
  ────────────────────────────────────────── */
  function updateMoveCursor(hoverHandle, hoverObj) {
    if (activeMode !== 'designer') return;
    if (dsgnTool !== 'move')   { canvas.style.cursor = dsgnTool === 'text' ? 'text' : 'crosshair'; return; }
    if (dsgnResizing)          { canvas.style.cursor = HANDLE_CURSORS[dsgnResizeHandle] || 'default'; return; }
    if (dsgnDragging)          { canvas.style.cursor = 'grabbing'; return; }
    if (hoverHandle)           { canvas.style.cursor = HANDLE_CURSORS[hoverHandle]; return; }
    if (hoverObj)              { canvas.style.cursor = 'grab'; return; }
    canvas.style.cursor = 'default';
  }

  /* ──────────────────────────────────────────
     RENDER
  ────────────────────────────────────────── */
  function renderDesigner(previewObj) {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bgColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    dsgnObjects.forEach((obj, i) => drawDsgnObj(obj, i === dsgnSelected, dsgnSelectedSet.has(i) && i !== dsgnSelected));
    if (previewObj) drawDsgnObj(previewObj, false);

    if (penActive && penPath.length) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      // Draw completed segments
      ctx.beginPath();
      ctx.moveTo(penPath[0].x, penPath[0].y);
      for (let i = 1; i < penPath.length; i++) {
        const f = penPath[i-1], t = penPath[i];
        ctx.bezierCurveTo(
          (f.cpOut || f).x, (f.cpOut || f).y,
          (t.cpIn  || t).x, (t.cpIn  || t).y,
          t.x, t.y
        );
      }
      ctx.strokeStyle = dsgnStrokeColor; ctx.lineWidth = dsgnStroke; ctx.stroke();

      // Rubber-band from last point to cursor
      if (penMousePos) {
        const last = penPath[penPath.length - 1];
        ctx.beginPath(); ctx.moveTo(last.x, last.y);
        ctx.bezierCurveTo(
          (last.cpOut || last).x, (last.cpOut || last).y,
          penMousePos.x, penMousePos.y,
          penMousePos.x, penMousePos.y
        );
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = dsgnStrokeColor; ctx.lineWidth = dsgnStroke; ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Handle lines + dots
      penPath.forEach((p, i) => {
        ctx.strokeStyle = 'rgba(100,100,100,0.6)'; ctx.lineWidth = 1;
        if (p.cpIn  && i > 0) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.cpIn.x,  p.cpIn.y);  ctx.stroke(); }
        if (p.cpOut)           { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.cpOut.x, p.cpOut.y); ctx.stroke(); }
        // Anchor square
        ctx.fillStyle = i === 0 ? '#3b82f6' : '#fff';
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
        // Handle circles
        [p.cpIn && i > 0 ? p.cpIn : null, p.cpOut].forEach(h => {
          if (!h) return;
          ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.stroke();
        });
      });

      ctx.restore();
    }

    if (quadPoints.length) {
      ctx.save();
      ctx.strokeStyle = dsgnStrokeColor; ctx.lineWidth = dsgnStroke; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(quadPoints[0].x, quadPoints[0].y);
      quadPoints.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke(); ctx.setLineDash([]);
      quadPoints.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      });
      ctx.restore();
    }

    if (dsgnMarquee) {
      const mx = Math.min(dsgnMarquee.x1, dsgnMarquee.x2);
      const my = Math.min(dsgnMarquee.y1, dsgnMarquee.y2);
      const mw = Math.abs(dsgnMarquee.x2 - dsgnMarquee.x1);
      const mh = Math.abs(dsgnMarquee.y2 - dsgnMarquee.y1);
      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.07)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(mx, my, mw, mh); ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.restore(); // undo dpr scale
  }

  function getObjBBox(obj) {
    if (obj.pts) {
      const xs = obj.pts.map(p => p.x), ys = obj.pts.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (obj.type === 'text') {
      ctx.font = `${obj.weight||'400'} ${obj.fontSize||24}px ${obj.font||'Inter'}`;
      const tw = ctx.measureText(obj.content || '').width;
      const th = obj.fontSize || 24;
      return { x: obj.x, y: obj.y - th, w: tw, h: th };
    }
    return getBounds(obj);
  }

  function drawDsgnObj(obj, selected, inSet) {
    ctx.save();
    ctx.lineWidth = obj.strokeWidth || 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (obj.type === 'rect') {
      const { x, y, w, h } = getBounds(obj);
      ctx.beginPath(); ctx.rect(x, y, w, h);
      ctx.fillStyle = obj.fillColor || 'rgba(0,0,0,0)'; ctx.fill();
      if (obj.color && obj.color !== 'rgba(0,0,0,0)') { ctx.strokeStyle = obj.color; ctx.stroke(); }
      if (selected) drawHandles(x, y, w, h);
      else if (inSet) drawSetHighlight(x, y, w, h);

    } else if (obj.type === 'circle') {
      const { x, y, w, h } = getBounds(obj);
      ctx.beginPath(); ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);
      ctx.fillStyle = obj.fillColor || 'rgba(0,0,0,0)'; ctx.fill();
      if (obj.color && obj.color !== 'rgba(0,0,0,0)') { ctx.strokeStyle = obj.color; ctx.stroke(); }
      if (selected) drawHandles(x, y, w, h);
      else if (inSet) drawSetHighlight(x, y, w, h);

    } else if (obj.type === 'triangle') {
      const { x, y, w, h } = getBounds(obj);
      ctx.beginPath(); ctx.moveTo(x + w/2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
      ctx.fillStyle = obj.fillColor || 'rgba(0,0,0,0)'; ctx.fill();
      if (obj.color && obj.color !== 'rgba(0,0,0,0)') { ctx.strokeStyle = obj.color; ctx.stroke(); }
      if (selected) drawHandles(x, y, w, h);
      else if (inSet) drawSetHighlight(x, y, w, h);

    } else if (obj.type === 'quad') {
      ctx.beginPath(); ctx.moveTo(obj.pts[0].x, obj.pts[0].y);
      obj.pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      if (obj.fillColor) { ctx.fillStyle = obj.fillColor; ctx.fill(); }
      ctx.strokeStyle = obj.color || '#000000'; ctx.stroke();
      const qxs = obj.pts.map(p => p.x), qys = obj.pts.map(p => p.y);
      const qbx = Math.min(...qxs), qby = Math.min(...qys);
      const qbw = Math.max(...qxs) - qbx, qbh = Math.max(...qys) - qby;
      if (selected) {
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.strokeRect(qbx - 4, qby - 4, qbw + 8, qbh + 8); ctx.setLineDash([]);
        obj.pts.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.stroke();
        });
      } else if (inSet) drawSetHighlight(qbx - 4, qby - 4, qbw + 8, qbh + 8);

    } else if (obj.type === 'pen') {
      // Draw bezier path
      ctx.beginPath(); ctx.moveTo(obj.pts[0].x, obj.pts[0].y);
      for (let i = 1; i < obj.pts.length; i++) {
        const f = obj.pts[i-1], t = obj.pts[i];
        ctx.bezierCurveTo(
          (f.cpOut || f).x, (f.cpOut || f).y,
          (t.cpIn  || t).x, (t.cpIn  || t).y,
          t.x, t.y
        );
      }
      if (obj.closed) ctx.closePath();
      if (obj.fillColor) { ctx.fillStyle = obj.fillColor; ctx.fill(); }
      ctx.strokeStyle = obj.color || '#000000'; ctx.stroke();
      const pxs = obj.pts.map(p => p.x), pys = obj.pts.map(p => p.y);
      const pbx = Math.min(...pxs), pby = Math.min(...pys);
      const pbw = Math.max(...pxs) - pbx, pbh = Math.max(...pys) - pby;
      if (selected) {
        // Edit handles: lines, anchors, handle dots
        obj.pts.forEach((p, i) => {
          ctx.strokeStyle = 'rgba(100,100,100,0.5)'; ctx.lineWidth = 1;
          if (p.cpIn  && i > 0) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.cpIn.x,  p.cpIn.y);  ctx.stroke(); }
          if (p.cpOut)           { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.cpOut.x, p.cpOut.y); ctx.stroke(); }
        });
        obj.pts.forEach((p, i) => {
          // Anchor square
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
          // Handle circles
          [p.cpIn && i > 0 ? p.cpIn : null, p.cpOut].forEach(h => {
            if (!h) return;
            ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.stroke();
          });
        });
      } else if (inSet) drawSetHighlight(pbx - 4, pby - 4, pbw + 8, pbh + 8);

    } else if (obj.type === 'text') {
      ctx.font = `${obj.weight || '400'} ${obj.fontSize || 24}px ${obj.font || 'Inter'}, sans-serif`;
      ctx.fillStyle = obj.color || '#000000';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(obj.content, obj.x, obj.y);
      const tw = ctx.measureText(obj.content).width;
      const th = obj.fontSize || 24;
      if (selected) {
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.strokeRect(obj.x - 4, obj.y - th - 4, tw + 8, th + 10); ctx.setLineDash([]);
      } else if (inSet) drawSetHighlight(obj.x - 4, obj.y - th - 4, tw + 8, th + 10);
    }
    ctx.restore();
  }

  function drawSetHighlight(x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.5;
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawHandles(x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    [[x,y],[x+w/2,y],[x+w,y],[x,y+h/2],[x+w,y+h/2],[x,y+h],[x+w/2,y+h],[x+w,y+h]].forEach(([hx,hy]) => {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(hx-4, hy-4, 8, 8); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }

  /* ──────────────────────────────────────────
     HIT TESTING
  ────────────────────────────────────────── */
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx-ax, dy = by-ay, len2 = dx*dx+dy*dy;
    if (len2 === 0) return Math.hypot(px-ax, py-ay);
    const t = Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/len2));
    return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
  }

  function hitTest(obj, x, y) {
    const M = 8;
    if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'triangle') {
      const { x:bx, y:by, w, h } = getBounds(obj);
      const hasFill = obj.fillColor && obj.fillColor !== 'rgba(0,0,0,0)';
      if (hasFill) return x >= bx && x <= bx+w && y >= by && y <= by+h;
      // Stroke-only: hit near edges
      return x >= bx-M && x <= bx+w+M && y >= by-M && y <= by+h+M &&
             !(x > bx+M && x < bx+w-M && y > by+M && y < by+h-M);
    }
    if (obj.type === 'quad' || obj.type === 'pen') {
      const len = obj.type === 'quad' ? obj.pts.length : obj.pts.length - 1;
      for (let i = 0; i < len; i++) {
        const a = obj.pts[i], b = obj.pts[(i+1) % obj.pts.length];
        if (distToSegment(x, y, a.x, a.y, b.x, b.y) < M) return true;
      }
      return false;
    }
    if (obj.type === 'text') {
      ctx.font = `${obj.weight||'400'} ${obj.fontSize||24}px ${obj.font||'Inter'}`;
      const tw = ctx.measureText(obj.content).width;
      const th = obj.fontSize || 24;
      return x >= obj.x-M && x <= obj.x+tw+M && y >= obj.y-th-M && y <= obj.y+M;
    }
    return false;
  }

  function hitPenPt(obj, px, py) {
    const R = 7;
    for (let i = 0; i < obj.pts.length; i++) {
      const p = obj.pts[i];
      if (Math.abs(px - p.x) <= R && Math.abs(py - p.y) <= R) return { type: 'anchor', ptIdx: i };
      if (p.cpIn  && i > 0 && Math.abs(px - p.cpIn.x)  <= R && Math.abs(py - p.cpIn.y)  <= R) return { type: 'cpIn',  ptIdx: i };
      if (p.cpOut &&           Math.abs(px - p.cpOut.x) <= R && Math.abs(py - p.cpOut.y) <= R) return { type: 'cpOut', ptIdx: i };
    }
    return null;
  }

  /* ──────────────────────────────────────────
     PROPERTY SYNC
  ────────────────────────────────────────── */
  function syncToolbarToSelection() {
    if (dsgnSelected === null) return;
    const obj = dsgnObjects[dsgnSelected];
    if (!obj) return;
    dsgnStrokeColor = obj.color || dsgnStrokeColor;
    if (obj.fillColor !== undefined) dsgnFillColor = obj.fillColor;
    updateColorIndicator();
    if (obj.strokeWidth !== undefined) {
      dsgnStroke = obj.strokeWidth;
      dsgnStrokeEl.value = dsgnStroke;
    }
    if (obj.type === 'text') {
      if (obj.font)     { dsgnTextFont = obj.font;     document.getElementById('dsgnFontFamily').value = dsgnTextFont; }
      if (obj.fontSize) { dsgnTextSize = obj.fontSize; dsgnSizeEl.value = dsgnTextSize; }
      if (obj.weight)   { dsgnTextWeight = obj.weight; document.getElementById('dsgnFontWeight').value = dsgnTextWeight; }
    }
  }

  /* ──────────────────────────────────────────
     RESIZE
  ────────────────────────────────────────── */
  function applyResize(pos) {
    if (dsgnSelected === null || !dsgnResizeOrigin) return;
    const obj = dsgnObjects[dsgnSelected];
    const o   = dsgnResizeOrigin; // {x,y,w,h} normalized bounds at start
    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
    const r = dsgnResizeHandle;
    if (r === 'tl') { nx = pos.x; ny = pos.y; nw = (o.x+o.w)-pos.x; nh = (o.y+o.h)-pos.y; }
    if (r === 'tc') { ny = pos.y; nh = (o.y+o.h)-pos.y; }
    if (r === 'tr') { ny = pos.y; nw = pos.x-o.x; nh = (o.y+o.h)-pos.y; }
    if (r === 'ml') { nx = pos.x; nw = (o.x+o.w)-pos.x; }
    if (r === 'mr') { nw = pos.x-o.x; }
    if (r === 'bl') { nx = pos.x; nw = (o.x+o.w)-pos.x; nh = pos.y-o.y; }
    if (r === 'bc') { nh = pos.y-o.y; }
    if (r === 'br') { nw = pos.x-o.x; nh = pos.y-o.y; }
    obj.x = nx; obj.y = ny;
    obj.w = Math.max(4, nw);
    obj.h = Math.max(4, nh);
  }

  /* ──────────────────────────────────────────
     TEXT OVERLAY
  ────────────────────────────────────────── */
  function showTextOverlay(canvasX, canvasY) {
    dismissTextOverlay(false);
    textPlaceX = canvasX; textPlaceY = canvasY;
    const cr = canvas.getBoundingClientRect();
    const sx = cr.left + canvasX * (cr.width / canvas.width);
    const sy = cr.top  + (canvasY - dsgnTextSize) * (cr.height / canvas.height);
    textOverlay = document.createElement('input');
    textOverlay.type = 'text';
    textOverlay.className = 'dsgn-text-overlay';
    textOverlay.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;font:${dsgnTextWeight} ${dsgnTextSize}px ${dsgnTextFont},sans-serif;color:${dsgnStrokeColor};min-width:80px;`;
    document.body.appendChild(textOverlay);
    textOverlay.focus();
    textOverlay.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commitText(); }
      if (e.key === 'Escape') { dismissTextOverlay(false); }
    });
    textOverlay.addEventListener('blur', () => commitText());
  }

  function commitText() {
    if (!textOverlay) return;
    const content = textOverlay.value.trim();
    textOverlay.remove(); textOverlay = null;
    if (!content) return;
    dsgnSaveSnapshot();
    dsgnObjects.push({ type:'text', x:textPlaceX, y:textPlaceY, content,
      font:dsgnTextFont, fontSize:dsgnTextSize, weight:dsgnTextWeight, color:dsgnStrokeColor });
    renderDesigner();
  }

  function dismissTextOverlay(commit) {
    if (!textOverlay) return;
    if (commit) { commitText(); return; }
    textOverlay.remove(); textOverlay = null;
  }

  /* ──────────────────────────────────────────
     PEN / QUAD
  ────────────────────────────────────────── */
  function commitPen() {
    if (penActive && penPath.length >= 2) {
      dsgnSaveSnapshot();
      dsgnObjects.push({ type:'pen', pts:penPath.slice(), color:dsgnStrokeColor, strokeWidth:dsgnStroke });
    }
    penPath = []; penActive = false;
    if (activeMode === 'designer') renderDesigner();
  }
  function cancelPen()  { penPath = []; penActive = false; penMouseDown = false; penMousePos = null; if (activeMode === 'designer') renderDesigner(); }
  function cancelQuad() { quadPoints = []; if (activeMode === 'designer') renderDesigner(); }

  /* ──────────────────────────────────────────
     KEYBOARD (delete / escape)
  ────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (activeMode !== 'designer') return;
    if (e.key === 'Escape') {
      cancelPen(); cancelQuad(); dismissTextOverlay(false);
      dsgnSelected = null; renderDesigner(); updateToolbarPanels();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && dsgnSelected !== null) {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      dsgnSaveSnapshot();
      dsgnObjects.splice(dsgnSelected, 1);
      dsgnSelected = null; renderDesigner(); updateToolbarPanels();
    }
  });

  /* ──────────────────────────────────────────
     MAKE SHAPE
  ────────────────────────────────────────── */
  function makeShapeObj(x1, y1, x2, y2) {
    return {
      type: dsgnTool,
      x: Math.min(x1,x2), y: Math.min(y1,y2),
      w: Math.abs(x2-x1), h: Math.abs(y2-y1),
      color:       dsgnStrokeColor,
      fillColor:   dsgnFillColor,
      strokeWidth: dsgnStroke,
    };
  }

  /* ──────────────────────────────────────────
     CANVAS MOUSE — selection & draw start
  ────────────────────────────────────────── */
  canvas.addEventListener('mousedown', e => {
    if (activeMode !== 'designer') return;
    e.preventDefault();
    const pos = getPos(e);

    if (dsgnTool === 'text') {
      dsgnSelected = null; showTextOverlay(pos.x, pos.y); return;
    }

    if (dsgnTool === 'move') {
      // Check pen anchor/handle hit on selected pen path
      if (dsgnSelected !== null && dsgnObjects[dsgnSelected] && dsgnObjects[dsgnSelected].type === 'pen') {
        const penHit = hitPenPt(dsgnObjects[dsgnSelected], pos.x, pos.y);
        if (penHit) {
          penEditTarget = { ...penHit, startPos: { x: pos.x, y: pos.y }, ptsOrigin: JSON.parse(JSON.stringify(dsgnObjects[dsgnSelected].pts)) };
          canvas.style.cursor = 'move'; return;
        }
      }
      // Check resize handle on primary selected object first
      if (dsgnSelected !== null) {
        const handle = hitHandle(dsgnObjects[dsgnSelected], pos.x, pos.y);
        if (handle) {
          dsgnResizing = true; dsgnResizeHandle = handle;
          dsgnResizeOrigin = { ...getBounds(dsgnObjects[dsgnSelected]) };
          canvas.style.cursor = HANDLE_CURSORS[handle]; return;
        }
      }
      // Hit-test objects (front to back)
      let hit = null;
      for (let i = dsgnObjects.length - 1; i >= 0; i--) {
        if (hitTest(dsgnObjects[i], pos.x, pos.y)) { hit = i; break; }
      }
      if (hit !== null) {
        if (dsgnSelectedSet.has(hit) && dsgnSelectedSet.size > 1) {
          // Start multi-drag: move all selected objects together
          dsgnMultiDragging  = true;
          dsgnMultiDragStart = { x: pos.x, y: pos.y };
          dsgnMultiOrigins   = [...dsgnSelectedSet].map(i => ({ i, obj: JSON.parse(JSON.stringify(dsgnObjects[i])) }));
          canvas.style.cursor = 'grabbing';
        } else {
          // Single select + drag
          const prevSel = dsgnSelected;
          dsgnSelected = hit;
          dsgnSelectedSet = new Set([hit]);
          if (hit !== prevSel) syncToolbarToSelection();
          dsgnDragging  = true;
          dsgnDragStart = { x: pos.x, y: pos.y };
          dsgnObjOrigin = JSON.parse(JSON.stringify(dsgnObjects[hit]));
          canvas.style.cursor = 'grabbing';
        }
      } else {
        // Start rubber-band marquee
        dsgnSelected = null;
        dsgnSelectedSet.clear();
        dsgnMarquee = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
        canvas.style.cursor = 'crosshair';
      }
      updateToolbarPanels();
      renderDesigner(); return;
    }

    if (dsgnTool === 'pen') {
      const now = Date.now();
      if (penActive && now - penLastClick < 350 && penPath.length >= 2) {
        // Double-click: commit
        dsgnSaveSnapshot();
        dsgnObjects.push({ type:'pen', pts:penPath.slice(), color:dsgnStrokeColor, strokeWidth:dsgnStroke });
        cancelPen(); penMouseDown = false;
      } else {
        if (!penActive) penActive = true;
        penPath.push({ x: pos.x, y: pos.y, cpIn: null, cpOut: null });
        penMouseDown = true;
        renderDesigner();
      }
      penLastClick = now; return;
    }

    if (dsgnTool === 'quad') {
      quadPoints.push({ x:pos.x, y:pos.y });
      if (quadPoints.length === 4) {
        dsgnSaveSnapshot();
        dsgnObjects.push({ type:'quad', pts:quadPoints.slice(), color:dsgnStrokeColor, strokeWidth:dsgnStroke });
        cancelQuad();
      } else { renderDesigner(); }
      return;
    }

    // Rect / circle / triangle — drag to draw
    dsgnSelected = null; dsgnDrawing = true; dsgnDrawStart = { x:pos.x, y:pos.y };
  });

  /* Hover cursor feedback (only when not actively operating) */
  canvas.addEventListener('mousemove', e => {
    if (activeMode !== 'designer') return;
    if (dsgnDragging || dsgnResizing || dsgnDrawing) return;
    if (dsgnTool !== 'move') return;
    const pos = getPos(e);
    let hoverHandle = null, hoverObj = false;
    if (dsgnSelected !== null) hoverHandle = hitHandle(dsgnObjects[dsgnSelected], pos.x, pos.y);
    if (!hoverHandle) {
      for (let i = dsgnObjects.length - 1; i >= 0; i--) {
        if (hitTest(dsgnObjects[i], pos.x, pos.y)) { hoverObj = true; break; }
      }
    }
    updateMoveCursor(hoverHandle, hoverObj);
  });

  /* ──────────────────────────────────────────
     DOCUMENT-LEVEL MOUSE — drag / resize / draw
  ────────────────────────────────────────── */
  document.addEventListener('mousemove', e => {
    if (activeMode !== 'designer') return;
    const pos = getPos(e);

    // Always update pen rubber-band cursor
    if (penActive) { penMousePos = pos; }

    // Pen point being placed (drag to set handles)
    if (penMouseDown && penPath.length > 0) {
      const last = penPath[penPath.length - 1];
      const dx = pos.x - last.x, dy = pos.y - last.y;
      if (Math.hypot(dx, dy) > 3) {
        last.cpOut = { x: last.x + dx, y: last.y + dy };
        last.cpIn  = { x: last.x - dx, y: last.y - dy };
      }
      renderDesigner(); return;
    }

    // Pen edit handle drag (move tool, pen path selected)
    if (penEditTarget && dsgnSelected !== null) {
      const obj = dsgnObjects[dsgnSelected];
      const dx = pos.x - penEditTarget.startPos.x, dy = pos.y - penEditTarget.startPos.y;
      const i = penEditTarget.ptIdx;
      const orig = penEditTarget.ptsOrigin[i];
      if (penEditTarget.type === 'anchor') {
        obj.pts[i].x = orig.x + dx; obj.pts[i].y = orig.y + dy;
        if (orig.cpIn)  obj.pts[i].cpIn  = { x: orig.cpIn.x  + dx, y: orig.cpIn.y  + dy };
        if (orig.cpOut) obj.pts[i].cpOut = { x: orig.cpOut.x + dx, y: orig.cpOut.y + dy };
      } else if (penEditTarget.type === 'cpOut') {
        obj.pts[i].cpOut = { x: orig.cpOut.x + dx, y: orig.cpOut.y + dy };
        const hdx = obj.pts[i].cpOut.x - obj.pts[i].x, hdy = obj.pts[i].cpOut.y - obj.pts[i].y;
        obj.pts[i].cpIn = { x: obj.pts[i].x - hdx, y: obj.pts[i].y - hdy };
      } else if (penEditTarget.type === 'cpIn') {
        obj.pts[i].cpIn = { x: orig.cpIn.x + dx, y: orig.cpIn.y + dy };
        const hdx = obj.pts[i].cpIn.x - obj.pts[i].x, hdy = obj.pts[i].cpIn.y - obj.pts[i].y;
        obj.pts[i].cpOut = { x: obj.pts[i].x - hdx, y: obj.pts[i].y - hdy };
      }
      renderDesigner(); return;
    }

    if (penActive) { renderDesigner(); return; }

    if (dsgnMarquee) {
      dsgnMarquee.x2 = pos.x; dsgnMarquee.y2 = pos.y;
      renderDesigner(); return;
    }

    if (dsgnMultiDragging) {
      const dx = pos.x - dsgnMultiDragStart.x, dy = pos.y - dsgnMultiDragStart.y;
      dsgnMultiOrigins.forEach(({ i, obj }) => {
        const target = dsgnObjects[i];
        if (obj.pts) { target.pts = obj.pts.map(p => ({ x: p.x+dx, y: p.y+dy })); }
        else { target.x = obj.x + dx; target.y = obj.y + dy; }
      });
      renderDesigner(); return;
    }

    if (dsgnDragging && dsgnSelected !== null) {
      const obj = dsgnObjects[dsgnSelected];
      const dx = pos.x - dsgnDragStart.x, dy = pos.y - dsgnDragStart.y;
      if (obj.pts) {
        obj.pts = dsgnObjOrigin.pts.map(p => ({ x: p.x+dx, y: p.y+dy }));
      } else {
        obj.x = dsgnObjOrigin.x + dx;
        obj.y = dsgnObjOrigin.y + dy;
      }
      renderDesigner(); return;
    }

    if (dsgnResizing && dsgnSelected !== null) {
      applyResize(pos); renderDesigner(); return;
    }

    if (dsgnDrawing && dsgnDrawStart) {
      renderDesigner(makeShapeObj(dsgnDrawStart.x, dsgnDrawStart.y, pos.x, pos.y));
    }
  });

  document.addEventListener('mouseup', e => {
    if (activeMode !== 'designer') return;

    // Finalize dragged pen handle while placing a point
    if (penMouseDown) {
      penMouseDown = false;
      if (penPath.length > 0) {
        const last = penPath[penPath.length - 1];
        if (last.cpOut && Math.hypot(last.cpOut.x - last.x, last.cpOut.y - last.y) < 4) {
          last.cpIn = null; last.cpOut = null; // too small a drag — keep as sharp corner
        }
      }
      renderDesigner(); return;
    }

    // Finalize pen edit handle drag
    if (penEditTarget) {
      dsgnSaveSnapshot();
      penEditTarget = null;
      updateMoveCursor(); renderDesigner(); return;
    }

    if (dsgnMarquee) {
      const mx = Math.min(dsgnMarquee.x1, dsgnMarquee.x2);
      const my = Math.min(dsgnMarquee.y1, dsgnMarquee.y2);
      const mw = Math.abs(dsgnMarquee.x2 - dsgnMarquee.x1);
      const mh = Math.abs(dsgnMarquee.y2 - dsgnMarquee.y1);
      dsgnMarquee = null;
      if (mw > 4 || mh > 4) {
        const hits = dsgnObjects.reduce((acc, obj, i) => {
          const b = getObjBBox(obj);
          if (b.x < mx+mw && b.x+b.w > mx && b.y < my+mh && b.y+b.h > my) acc.push(i);
          return acc;
        }, []);
        dsgnSelectedSet = new Set(hits);
        dsgnSelected = hits.length === 1 ? hits[0] : (hits.length > 1 ? hits[hits.length - 1] : null);
        if (dsgnSelected !== null) syncToolbarToSelection();
        updateToolbarPanels();
      }
      updateMoveCursor(); renderDesigner(); return;
    }

    if (dsgnMultiDragging) {
      dsgnSaveSnapshot();
      dsgnMultiDragging = false; dsgnMultiDragStart = null; dsgnMultiOrigins = [];
      updateMoveCursor(); renderDesigner(); return;
    }

    if (dsgnDragging) {
      dsgnSaveSnapshot();
      dsgnDragging = false; dsgnDragStart = null; dsgnObjOrigin = null;
      updateMoveCursor(); renderDesigner(); return;
    }

    if (dsgnResizing) {
      dsgnSaveSnapshot();
      dsgnResizing = false; dsgnResizeHandle = null; dsgnResizeOrigin = null;
      updateMoveCursor(); renderDesigner(); return;
    }

    if (dsgnDrawing && dsgnDrawStart) {
      const pos = getPos(e);
      dsgnDrawing = false;
      const dx = Math.abs(pos.x - dsgnDrawStart.x), dy = Math.abs(pos.y - dsgnDrawStart.y);
      if (dx > 4 || dy > 4) {
        const obj = makeShapeObj(dsgnDrawStart.x, dsgnDrawStart.y, pos.x, pos.y);
        dsgnSaveSnapshot(); dsgnObjects.push(obj);
        dsgnSelected = dsgnObjects.length - 1;
        syncToolbarToSelection(); updateToolbarPanels();
      }
      dsgnDrawStart = null; renderDesigner();
    }
  });

  /* ──────────────────────────────────────────
     INIT
  ────────────────────────────────────────── */
  resizeCanvas();
  document.getElementById('dsgnStrokeOpts').style.display = 'none';
})();
