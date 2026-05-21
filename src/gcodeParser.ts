/**
 * 最小限の GCode パーサー
 * G0/G1 の直線移動を抽出し、3D セグメントのリストを返す。
 * G90/G91 (絶対/相対座標) に対応。G2/G3 は現在位置のみ更新してスキップ。
 */

export interface Segment {
  /** 始点 [X, Y, Z] */
  from: readonly [number, number, number]
  /** 終点 [X, Y, Z] */
  to: readonly [number, number, number]
  /** G0 なら true（早送り）、G1 なら false（切削送り） */
  isRapid: boolean
  /**
   * diff 比較用の正規化キー。
   * 送り速度 (F) を除いた座標ベースの文字列。
   */
  key: string
}

// ─── 内部ユーティリティ ────────────────────────────────────────────────────

/** 行から `;` 以降と `(…)` コメントを除去して大文字化 */
function stripComment(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .trim()
    .toUpperCase()
}

/** 行中の指定軸の値を返す。存在しなければ fallback */
function axisValue(line: string, axis: string, fallback: number): number {
  const m = new RegExp(`${axis}([+-]?\\d*\\.?\\d+)`, 'i').exec(line)
  return m ? parseFloat(m[1]) : fallback
}

/** diff 比較用キー生成（座標を 3 桁丸め、F・S・E を除外） */
function buildKey(
  cmd: 0 | 1,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): string {
  const fmt = (v: number) => v.toFixed(3)
  return (
    `G${cmd}` +
    `:${fmt(from[0])},${fmt(from[1])},${fmt(from[2])}` +
    `->${fmt(to[0])},${fmt(to[1])},${fmt(to[2])}`
  )
}

// ─── エクスポート ─────────────────────────────────────────────────────────

/**
 * GCode テキストをパースして Segment 配列を返す。
 * @param src GCode 文字列
 */
export function parseGCode(src: string): Segment[] {
  const lines = src.split(/\r?\n/)
  const segments: Segment[] = []

  let cx = 0,
    cy = 0,
    cz = 0 // 現在位置
  let absMode = true // G90: true, G91: false

  for (const raw of lines) {
    const line = stripComment(raw)
    if (!line) continue

    // ── 座標モード切替 ─────────────────────────────────────────
    if (/^G90\b/.test(line)) {
      absMode = true
      continue
    }
    if (/^G91\b/.test(line)) {
      absMode = false
      continue
    }

    // ── G0 / G1 ────────────────────────────────────────────────
    const moveM = /^G([01])\b/.exec(line)
    if (moveM) {
      const cmd = parseInt(moveM[1], 10) as 0 | 1
      const fx = cx,
        fy = cy,
        fz = cz

      if (absMode) {
        cx = axisValue(line, 'X', cx)
        cy = axisValue(line, 'Y', cy)
        cz = axisValue(line, 'Z', cz)
      } else {
        cx += axisValue(line, 'X', 0)
        cy += axisValue(line, 'Y', 0)
        cz += axisValue(line, 'Z', 0)
      }

      // 位置変化がある場合のみ記録
      if (fx !== cx || fy !== cy || fz !== cz) {
        const from = [fx, fy, fz] as const
        const to = [cx, cy, cz] as const
        segments.push({
          from,
          to,
          isRapid: cmd === 0,
          key: buildKey(cmd, from, to),
        })
      }
      continue
    }

    // ── G2 / G3 (円弧): 終点座標だけ更新してスキップ ──────────
    const arcM = /^G([23])\b/.exec(line)
    if (arcM) {
      if (absMode) {
        cx = axisValue(line, 'X', cx)
        cy = axisValue(line, 'Y', cy)
        cz = axisValue(line, 'Z', cz)
      } else {
        cx += axisValue(line, 'X', 0)
        cy += axisValue(line, 'Y', 0)
        cz += axisValue(line, 'Z', 0)
      }
    }
  }

  return segments
}
