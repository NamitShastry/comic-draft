# Comic Page Composer (Shastry Comics)

A client-side tool that turns your panel artwork, dialogue, and narration into a finished comic/graphic-novel page — with manual drawing, multiple content elements per panel, advanced bubble styles, a page-wide font system, and character-safe automatic placement. No AI, no backend, no accounts; everything runs locally in your browser.

## How to run

1. Open this folder in VS Code.
2. Right-click `index.html` and choose **Open with Live Server** (or just double-click `index.html`).

## What's new in this update

### Manual & assisted drawing
Every panel has a **Draw Manually** option (shown when empty, or "Draw New" once an image exists). It opens a real drawing canvas with:
- **Pencil**, **Brush**, and **Eraser** tools with adjustable color and size
- **Assisted shapes** — Line, Rectangle, and Ellipse/Circle tools that draw a clean geometric shape from a click-drag instead of freehand (a deliberately simple, honest form of "assisted drawing" rather than a fake AI shape-recognizer)
- Stroke-by-stroke **Undo/Redo** (each pencil stroke, eraser pass, or shape is its own undoable step)
- **Clear** with a confirmation prompt so artwork is never destroyed accidentally
- **Apply Drawing**, which rasterizes the canvas and feeds it through the exact same image pipeline as an upload — a drawing becomes an ordinary panel image afterward, with all the same protect-area, pan/zoom, and safe-placement behavior.

### Multiple dialogue + multiple narration per panel
Panels no longer hold a single text field. Each panel has a `contentElements` list — add as many **+ Add Dialogue** / **+ Add Narration** cards as you need (up to 8 per panel), each with its own type, bubble/narration style, color, text, and font, all independently editable, duplicable, and deletable. This carries through generation, editing, reordering, and export without ever mixing one panel's content into another's.

### Advanced dialogue balloons
Bubble Style now includes **Round, Oval, Cloud, Rounded Rectangle, Jagged, Burst/Shout, Whisper, and Thought** — real distinct shapes (canvas path geometry, not palette swaps), including a Thought bubble that trails small circles toward the speaker instead of a pointed tail.

### Font system with real inheritance tracking
Page Settings has a **Default Comic Font** and **Default Font Size**. Every new dialogue/narration element inherits it. Change the global default afterward and every element still marked "inherited" updates automatically — but any element where you've explicitly picked its own font/size is left alone (a "Use Default Font" button lets you re-attach it to the default later). This inherited/custom distinction is tracked per element, not just visually.

### Background color bug fix
`customBg` is now initialized in state from the start (previously undefined until the color input was touched), the dropdown syncs the current swatch value the instant "Custom" is selected, and both `input` and `change` events are bound to the color picker so the choice reliably reaches state, the preview, generation, and export on every platform.

### Character-safe placement, extended
The existing negative-space/protected-area system (real pixel-busyness analysis + manual "Protect Character Area" rectangles) now also prevents **content elements from overlapping each other** — both during automatic generation (each new bubble avoids already-placed siblings, not just protected regions) and during manual dragging in the editor (Character Safe Mode blocks a drop that collides with either a protected area or another bubble).

## Everything from before still works
Panel add/remove/reorder/independent-scrolling, image upload/replace/remove, page size system (ISO + comic + custom, real mm/DPI math), the interactive editor (drag/resize/pan/zoom, undo/redo, tail dragging), and PNG/JPEG export reading the live edited state — none of it was touched structurally, only extended.

## What it does NOT do

- No AI image generation or editing — artwork (uploaded or drawn) is only repositioned/scaled, never redrawn or regenerated.
- No AI text rewriting — dialogue and narration render exactly as typed.
- No real face/person detection (the browser has no reliable built-in model) — negative-space placement uses genuine pixel-based heuristics plus your manual protected areas, described honestly rather than oversold.
- No servers, accounts, or external API calls.

## Files

- `index.html` — panel inputs, page/font settings, editor toolbar, editable page stage, properties panel, drawing modal
- `style.css` — all visual styling, including the new content-element cards, drawing modal, and extended bubble shapes
- `script.js` — source panel/content-element state, page-size system, image-complexity analysis, safe-placement engine, drawing tools, editable `pageState` model, interactive DOM editor, undo/redo, canvas exporter
