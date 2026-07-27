import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { ClassifiedSegment, DiffStatus } from './diffEngine'

// ─── カラー設定 ────────────────────────────────────────────────────────────

export interface ColorConfig {
  common: number  // Common segments
  onlyA:  number  // Only in A
  onlyB:  number  // Only in B
  rapid:  number  // G0 rapid moves
}

export const DEFAULT_COLORS: ColorConfig = {
  common: 0x00e676,
  onlyA:  0x448aff,
  onlyB:  0xff5252,
  rapid:  0x2a2a3a,
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────

/**
 * GCode 座標 (X,Y,Z) を Three.js 座標に変換。
 * GCode: X=右, Y=奥, Z=上  →  Three.js: X=右, Y=上, Z=手前
 */
function gToT(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y)
}

/**
 * ClassifiedSegment 配列から色付きファットライン (LineSegments2) を生成。
 * Rapid (G0) は細く、かつ depthTest=false で常に最前面に描画する。
 *
 * @param widthPx   線幅 (px)。Rapid は細くするため呼び出し側で小さくする。
 * @param onTop     true の場合 depthTest を無効化し最前面に描画 (G0 用)。
 */
function buildLineSegments(
  segments: ClassifiedSegment[],
  cfg: ColorConfig,
  opts: { widthPx: number; onTop?: boolean; commonColorOverride?: number },
): LineSegments2 {
  const colorMap: Record<DiffStatus, number> = {
    common:   opts.commonColorOverride ?? cfg.common,
    'only-a': cfg.onlyA,
    'only-b': cfg.onlyB,
  }
  const positions: number[] = []
  const colors: number[] = []
  const col = new THREE.Color()

  for (const { segment: seg, status } of segments) {
    col.setHex(seg.isRapid ? cfg.rapid : colorMap[status])
    const from = gToT(...seg.from)
    const to   = gToT(...seg.to)
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z)
    colors.push(col.r, col.g, col.b, col.r, col.g, col.b)
  }

  const geo = new LineSegmentsGeometry()
  geo.setPositions(positions)
  geo.setColors(colors)

  const mat = new LineMaterial({
    vertexColors: true,
    worldUnits: false,
    linewidth: opts.widthPx,
    depthTest: !opts.onTop,
    transparent: !!opts.onTop,
  })
  mat.resolution.set(window.innerWidth, window.innerHeight)

  const line = new LineSegments2(geo, mat)
  line.computeLineDistances()
  line.renderOrder = opts.onTop ? 10 : 0
  return line
}

function makeGrid(dark: boolean): THREE.GridHelper {
  return dark
    ? new THREE.GridHelper(500, 50, 0x1a1c2a, 0x14151f)
    : new THREE.GridHelper(500, 50, 0x999999, 0xcccccc)
}

// ─── SceneManager ─────────────────────────────────────────────────────────

export class SceneManager {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls

