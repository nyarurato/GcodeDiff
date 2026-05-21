import type { Segment } from './gcodeParser'

/**
 * セグメントの diff ステータス。
 * - `common`  : A・B 両方に存在する
 * - `only-a`  : A にのみ存在する
 * - `only-b`  : B にのみ存在する
 */
export type DiffStatus = 'common' | 'only-a' | 'only-b'

export interface ClassifiedSegment {
  segment: Segment
  status: DiffStatus
}

export interface DiffResult {
  /** GCode A の分類済みセグメント群 */
  a: ClassifiedSegment[]
  /** GCode B の分類済みセグメント群 */
  b: ClassifiedSegment[]
  stats: {
    common: number
    onlyA: number
    onlyB: number
  }
}

/**
 * 2 つの Segment 配列を比較して diff 結果を返す。
 *
 * 比較は Segment.key（コマンド種別 + 始点/終点座標）による集合一致判定。
 * 同一キーが A・B 両方に存在すれば "common"、片方のみなら "only-a/b"。
 */
export function diffSegments(segA: Segment[], segB: Segment[]): DiffResult {
  const keysB = new Set(segB.map((s) => s.key))
  const keysA = new Set(segA.map((s) => s.key))

  const a: ClassifiedSegment[] = segA.map((segment) => ({
    segment,
    status: keysB.has(segment.key) ? 'common' : 'only-a',
  }))

  const b: ClassifiedSegment[] = segB.map((segment) => ({
    segment,
    status: keysA.has(segment.key) ? 'common' : 'only-b',
  }))

  const common = a.filter((c) => c.status === 'common').length
  const onlyA = a.filter((c) => c.status === 'only-a').length
  const onlyB = b.filter((c) => c.status === 'only-b').length

  return { a, b, stats: { common, onlyA, onlyB } }
}
