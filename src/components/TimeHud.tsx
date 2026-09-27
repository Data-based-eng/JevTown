import { formatTime } from '../../prototype/world';
import './TimeHud.css';

export default function TimeHud({
  balance,
  storyTime,
  quantumSeconds,
}: {
  balance: number;
  storyTime: number;
  quantumSeconds?: number;
}) {
  const story = formatTime(storyTime % 86400)
    .padStart(8, '0')
    .slice(0, -3);
  // Prototype calendar anchor; world content will supply the starting date later.
  const date = new Date(Date.UTC(2026, 5, 1 + Math.floor(storyTime / 86400)));
  const calendar = `${date.getUTCMonth() + 1}/${date.getUTCDate()} · ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()]}`;
  return (
    <section className="time-hud" aria-label="Game time and life balance">
      <span className="time-hud__label">Story Time</span>
      <output className="time-hud__clock" aria-label={`Story Time ${story}`}>
        {story}
      </output>
      <p className="time-hud__date">{calendar}</p>
      {quantumSeconds !== undefined && (
        <p className="time-hud__date">
          Settles every {quantumSeconds % 60 === 0 ? `${quantumSeconds / 60} min` : `${quantumSeconds}s`}
        </p>
      )}
      <div className="time-hud__balance" data-overdrawn={balance < 0}>
        <span>{balance < 0 ? 'Life Balance · Overdrawn' : 'Life Balance'}</span>
        <output aria-label={`Life Balance ${formatTime(balance)}`}>{formatTime(balance)}</output>
      </div>
    </section>
  );
}
