import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../../prototype/world';
const clockLabel = (seconds: number) =>
  `Day ${Math.floor(seconds / 86400) + 1} ${formatTime(Math.floor(seconds) % 86400)
    .padStart(8, '0')
    .slice(0, 5)}`;
export default function WaitPanel({
  open,
  time,
  earliestTime = time,
  sleeping = false,
  fixedTime,
  balance,
  feedback,
  onClose,
  onWait,
}: {
  open: boolean;
  time: number;
  earliestTime?: number;
  sleeping?: boolean;
  fixedTime?: number;
  balance: number;
  feedback: string;
  onClose: () => void;
  onWait: (time: number, hours: number) => boolean;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const [hours, setHours] = useState(1);
  const until = fixedTime ?? Math.ceil(earliestTime) + hours * 3600,
    seconds = until - time;
  const valid =
    Number.isSafeInteger(until) &&
    Number.isSafeInteger(seconds) &&
    seconds > 0 &&
    until > earliestTime &&
    seconds <= balance;
  useEffect(() => {
    if (open) {
      setHours(sleeping ? 8 : 1);
      panel.current?.showModal();
    } else panel.current?.close();
  }, [open]);
  return (
    <dialog
      ref={panel}
      className="goods-panel"
      style={{ width: 'min(520px,calc(100vw - 28px))' }}
      aria-labelledby="wait-title"
      onClose={onClose}
    >
      <header>
        <h2 id="wait-title">{sleeping ? 'Sleep' : 'Wait'}</h2>
        <button onClick={() => panel.current?.close()} aria-label="Close rest window">
          ×
        </button>
      </header>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && onWait(until, hours)) panel.current?.close();
        }}
      >
        <p className="text-center">Now · {clockLabel(earliestTime)}</p>
        {fixedTime === undefined ? (
          <label className="block py-3 text-center">
            <span className="block text-sm">{sleeping ? 'How long to sleep' : 'How long to wait'}</span>
            <output className="my-4 block text-4xl font-semibold text-amber-200" aria-live="polite">
              {hours} <span className="text-lg">h</span>
            </output>
            <input
              autoFocus
              className="block w-full accent-amber-300"
              type="range"
              min="1"
              max="24"
              step="1"
              value={hours}
              aria-label={sleeping ? 'Sleep duration' : 'Wait duration'}
              aria-valuetext={`${hours} h`}
              onChange={(event) => setHours(Number(event.target.value))}
            />
            <span className="mt-2 flex justify-between text-sm" aria-hidden="true">
              <span>1 hour</span>
              <span>24 hours</span>
            </span>
          </label>
        ) : (
          <p className="text-center">This sleep · {formatTime(seconds)}</p>
        )}
        <p className="text-center">
          {sleeping ? 'Wake up' : 'End'} · {clockLabel(until)}
        </p>
        <p aria-live="polite">
          Costs  {formatTime(seconds)} ·{' '}
          {valid ? `Remaining  ${formatTime(balance - seconds)}` : 'Not enough remaining time.'}
        </p>
        <p className="text-sm">
          Covers time accrued but not yet settled. The world keeps running; people follow their routines.
          {sleeping ? 'This temporary room is free of charge.' : ''}
        </p>
        {feedback && <p role="status">{feedback}</p>}
        <button type="submit" disabled={!valid}>
          {sleeping ? 'Confirm Sleep' : 'Confirm Wait'}
        </button>
      </form>
    </dialog>
  );
}
