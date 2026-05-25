import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
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

/** ClassifiedSegment 配列から色付き LineSegments を生成 */
function buildLineSegments(
  segments: ClassifiedSegment[],
  cfg: ColorConfig,
): THREE.LineSegments {
  const colorMap: Record<DiffStatus, number> = {
    common:   cfg.common,
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

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
}

function makeGrid(dark: boolean): THREE.GridHelper {
  return dark
    ? new THREE.GridHelper(500, 50, 0x1a1c2a, 0x14151f)
    : new THREE.GridHelper(500, 50, 0x999999, 0xcccccc)
}

// ─── SceneManager ─────────────────────────────────────────────────────────

export class SceneManager {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls

  private readonly groupA = new THREE.Group()
  private readonly groupB = new THREE.Group()
  private grid: THREE.GridHelper

  // 現在のカラー設定と最後に描画したセグメント（色変更時の再描画用）
  private colors: ColorConfig = { ...DEFAULT_COLORS }
  private lastA: ClassifiedSegment[] = []
  private lastB: ClassifiedSegment[] = []

  private animId = 0
  private cursorMarker: THREE.Object3D | null = null
  private markerSize: number = 2
  private markerColor: number = 0xffffff

  constructor(canvas: HTMLCanvasElement) {
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

    window.addEventListener('resize', this.onResize)
    this.animate()
  }

  // ── レンダーループ ────────────────────────────────────────────────────

  private readonly animate = (): void => {
    this.animId = requestAnimationFrame(this.animate)
    this.controls.update()
    // カーソルマーカーをカメラ距離に比例したサイズに更新
    if (this.cursorMarker) {
      const dist = this.camera.position.distanceTo(this.cursorMarker.position)
      this.cursorMarker.scale.setScalar(Math.max(0.2, dist * this.markerSize * 0.004))
    }
    this.renderer.render(this.scene, this.camera)
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  // ── 公開 API ─────────────────────────────────────────────────────────

  updateA(segments: ClassifiedSegment[]): void {
    this.lastA = segments
    this.renderGroup(this.groupA, segments)
    if (segments.length > 0) this.fitView()
  }

  updateB(segments: ClassifiedSegment[]): void {
    this.lastB = segments
    this.renderGroup(this.groupB, segments)
    if (segments.length > 0) this.fitView()
  }

  clearAll(): void {
    this.lastA = []
    this.lastB = []
    this.clearGroup(this.groupA)
    this.clearGroup(this.groupB)
  }

  /** A グループの表示/非表示 */
  setVisibleA(visible: boolean): void {
    this.groupA.visible = visible
  }

  /** B グループの表示/非表示 */
  setVisibleB(visible: boolean): void {
    this.groupB.visible = visible
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

  /** 凡例カラーを部分更新して即再描画 */
  setColors(partial: Partial<ColorConfig>): void {
    this.colors = { ...this.colors, ...partial }
    this.renderGroup(this.groupA, this.lastA)
    this.renderGroup(this.groupB, this.lastB)
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

  private renderGroup(group: THREE.Group, segments: ClassifiedSegment[]): void {
    this.clearGroup(group)
    if (segments.length > 0) {
      group.add(buildLineSegments(segments, this.colors))
    }
  }

  private clearGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })
    group.clear()
  }

  private fitView(): void {
    const box = new THREE.Box3()
    ;[this.groupA, this.groupB].forEach((g) => {
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
    this.controls.dispose()
    this.renderer.dispose()
  }
}
