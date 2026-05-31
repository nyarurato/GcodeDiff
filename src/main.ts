import './style.css'
import { parseGCode } from './gcodeParser'
import { diffSegments } from './diffEngine'
import type { ClassifiedSegment } from './diffEngine'
import { SceneManager } from './scene'
import type { ColorConfig } from './scene'

// ─── シーン初期化 ─────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const scene = new SceneManager(canvas)

// ─── 状態 ─────────────────────────────────────────────────────────────────

let srcA = ''
let srcB = ''
let classifiedA: ClassifiedSegment[] = []
let classifiedB: ClassifiedSegment[] = []

function getById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

// ─── パネルの開閉 ─────────────────────────────────────────────────────────

document.querySelectorAll<HTMLElement>('.panel-header').forEach((header) => {
  header.addEventListener('click', () => {
    const id = header.dataset['target']
    if (!id) return
    const panel = document.getElementById(id)
    if (!panel) return
    panel.classList.toggle('open')
  })
})

// ─── ステータス表示 ───────────────────────────────────────────────────────

function setStatus(text: string): void {
  const el = document.getElementById('status-text')
  if (el) el.textContent = text
}

// ─── 再描画 ───────────────────────────────────────────────────────────────

/**
 * 現在の srcA / srcB をパース・diff して描画を更新する。
 */
async function replot(): Promise<void> {
  setStatus('Parsing…')
  try {
    const [segsA, segsB] = await Promise.all([
      srcA ? parseGCode(srcA) : Promise.resolve([]),
      srcB ? parseGCode(srcB) : Promise.resolve([]),
    ])

    if (segsA.length === 0 && segsB.length === 0) {
      classifiedA = []
      classifiedB = []
      scene.clearAll()
      setStatus('Paste GCode into A and/or B, then click Plot')
      return
    }

    const { a, b, stats } = diffSegments(segsA, segsB)
    classifiedA = a
    classifiedB = b

    scene.updateA(a)
    scene.updateB(b)

    const parts: string[] = []
    if (segsA.length > 0) parts.push(`A: ${segsA.length} moves`)
    if (segsB.length > 0) parts.push(`B: ${segsB.length} moves`)
    if (segsA.length > 0 && segsB.length > 0) {
      parts.push(`Common: ${stats.common}  Only A: ${stats.onlyA}  Only B: ${stats.onlyB}`)
    }
    setStatus(parts.join('   │   '))
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function setupPlotAndClear(
  plotButtonId: string,
  clearButtonId: string,
  textareaId: string,
  emptyMessage: string,
  setSrc: (text: string) => void,
): void {
  const ta = getById<HTMLTextAreaElement>(textareaId)
  if (!ta) return

  getById<HTMLButtonElement>(plotButtonId)?.addEventListener('click', () => {
    const text = ta.value.trim()
    setSrc(text)
    if (!text) {
      setStatus(emptyMessage)
      return
    }
    void replot()
  })

  getById<HTMLButtonElement>(clearButtonId)?.addEventListener('click', () => {
    ta.value = ''
    setSrc('')
    void replot()
  })
}

setupPlotAndClear('plot-a', 'clear-a', 'gcode-a', 'GCode A is empty', (t) => { srcA = t })
setupPlotAndClear('plot-b', 'clear-b', 'gcode-b', 'GCode B is empty', (t) => { srcB = t })

// ─── Drag & Drop ──────────────────────────────────────────────────────────

/**
 * パネルボディへのファイルドロップでテキストを読み込み、即 Plot する。
 * @param panelBodyId  ドロップ対象要素の id
 * @param textareaId   テキストを書き込む textarea の id
 * @param setter       srcA / srcB を更新するコールバック
 */
function setupDrop(
  panelBodyId: string,
  textareaId: string,
  setter: (text: string) => void,
): void {
  const zone = document.getElementById(panelBodyId)
  const ta = document.getElementById(textareaId) as HTMLTextAreaElement | null
  if (!zone || !ta) return

  zone.addEventListener('dragenter', (e) => {
    e.preventDefault()
    zone.classList.add('drag-over')
  })

  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    // ファイルのみ受け付ける
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })

  zone.addEventListener('dragleave', (e) => {
    // zone の外に出たときだけ解除（子要素への移動では解除しない）
    if (!zone.contains(e.relatedTarget as Node | null)) {
      zone.classList.remove('drag-over')
    }
  })

  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('drag-over')

    const file = e.dataTransfer?.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const text = (reader.result as string).trim()
      ta.value = text
      setter(text)
      void replot()
    }
    reader.readAsText(file)
  })
}

