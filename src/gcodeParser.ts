/**
 * gcode-toolpath ライブラリを使用した GCode パーサー。
 *
 * - G0/G1 直線移動: そのまま Segment に変換
 * - G2/G3 円弧移動: XY/XZ/YZ 平面に対応した補間で line segments に分割
 * - G90/G91, G17/G18/G19, ヘリカル補間は gcode-toolpath が自動追跡
 */

import Toolpath from 'gcode-toolpath'
import type { Vec3, GCodeModal } from 'gcode-toolpath'

export interface Segment {
  /** 始点 [X, Y, Z] */
  from: readonly [number, number, number]
  /** 終点 [X, Y, Z] */
  to: readonly [number, number, number]
  /** G0 なら true（早送り）、G1/G2/G3 なら false */
  isRapid: boolean
  /**
   * diff 比較用キー（座標 3 桁丸め）。
   * 円弧は全補間セグメントが同一キーを持つ（論理単位で diff 比較）。
   */
  key: string
}

// ─── 円弧補間 ─────────────────────────────────────────────────────────────

/** 円一周あたりの補間ステップ数 */
const ARC_STEPS_PER_CIRCLE = 64

type ArcPlane = 'G17' | 'G18' | 'G19'
type Axis = keyof Vec3

/**
 * G2/G3 円弧を line segment の配列に補間する。
 * ヘリカル移動（Z が変化する円弧）にも対応。
 *
 * @param v1          始点
 * @param v2          終点
 * @param v0          円弧中心
 * @param isClockwise G2=true, G3=false
 * @param plane       G17=XY, G18=XZ, G19=YZ
 */
function interpolateArc(
  v1: Vec3,
  v2: Vec3,
  v0: Vec3,
  isClockwise: boolean,
  plane: ArcPlane,
): Array<[Vec3, Vec3]> {
  // 平面に対応する軸を決定
  let ax: Axis, ay: Axis, ah: Axis
  if (plane === 'G17') { ax = 'x'; ay = 'y'; ah = 'z' }
  else if (plane === 'G18') { ax = 'z'; ay = 'x'; ah = 'y' }
  else { ax = 'y'; ay = 'z'; ah = 'x' }

  const cx = v0[ax]
  const cy = v0[ay]
  const startAngle = Math.atan2(v1[ay] - cy, v1[ax] - cx)
  let endAngle = Math.atan2(v2[ay] - cy, v2[ax] - cx)

  // 回転方向に合わせて endAngle を調整
  if (isClockwise) {
    if (endAngle >= startAngle) endAngle -= 2 * Math.PI
  } else {
    if (endAngle <= startAngle) endAngle += 2 * Math.PI
  }

  const spanAngle = Math.abs(endAngle - startAngle)
  const steps = Math.max(4, Math.round((spanAngle / (2 * Math.PI)) * ARC_STEPS_PER_CIRCLE))
  const r = Math.sqrt((v1[ax] - cx) ** 2 + (v1[ay] - cy) ** 2)

  // 補間点を生成
  const pts: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const angle = startAngle + (endAngle - startAngle) * t
    const p = { x: 0, y: 0, z: 0 } as Vec3
    p[ax] = cx + r * Math.cos(angle)
    p[ay] = cy + r * Math.sin(angle)
    p[ah] = v1[ah] + (v2[ah] - v1[ah]) * t // ヘリカル Z 補間
    pts.push(p)
  }

  const result: Array<[Vec3, Vec3]> = []
  for (let i = 0; i < pts.length - 1; i++) {
    result.push([pts[i], pts[i + 1]])
  }
  return result
}

// ─── キー生成 ─────────────────────────────────────────────────────────────

function fv(v: Vec3): string {
  return `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
}

// ─── エクスポート ─────────────────────────────────────────────────────────

/**
 * GCode テキストをパースして Segment 配列を返す (非同期)。
 * @param src GCode 文字列
 */
export function parseGCode(src: string): Promise<Segment[]> {
  return new Promise((resolve, reject) => {
    const segs: Segment[] = []

    const tp = new Toolpath({
      addLine(modal: GCodeModal, v1: Vec3, v2: Vec3) {
        segs.push({
          from: [v1.x, v1.y, v1.z],
          to: [v2.x, v2.y, v2.z],
          isRapid: modal.motion === 'G0',
          key: `${modal.motion}:${fv(v1)}->${fv(v2)}`,
        })
      },

      addArcCurve(modal: GCodeModal, v1: Vec3, v2: Vec3, v0: Vec3) {
        const cw = modal.motion === 'G2'
        const plane = (modal.plane ?? 'G17') as ArcPlane
        // 円弧全体を 1 つのキーで表現 → 全補間セグメントが同一キーを共有
        const key = `${modal.motion}:${fv(v1)}->${fv(v2)}@${fv(v0)}`
        for (const [p1, p2] of interpolateArc(v1, v2, v0, cw, plane)) {
          segs.push({
            from: [p1.x, p1.y, p1.z],
            to: [p2.x, p2.y, p2.z],
            isRapid: false,
            key,
          })
        }
      },
    })

    tp.loadFromString(src, (err: Error | null) => {
      if (err) reject(err)
      else resolve(segs)
    })
  })
}
