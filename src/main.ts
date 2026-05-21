import './style.css'
import { parseGCode } from './gcodeParser'
import { diffSegments } from './diffEngine'
import { SceneManager } from './scene'

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
  setStatus('解析中…')
  try {
    const [segsA, segsB] = await Promise.all([
      srcA ? parseGCode(srcA) : Promise.resolve([]),
      srcB ? parseGCode(srcB) : Promise.resolve([]),
    ])

    if (segsA.length === 0 && segsB.length === 0) {
      scene.clearAll()
      setStatus('GCode A/B を入力して Plot ボタンを押してください')
      return
    }

    const { a, b, stats } = diffSegments(segsA, segsB)

    scene.updateA(a)
    scene.updateB(b)

    const parts: string[] = []
    if (segsA.length > 0) parts.push(`A: ${segsA.length} moves`)
    if (segsB.length > 0) parts.push(`B: ${segsB.length} moves`)
    if (segsA.length > 0 && segsB.length > 0) {
      parts.push(`共通: ${stats.common}  A のみ: ${stats.onlyA}  B のみ: ${stats.onlyB}`)
    }
    setStatus(parts.join('   │   '))
  } catch (err) {
    setStatus(`エラー: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── Plot A ───────────────────────────────────────────────────────────────

document.getElementById('plot-a')?.addEventListener('click', () => {
  const ta = document.getElementById('gcode-a') as HTMLTextAreaElement
  srcA = ta.value.trim()
  if (!srcA) {
    setStatus('GCode A が空です')
    return
  }
  void replot()
})

// ─── Plot B ───────────────────────────────────────────────────────────────

document.getElementById('plot-b')?.addEventListener('click', () => {
  const ta = document.getElementById('gcode-b') as HTMLTextAreaElement
  srcB = ta.value.trim()
  if (!srcB) {
    setStatus('GCode B が空です')
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
