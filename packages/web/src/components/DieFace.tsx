import '../styles/die-face.css';

const PIP_POSITIONS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[50, 50]],
  2: [[25, 25], [75, 75]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[25, 25], [75, 25], [25, 75], [75, 75]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]],
};

function PipPattern({ value, rolling = false }: { value: number; rolling?: boolean }) {
  return <svg className={`die-face__pattern${rolling ? ' die-face__pattern--rolling' : ''}`}
    viewBox="0 0 100 100" focusable="false" aria-hidden="true" data-pips={value}
    style={rolling ? { animationDelay: `${(value - 1) * -80}ms` } : undefined}>
    {PIP_POSITIONS[value]?.map(([cx, cy]) => <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="9" />)}
  </svg>;
}

/** 點數面只負責圖像；結果名稱由外層提供，未揭示時不帶權威點數。 */
export function DieFace({ value, className = '' }: { value?: number; className?: string }) {
  return <span className={`die-face ${className}`} aria-hidden="true"
    data-value={value} data-rolling={value === undefined ? 'true' : undefined}>
    {value === undefined
      ? [1, 2, 3, 4, 5, 6].map((face) => <PipPattern key={face} value={face} rolling />)
      : <PipPattern value={value} />}
  </span>;
}