setupDrop('panel-body-a', 'gcode-a', (t) => { srcA = t })
setupDrop('panel-body-b', 'gcode-b', (t) => { srcB = t })

// ─── Settings: Dark Mode ──────────────────────────────────────────────────

const darkToggle = getById<HTMLInputElement>('toggle-dark')
darkToggle?.addEventListener('change', () => {
  const isDark = !!darkToggle.checked
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  scene.setTheme(isDark)
})

// ─── Settings: A/B Visibility ─────────────────────────────────────────────

function bindToggle(id: string, onChange: (checked: boolean) => void): void {
  const input = getById<HTMLInputElement>(id)
  input?.addEventListener('change', () => {
    onChange(input.checked)
  })
}

bindToggle('toggle-a', (checked) => { scene.setVisibleA(checked) })
bindToggle('toggle-b', (checked) => { scene.setVisibleB(checked) })

// ─── Settings: Color Pickers ──────────────────────────────────────────────

function hexStrToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

const COLOR_INPUTS: Array<{
  inputId: string
  dotId: string
  key: keyof ColorConfig
}> = [
  { inputId: 'color-common',  dotId: 'legend-common',  key: 'common' },
  { inputId: 'color-only-a',  dotId: 'legend-only-a',  key: 'onlyA' },
  { inputId: 'color-only-b',  dotId: 'legend-only-b',  key: 'onlyB' },
  { inputId: 'color-rapid',   dotId: 'legend-rapid',   key: 'rapid' },
]

function bindColorInput(inputId: string, onInput: (hex: string) => void): void {
  const input = getById<HTMLInputElement>(inputId)
  input?.addEventListener('input', () => {
    onInput(input.value)
  })
}

COLOR_INPUTS.forEach(({ inputId, dotId, key }) => {
  bindColorInput(inputId, (hex) => {
    scene.setColors({ [key]: hexStrToInt(hex) } as Partial<ColorConfig>)
    const dot = getById<HTMLElement>(dotId)
    if (dot) dot.style.background = hex
  })
})

// ─── Cursor Tracking: 3D マーカー ──────────────────────────────────────────

const taA = getById<HTMLTextAreaElement>('gcode-a')
const taB = getById<HTMLTextAreaElement>('gcode-b')

/** textarea のカーソルが居る行番号（0 始まり）を返す */
function getLineNum(ta: HTMLTextAreaElement): number {
  return ta.value.substring(0, ta.selectionStart).split('\n').length - 1
}

function findLastSegmentAtOrBeforeLine(
  segs: ClassifiedSegment[],
  lineNum: number,
): ClassifiedSegment | null {
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i]
    if (seg.segment.lineIndex <= lineNum) return seg
  }
  return null
}

/** lineNum 以前の最後のセグメントの終点にマーカーを移動 */
function updateCursorMarker(segs: ClassifiedSegment[], lineNum: number): void {
  const found = findLastSegmentAtOrBeforeLine(segs, lineNum)
  scene.showCursorMarker(found ? found.segment.to : null)
}

document.addEventListener('selectionchange', () => {
  const active = document.activeElement
  if (taA && active === taA && classifiedA.length > 0) {
    updateCursorMarker(classifiedA, getLineNum(taA))
  } else if (taB && active === taB && classifiedB.length > 0) {
    updateCursorMarker(classifiedB, getLineNum(taB))
  }
})

taA?.addEventListener('blur', () => { scene.showCursorMarker(null) })
taB?.addEventListener('blur', () => { scene.showCursorMarker(null) })

// ─── Settings: Cursor Marker ──────────────────────────────────────────

bindColorInput('marker-color', (hex) => {
  scene.setMarkerConfig(undefined, hexStrToInt(hex))
})

const markerSizeInput = getById<HTMLInputElement>('marker-size')
markerSizeInput?.addEventListener('input', () => {
  scene.setMarkerConfig(Number(markerSizeInput.value))
})
