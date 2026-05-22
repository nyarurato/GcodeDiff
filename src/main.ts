import './style.css'
import { parseGCode } from './gcodeParser'
import { diffSegments } from './diffEngine'
import { SceneManager } from './scene'
import type { ColorConfig } from './scene'

// ─── シーン初期化 ─────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const scene = new SceneManager(canvas)

// ─── 状態 ─────────────────────────────────────────────────────────────────

let srcA = ''
let srcB = ''

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
      scene.clearAll()
      setStatus('Paste GCode into A and/or B, then click Plot')
      return
    }

    const { a, b, stats } = diffSegments(segsA, segsB)

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

// ─── Plot A ───────────────────────────────────────────────────────────────

document.getElementById('plot-a')?.addEventListener('click', () => {
  const ta = document.getElementById('gcode-a') as HTMLTextAreaElement
  srcA = ta.value.trim()
  if (!srcA) {
    setStatus('GCode A is empty')
    return
  }
  void replot()
})

// ─── Plot B ───────────────────────────────────────────────────────────────

document.getElementById('plot-b')?.addEventListener('click', () => {
  const ta = document.getElementById('gcode-b') as HTMLTextAreaElement
  srcB = ta.value.trim()
  if (!srcB) {
    setStatus('GCode B is empty')
    return
  }
  void replot()
})

// ─── Clear A ──────────────────────────────────────────────────────────────

document.getElementById('clear-a')?.addEventListener('click', () => {
  const ta = document.getElementById('gcode-a') as HTMLTextAreaElement
  ta.value = ''
  srcA = ''
  void replot()
})

// ─── Clear B ──────────────────────────────────────────────────────────────

document.getElementById('clear-b')?.addEventListener('click', () => {
  const ta = document.getElementById('gcode-b') as HTMLTextAreaElement
  ta.value = ''
  srcB = ''
  void replot()
})

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

const darkToggle = document.getElementById('toggle-dark') as HTMLInputElement
darkToggle.addEventListener('change', () => {
  const isDark = darkToggle.checked
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  scene.setTheme(isDark)
})

// ─── Settings: A/B Visibility ─────────────────────────────────────────────

;(document.getElementById('toggle-a') as HTMLInputElement).addEventListener('change', (e) => {
  scene.setVisibleA((e.target as HTMLInputElement).checked)
})

;(document.getElementById('toggle-b') as HTMLInputElement).addEventListener('change', (e) => {
  scene.setVisibleB((e.target as HTMLInputElement).checked)
})

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

COLOR_INPUTS.forEach(({ inputId, dotId, key }) => {
  document.getElementById(inputId)?.addEventListener('input', (e) => {
    const hex = (e.target as HTMLInputElement).value
    scene.setColors({ [key]: hexStrToInt(hex) } as Partial<ColorConfig>)
    const dot = document.getElementById(dotId)
    if (dot) dot.style.background = hex
  })
})