  private readonly viewCubeScene = new THREE.Scene()
  private readonly viewCubeCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 20)
  private readonly viewCube = new THREE.Mesh()
  private viewCubeMaterials: THREE.MeshBasicMaterial[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()

  private readonly groupA = new THREE.Group()
  private readonly groupB = new THREE.Group()
  private readonly groupCommon = new THREE.Group()
  private grid: THREE.GridHelper

  // 現在のカラー設定と最後に描画したセグメント（色変更時の再描画用）
  private colors: ColorConfig = { ...DEFAULT_COLORS }
  private lastA: ClassifiedSegment[] = []
  private lastB: ClassifiedSegment[] = []

  // 表示設定：A/B グループの表示と、Common セグメントの表示
  private showA = true
  private showB = true
  private showCommon = true
  private showRapid = true

  private animId = 0
  private cursorMarker: THREE.Object3D | null = null

  // 再生状態：A/B どちらを再生中か、一時停止中か、進捗など
  private playSide: 'A' | 'B' | null = null
  private playIndex = 0
  private playAccum = 0          // 現在セグメント内の進行度 (0..1)
  private playSpeed = 20         // 秒あたりセグメント数
  private playPaused = false
  private playLastTime = 0

  /** 再生状態が変化したときに呼ばれるコールバック（UI 同期用） */
  onPlaybackStateChange: ((state: { side: 'A' | 'B' | null; paused: boolean }) => void) | null = null
  private markerSize: number = 2
  private markerColor: number = 0xffffff

  private readonly viewCubeSizePx = 96
  private readonly viewCubeMarginRightPx = 16
  private readonly viewCubeMarginTopPx = 60
  private hoveredFaces = new Set<number>()

  // 線幅 (px)。Rapid (G0) は細くして常に最前面に描画する。
  private readonly normalWidthPx = 2
  private readonly rapidWidthPx = 1

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    // ── レンダラー
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x0d0e14)

    // ── シーン
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x0d0e14, 0.0004)

    this.grid = makeGrid(true)
    this.scene.add(this.grid)

    // 軸ヘルパー: depthTest=false で常にグリッド手前に表示
    const axes = new THREE.AxesHelper(30)
    axes.renderOrder = 1
    if (axes.material instanceof THREE.Material) {
      axes.material.depthTest = false
    } else if (Array.isArray(axes.material)) {
      axes.material.forEach((m) => { m.depthTest = false })
    }
    this.scene.add(axes)

    this.scene.add(this.groupA)
    this.scene.add(this.groupB)
    this.scene.add(this.groupCommon)

    // ── カメラ
    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 50000,
    )
    this.camera.position.set(0, 120, 200)
    this.camera.lookAt(0, 0, 0)

    // ── コントロール
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.minDistance = 1
    this.controls.maxDistance = 20000
    this.controls.screenSpacePanning = true

    // ── ViewCube
    this.setupViewCube()

    window.addEventListener('resize', this.onResize)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.animate()
  }

  // ── レンダーループ ────────────────────────────────────────────────────

  private readonly animate = (): void => {
    this.animId = requestAnimationFrame(this.animate)
    this.controls.update()
    // 再生進行（A か B のどちらか一方のみ）
    this.advancePlayback()
    // カーソルマーカーをカメラ距離に比例したサイズに更新
    if (this.cursorMarker) {
      const dist = this.camera.position.distanceTo(this.cursorMarker.position)
      this.cursorMarker.scale.setScalar(Math.max(0.2, dist * this.markerSize * 0.004))
    }

    // 毎フレーム先頭でメイン描画用の viewport/scissor 状態に戻す。
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
    this.updateViewCubeHighlight()
    this.syncViewCubeOrientation()
    this.renderer.render(this.scene, this.camera)
    this.renderViewCubeOverlay()
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    // ファットラインの線幅を正しく保つため解像度を同期
    this.syncLineMaterialResolution()
  }

  private syncLineMaterialResolution(): void {
    const sync = (group: THREE.Group): void => {
      group.traverse((obj) => {
        const ls = obj as unknown as LineSegments2
        if (ls.isLineSegments2 && ls.material instanceof LineMaterial) {
          ls.material.resolution.set(window.innerWidth, window.innerHeight)
        }
      })
    }
    sync(this.groupA)
    sync(this.groupB)
    sync(this.groupCommon)
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    const dir = this.pickViewCubeDirectionFromPointer(ev)
    if (!dir) return
    this.applyCameraDirection(dir)
  }

  private readonly onPointerMove = (ev: PointerEvent): void => {
    const dir = this.pickViewCubeDirectionFromPointer(ev)
    this.hoveredFaces = dir ? this.faceIndicesFromDirection(dir) : new Set<number>()
    this.updateViewCubeHighlight()
  }

  private readonly onPointerLeave = (): void => {
    if (this.hoveredFaces.size === 0) return
    this.hoveredFaces.clear()
    this.updateViewCubeHighlight()
  }

  private pickViewCubeDirectionFromPointer(ev: PointerEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    const viewport = this.getViewCubeViewport(rect.width, rect.height)

    const inCube =
      x >= viewport.left
      && x <= viewport.left + viewport.size
      && y >= viewport.top
      && y <= viewport.top + viewport.size
    if (!inCube) return null

    this.ndc.set(
      ((x - viewport.left) / viewport.size) * 2 - 1,
      -(((y - viewport.top) / viewport.size) * 2 - 1),
    )
    this.raycaster.setFromCamera(this.ndc, this.viewCubeCamera)
    const hit = this.raycaster.intersectObject(this.viewCube, false)[0]
    if (!hit || hit.face?.materialIndex === undefined) return null

    return this.directionFromHit(hit)
  }

  private setupViewCube(): void {
    this.viewCubeCamera.position.set(0, 0, 4)
    this.viewCubeCamera.lookAt(0, 0, 0)

    const mat = (hex: number, label: string): THREE.MeshBasicMaterial => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = `#${hex.toString(16).padStart(6, '0')}`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 8
        ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8)
        ctx.fillStyle = '#0e1118'
        ctx.font = '700 54px Segoe UI'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, canvas.width / 2, canvas.height / 2)
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      return new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.95,
      })
    }
    const materials = [
      mat(0xff8a80, 'RIGHT'), // +X right
      mat(0x82b1ff, 'LEFT'),  // -X left
      mat(0x69f0ae, 'TOP'),   // +Y top
      mat(0xffe082, 'BOTTOM'),// -Y bottom
      mat(0xb388ff, 'FRONT'), // +Z front
      mat(0x80deea, 'BACK'),  // -Z back
    ]
    this.viewCubeMaterials = materials

    this.viewCube.geometry = new THREE.BoxGeometry(1.8, 1.8, 1.8)
    this.viewCube.material = materials
    this.viewCubeScene.add(this.viewCube)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.viewCube.geometry),
      new THREE.LineBasicMaterial({ color: 0x101318 }),
    )
    this.viewCube.add(edges)

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({
        color: 0x0b0d12,
        transparent: true,
        opacity: 0.28,
        depthTest: false,
      }),
    )
    backdrop.position.z = -1.2
    this.viewCubeScene.add(backdrop)
  }

  private syncViewCubeOrientation(): void {
    this.viewCube.quaternion.copy(this.camera.quaternion).invert()
  }

  private renderViewCubeOverlay(): void {
    const viewport = this.getViewCubeViewport(window.innerWidth, window.innerHeight)
    const yFromBottom = window.innerHeight - (viewport.top + viewport.size)
    const prevAutoClear = this.renderer.autoClear

    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.setScissorTest(true)
    this.renderer.setViewport(viewport.left, yFromBottom, viewport.size, viewport.size)
    this.renderer.setScissor(viewport.left, yFromBottom, viewport.size, viewport.size)
    this.renderer.render(this.viewCubeScene, this.viewCubeCamera)

    // オーバーレイ描画で変更したレンダラー状態を必ず復元する。
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
    this.renderer.setScissor(0, 0, window.innerWidth, window.innerHeight)
    this.renderer.autoClear = prevAutoClear
  }

  private getViewCubeViewport(w: number, h: number): { left: number; top: number; size: number } {
    const size = this.viewCubeSizePx
    const left = Math.max(0, w - size - this.viewCubeMarginRightPx)
    const top = this.viewCubeMarginTopPx
    return { left, top: Math.min(top, Math.max(0, h - size)), size }
  }

  private directionFromFaceIndex(faceIndex: number): THREE.Vector3 {
    switch (faceIndex) {
      case 0: return new THREE.Vector3(1, 0, 0)
      case 1: return new THREE.Vector3(-1, 0, 0)
      case 2: return new THREE.Vector3(0, 1, 0)
      case 3: return new THREE.Vector3(0, -1, 0)
      case 4: return new THREE.Vector3(0, 0, 1)
      case 5: return new THREE.Vector3(0, 0, -1)
      default: return new THREE.Vector3(1, 0, 0)
    }
  }

  private directionFromHit(hit: THREE.Intersection<THREE.Object3D>): THREE.Vector3 {
    const faceIndex = hit.face?.materialIndex
    if (faceIndex === undefined) return new THREE.Vector3(1, 0, 0)

    const base = this.directionFromFaceIndex(faceIndex)
    const local = this.viewCube.worldToLocal(hit.point.clone())
    const half = 0.9 // BoxGeometry(1.8)
    const nx = THREE.MathUtils.clamp(local.x / half, -1, 1)
    const ny = THREE.MathUtils.clamp(local.y / half, -1, 1)
    const nz = THREE.MathUtils.clamp(local.z / half, -1, 1)

    const ax = Math.abs(nx)
    const ay = Math.abs(ny)
    const az = Math.abs(nz)
    const maxA = Math.max(ax, ay, az)
    const edgeThreshold = 0.18
    const dominance = 0.52

    const dir = new THREE.Vector3(0, 0, 0)
    if (ax > dominance && maxA - ax <= edgeThreshold) dir.x = Math.sign(nx)
    if (ay > dominance && maxA - ay <= edgeThreshold) dir.y = Math.sign(ny)
    if (az > dominance && maxA - az <= edgeThreshold) dir.z = Math.sign(nz)

    if (dir.lengthSq() === 0) return base
    return dir.normalize()
  }

  private faceIndicesFromDirection(dir: THREE.Vector3): Set<number> {
    const faces = new Set<number>()
    const eps = 0.2
    if (dir.x > eps) faces.add(0)
    if (dir.x < -eps) faces.add(1)
    if (dir.y > eps) faces.add(2)
    if (dir.y < -eps) faces.add(3)
    if (dir.z > eps) faces.add(4)
    if (dir.z < -eps) faces.add(5)
    return faces
  }

  private updateViewCubeHighlight(): void {
    const hasHover = this.hoveredFaces.size > 0
    for (let i = 0; i < this.viewCubeMaterials.length; i++) {
      const m = this.viewCubeMaterials[i]
      const highlighted = this.hoveredFaces.has(i)
      if (highlighted) {
        m.opacity = 1
        m.color.setHex(0xfff7cc)
      } else if (hasHover) {
        // ホバー中は非対象面を暗くして判定面を強調する
        m.opacity = 0.42
        m.color.setHex(0x606674)
      } else {
        m.opacity = 0.95
        m.color.setHex(0xffffff)
      }
      m.needsUpdate = true
    }
  }

  private applyCameraDirection(dir: THREE.Vector3): void {
    const target = this.controls.target.clone()
    const distance = Math.max(1, this.camera.position.distanceTo(target))
    const unitDir = dir.clone().normalize()

    // 極点(真上/真下)では OrbitControls のドラッグ方向が反転しやすいため、
    // up ベクトルは常に Y 軸固定のまま微小オフセットで特異点を回避する。
    if (Math.abs(unitDir.y) > 0.95) {
      unitDir.z += unitDir.y > 0 ? -0.001 : 0.001
      unitDir.normalize()
    }

    const nextPos = target.clone().add(unitDir.multiplyScalar(distance))
    this.camera.up.set(0, 1, 0)
    this.camera.position.copy(nextPos)
    this.camera.lookAt(target)
    this.controls.update()
  }

  // ── 公開 API ─────────────────────────────────────────────────────────

  updateA(segments: ClassifiedSegment[]): void {
    this.lastA = segments
    this.refresh()
    if (segments.length > 0) this.fitView()
  }

  updateB(segments: ClassifiedSegment[]): void {
    this.lastB = segments
    this.refresh()
    if (segments.length > 0) this.fitView()
  }

  clearAll(): void {
    this.stop()
    this.lastA = []
    this.lastB = []
    this.clearGroup(this.groupA)
    this.clearGroup(this.groupB)
    this.clearGroup(this.groupCommon)
  }

  /** A グループの表示/非表示 */
  setVisibleA(visible: boolean): void {
    this.showA = visible
    this.refresh()
  }

  /** B グループの表示/非表示 */
  setVisibleB(visible: boolean): void {
    this.showB = visible
    this.refresh()
  }

  /** Common 表示の ON/OFF。OFF 時は common セグメントを A/B に色分けして描画。 */
  setVisibleCommon(visible: boolean): void {
    this.showCommon = visible
    this.refresh()
  }

  /** G0 Rapid Move の表示/非表示 */
  setVisibleRapid(visible: boolean): void {
    this.showRapid = visible
    this.refresh()
  }

  /**
   * 表示設定 (showA / showB / showCommon) と lastA/lastB から各グループを再構築。
   *
   * - Common ON : common 線は groupCommon にまとめて描画（共通 ON なら A/B が
   *   OFF でも表示される）。only-a/only-b は各グループに表示。
   * - Common OFF: common 線を A/B 各グループにのみ-a/のみ-b 色で描画（パスは維持）。
   */
  private refresh(): void {
    if (this.showCommon) {
      // common は専用グループ、only-* は各グループに分割
      this.renderGroup(this.groupCommon, this.lastA.filter((s) => s.status === 'common'))
      this.renderGroup(this.groupA, this.lastA.filter((s) => s.status === 'only-a'))
      this.renderGroup(this.groupB, this.lastB.filter((s) => s.status === 'only-b'))
    } else {
      // common は A/B にのみ色で描画（groupCommon は空）
      this.renderGroup(this.groupCommon, [])
      this.renderGroup(this.groupA, this.lastA, this.colors.onlyA)
      this.renderGroup(this.groupB, this.lastB, this.colors.onlyB)
    }
    this.groupA.visible = this.showA
    this.groupB.visible = this.showB
    this.groupCommon.visible = this.showCommon
  }

  /**
   * カーソル位置の 3D マーカーを表示。pos=null で非表示。
   * 常に最前面にレンダリングされるピクセル定サイズの白点。
   */
  showCursorMarker(pos: readonly [number, number, number] | null): void {
    if (this.cursorMarker) {
      this.scene.remove(this.cursorMarker)
      const mesh = this.cursorMarker as THREE.Mesh
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      this.cursorMarker = null
    }
    if (!pos) return

    const tp = gToT(pos[0], pos[1], pos[2])
    const geo = new THREE.SphereGeometry(1, 10, 6)
    const mat = new THREE.MeshBasicMaterial({
      color: this.markerColor,
      depthTest: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(tp)
    mesh.renderOrder = 2
    this.cursorMarker = mesh
    this.scene.add(this.cursorMarker)
  }

  /** カーソルマーカーのサイズ(1-10)と色を更新 */
  setMarkerConfig(size?: number, color?: number): void {
    if (size !== undefined) this.markerSize = size
    if (color !== undefined) {
      this.markerColor = color
      if (this.cursorMarker) {
        const mat = (this.cursorMarker as THREE.Mesh).material as THREE.MeshBasicMaterial
        mat.color.setHex(color)
      }
    }
  }

  // ── 再生制御 ───────────────────────────────────────────────────────

  /** 再生速度を「秒あたりセグメント数」で設定 */
  setPlaySpeed(segmentsPerSecond: number): void {
    this.playSpeed = Math.max(0.1, segmentsPerSecond)
  }

  /** 指定側の再生を開始（相手側が再生中なら無視） */
  play(side: 'A' | 'B'): void {
    if (this.playSide !== null && this.playSide !== side) return
    const segs = side === 'A' ? this.lastA : this.lastB
    if (segs.length === 0) return
    if (this.playSide !== side) {
      this.playSide = side
      this.playIndex = 0
      this.playAccum = 0
    }
    this.playPaused = false
    this.playLastTime = performance.now()
    this.emitPlaybackState()
  }

  /** 一時停止（再生中のみ有効） */
  pause(): void {
    if (this.playSide === null) return
    this.playPaused = true
    this.emitPlaybackState()
  }

  /** 停止：再生を終了しマーカーを消す */
  stop(): void {
    this.playSide = null
    this.playPaused = false
    this.playIndex = 0
    this.playAccum = 0
    this.showCursorMarker(null)
    this.emitPlaybackState()
  }

  private emitPlaybackState(): void {
    this.onPlaybackStateChange?.({ side: this.playSide, paused: this.playPaused })
  }

  /** 毎フレーム呼ばれ、進行中の再生を進める */
  private advancePlayback(): void {
    if (this.playSide === null || this.playPaused) return

    const segs = this.playSide === 'A' ? this.lastA : this.lastB
    if (segs.length === 0) { this.stop(); return }

    const now = performance.now()
    const dt = Math.min(0.1, (now - this.playLastTime) / 1000)
    this.playLastTime = now

    this.playAccum += dt * this.playSpeed
    while (this.playAccum >= 1) {
      this.playAccum -= 1
      this.playIndex++
      if (this.playIndex >= segs.length) {
        // 最後まで再生したら停止
        this.stop()
        return
      }
    }

    // 現在のセグメントを使ってマーカーを表示（終点をたどる）
    const seg = segs[this.playIndex]
    this.showCursorMarker(seg.segment.to)
  }

  /** 凡例カラーを部分更新して即再描画 */
  setColors(partial: Partial<ColorConfig>): void {
    this.colors = { ...this.colors, ...partial }
    this.refresh()
  }

  /** ダーク/ライトテーマ切替（背景・フォグ・グリッドを更新） */
  setTheme(isDark: boolean): void {
    const bg = isDark ? 0x0d0e14 : 0xeceff5
    this.renderer.setClearColor(bg)
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(bg)
    }
    // グリッド差し替え
    this.scene.remove(this.grid)
    ;(this.grid.material as THREE.Material).dispose()
    this.grid.geometry.dispose()
    this.grid = makeGrid(isDark)
    this.scene.add(this.grid)
  }

  // ── 内部ユーティリティ ────────────────────────────────────────────────

  private renderGroup(
    group: THREE.Group,
    segments: ClassifiedSegment[],
    commonColorOverride?: number,
  ): void {
    this.clearGroup(group)
    if (segments.length === 0) return

    // Rapid (G0) は細くし常に最前面へ、それ以外は通常幅で描画。
    // showRapid=false のときは Rapid 線を描画しない。
    const rapids = this.showRapid ? segments.filter((s) => s.segment.isRapid) : []
    const others = segments.filter((s) => !s.segment.isRapid)

    if (others.length > 0) {
      group.add(buildLineSegments(others, this.colors, {
        widthPx: this.normalWidthPx,
        commonColorOverride,
      }))
    }
    if (rapids.length > 0) {
      group.add(buildLineSegments(rapids, this.colors, {
        widthPx: this.rapidWidthPx,
        onTop: true,
        commonColorOverride,
      }))
    }
  }

  private clearGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const ls = obj as THREE.Object3D as unknown as LineSegments2
      if (ls.isLineSegments2) {
        ls.geometry.dispose()
        if (Array.isArray(ls.material)) {
          ls.material.forEach((m) => m.dispose())
        } else {
          ls.material.dispose()
        }
      }
    })
    group.clear()
  }

  private fitView(): void {
    const box = new THREE.Box3()
    ;[this.groupA, this.groupB, this.groupCommon].forEach((g) => {
      if (g.children.length > 0) box.expandByObject(g)
    })
    if (box.isEmpty()) {
      this.camera.position.set(0, 120, 200)
      this.controls.target.set(0, 0, 0)
      this.controls.update()
      return
    }
    const center = box.getCenter(new THREE.Vector3())
    const size   = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov)
    const dist   = (maxDim / 2 / Math.tan(fovRad / 2)) * 1.5
    this.camera.position.set(center.x + dist * 0.4, center.y + dist * 0.5, center.z + dist)
    this.controls.target.copy(center)
    this.controls.update()
  }

  dispose(): void {
    cancelAnimationFrame(this.animId)
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.controls.dispose()
    this.renderer.dispose()
  }
}
