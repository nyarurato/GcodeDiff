declare module 'gcode-toolpath' {
  export interface Vec3 {
    x: number
    y: number
    z: number
  }

  export interface GCodeModal {
    /** 移動コマンド: G0, G1, G2, G3, ... */
    motion: 'G0' | 'G1' | 'G2' | 'G3' | string
    /** 座標系: G54–G59 */
    wcs: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59' | string
    /** 円弧平面: G17=XY, G18=XZ, G19=YZ */
    plane: 'G17' | 'G18' | 'G19'
    /** 単位: G20=インチ, G21=mm */
    units: 'G20' | 'G21'
    /** 座標モード: G90=絶対, G91=相対 */
    distance: 'G90' | 'G91'
    /** 送り速度モード */
    feedrate: 'G93' | 'G94' | 'G95' | string
    program: 'M0' | 'M1' | 'M2' | 'M30' | string
    spindle: 'M3' | 'M4' | 'M5' | string
    coolant: 'M7' | 'M8' | 'M9' | string
    /** 現在のツール番号 */
    tool: number
  }

  export interface ToolpathOptions {
    position?: Partial<Vec3>
    modal?: Partial<GCodeModal>
    /**
     * G0/G1 直線移動コールバック
     * @param modal 現在のモーダル状態
     * @param v1    始点
     * @param v2    終点
     */
    addLine?: (modal: GCodeModal, v1: Vec3, v2: Vec3) => void
    /**
     * G2/G3 円弧移動コールバック
     * @param modal 現在のモーダル状態
     * @param v1    始点
     * @param v2    終点
     * @param v0    円弧中心
     */
    addArcCurve?: (modal: GCodeModal, v1: Vec3, v2: Vec3, v0: Vec3) => void
  }

  class Toolpath {
    constructor(options?: ToolpathOptions)
    loadFromString(
      str: string,
      callback: (err: Error | null, results: unknown) => void,
    ): this
    setPosition(pos: Partial<Vec3>): this
    setPosition(x: number, y: number, z?: number): this
    setModal(modal: Partial<GCodeModal>): this
    on(event: 'data' | 'end', listener: (data: unknown) => void): this
  }

  export default Toolpath
}
