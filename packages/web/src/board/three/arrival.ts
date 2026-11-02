/** 建造棋子從天而降的姿態：加速墜落、落地壓扁、小彈跳後回穩。 */
export interface ArrivalPose {
  /** 相對最終位置的抬升高度（世界單位）。 */
  lift: number;
  /** 垂直縮放倍率；落地時小於 1 呈壓扁。 */
  scaleY: number;
  /** 水平縮放倍率；與壓扁同步向外擴張。 */
  scaleXZ: number;
  /** 繞 Y 軸的額外旋轉（弧度），落地時歸零。 */
  spin: number;
}

export interface ArrivalOptions {
  height: number;
  spin?: number;
}

const FALL_END = 0.52;
const SQUASH_END = 0.66;
const HOP_END = 0.84;
const SETTLE_END = 0.94;
const HOP_HEIGHT = 0.08;
const SQUASH = 0.24;
const SETTLE_SQUASH = 0.08;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** 區間內 0 → 1 → 0 的半正弦脈衝。 */
const pulse = (progress: number, from: number, to: number) =>
  progress <= from || progress >= to ? 0 : Math.sin(Math.PI * (progress - from) / (to - from));

export const RESTING_POSE: Readonly<ArrivalPose> = { lift: 0, scaleY: 1, scaleXZ: 1, spin: 0 };

export function arrivalPose(progress: number, { height, spin = 0 }: ArrivalOptions): ArrivalPose {
  const p = clamp01(progress);
  if (p >= 1) return { ...RESTING_POSE };
  let lift = 0;
  let turn = 0;
  if (p < FALL_END) {
    // 等加速墜落：高度以 1 − t² 遞減，落地瞬間速度最大。
    const t = p / FALL_END;
    lift = height * (1 - t * t);
    turn = spin * (1 - t) * (1 - t);
  } else if (p >= SQUASH_END && p < HOP_END) {
    const t = (p - SQUASH_END) / (HOP_END - SQUASH_END);
    lift = height * HOP_HEIGHT * 4 * t * (1 - t);
  }
  const squash = SQUASH * pulse(p, FALL_END, SQUASH_END) + SETTLE_SQUASH * pulse(p, HOP_END, SETTLE_END);
  return { lift, scaleY: 1 - squash, scaleXZ: 1 + squash * 0.5, spin: turn };
}

export interface ArrivalShadow {
  /** 相對棋子底面輪廓的縮放倍率。 */
  scale: number;
  opacity: number;
}

export const ARRIVAL_SHADOW_OPACITY = 0.42;

/** 落點的接觸陰影：棋子越接近地面越大越深，落地後淡出，交回棋子本身的投影。 */
export function arrivalShadow(progress: number, options: ArrivalOptions): ArrivalShadow {
  const p = clamp01(progress);
  if (p >= 1) return { scale: 1, opacity: 0 };
  const { lift } = arrivalPose(p, options);
  const near = options.height > 0 ? 1 - Math.min(1, lift / options.height) : 1;
  const fade = p <= FALL_END ? 1 : 1 - (p - FALL_END) / (1 - FALL_END);
  return { scale: 0.4 + 0.6 * near, opacity: ARRIVAL_SHADOW_OPACITY * (0.2 + 0.8 * near) * fade };
}
