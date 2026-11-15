type Props = {
  percent: number;
  size?: number;
};

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Decorative: whoever shows it also says the percentage in text
export function ProgressRing({ percent, size = 22 }: Props) {
  const filled = (CIRCUMFERENCE * Math.min(100, Math.max(0, percent))) / 100;
  return (
    <svg className="progress-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle className="progress-ring-track" cx="12" cy="12" r={RADIUS} />
      <circle
        className="progress-ring-fill"
        cx="12"
        cy="12"
        r={RADIUS}
        strokeDasharray={`${filled.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
      />
    </svg>
  );
}
