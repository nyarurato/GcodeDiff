import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { ClassifiedSegment, DiffStatus } from './diffEngine'

// ─── カラーパレット ────────────────────────────────────────────────────────

const COLOR_MAP: Record<DiffStatus, number> = {
  common: 0x00e676,  // 緑: 共通
  'only-a': 0x448aff, // 青: A のみ
  'only-b': 0xff5252, // 赤: B のみ
}
const COLOR_RAPID = 0x2a2a3a // 早送り: 暗いグレー

// ─── ヘルパー ─────────────────────────────────────────────────────────────

/**
 * GCode 座標 (X,Y,Z) を Three.js 座標に変換。
 * GCode: X=右, Y=奥, Z=上  →  Three.js: X=右, Y=上, Z=手前
 */
function gToT(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y)
}

/** ClassifiedSegment 配列から色付き LineSegments を生成 */
function buildLineSegments(segments: ClassifiedSegment[]): THREE.LineSegments {
  const positions: number[] = []
  const colors: number[] = []
  const col = new THREE.Color()

  for (const { segment: seg, status } of segments) {
    const hex = seg.isRapid ? COLOR_RAPID : COLOR_MAP[status]
    col.setHex(hex)

    const from = gToT(...seg.from)
    const to = gToT(...seg.to)

    positions.push(from.x, from.y, from.z, to.x, to.y, to.z)
    colors.push(col.r, col.g, col.b, col.r, col.g, col.b)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const mat = new THREE.LineBasicMaterial({ vertexColors: true })
  return new THREE.LineSegments(geo, mat)
}

// ─── SceneManager ─────────────────────────────────────────────────────────

export class SceneManager {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls

  /** GCode A のルートグループ */
  private readonly groupA = new THREE.Group()
  /** GCode B のルートグループ */
  private readonly groupB = new THREE.Group()

  private animId = 0

  constructor(canvas: HTMLCanvasElement) {
    // ── レンダラー ───────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x0d0e14)

    // ── シーン ───────────────────────────────────────────────────────────
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x0d0e14, 0.0004)

    // グリッド (XZ 平面)
    const grid = new THREE.GridHelper(500, 50, 0x1a1c2a, 0x14151f)
    this.scene.add(grid)

    // 軸ヘルパー: グリッドと重なって見づらいので depthTest を切って常に前面に描画
    const axes = new THREE.AxesHelper(30)
    axes.renderOrder = 1
    // AxesHelper の内部マテリアル (LineBasicMaterial) に depthTest=false を適用
    if (axes.material instanceof THREE.Material) {
      axes.material.depthTest = false
    } else if (Array.isArray(axes.material)) {
      axes.material.forEach((m) => { m.depthTest = false })
    }
    this.scene.add(axes)

    // データグループ
    this.scene.add(this.groupA)
    this.scene.add(this.groupB)

    // ── カメラ ───────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      50000,
    )
    this.camera.position.set(0, 120, 200)
    this.camera.lookAt(0, 0, 0)

    // ── コントロール ─────────────────────────────────────────────────────
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.minDistance = 1
    this.controls.maxDistance = 20000
    this.controls.screenSpacePanning = true

    // ── リサイズ対応 ─────────────────────────────────────────────────────
    window.addEventListener('resize', this.onResize)

    this.animate()
  }

  // ── レンダーループ ────────────────────────────────────────────────────

  private readonly animate = (): void => {
    this.animId = requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  // ── 公開 API ─────────────────────────────────────────────────────────

  /** GCode A のパスを更新して描画 */
  updateA(segments: ClassifiedSegment[]): void {
    this.clearGroup(this.groupA)
    if (segments.length > 0) {
      this.groupA.add(buildLineSegments(segments))
      this.fitView()
    }
  }

  /** GCode B のパスを更新して描画 */
  updateB(segments: ClassifiedSegment[]): void {
    this.clearGroup(this.groupB)
    if (segments.length > 0) {
      this.groupB.add(buildLineSegments(segments))
      this.fitView()
    }
  }

  /** 両グループをクリア */
  clearAll(): void {
    this.clearGroup(this.groupA)
    this.clearGroup(this.groupB)
  }

  // ── 内部ユーティリティ ────────────────────────────────────────────────

  /** グループ内のオブジェクトを破棄してクリア */
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

  /**
   * 描画済みジオメトリ全体にカメラをフィット。
   * データがない場合はデフォルト位置に戻す。
   */
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
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov)
    const dist = (maxDim / 2 / Math.tan(fovRad / 2)) * 1.5

    this.camera.position.set(
      center.x + dist * 0.4,
      center.y + dist * 0.5,
      center.z + dist,
    )
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
