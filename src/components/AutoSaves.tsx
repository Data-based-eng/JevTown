import { useEffect, useRef, useState } from 'react';
import { MemoryWorld, formatTime } from '../../prototype/world';
import {
  catalogue,
  continuePlayback,
  playSlot,
  replaceTimeline,
  restoreSlot,
  saveChunk,
  SaveHead,
  SaveSlot,
  SavePlayback,
} from '../lib/autosaves';

export type Restored = { world?: MemoryWorld; head: SaveHead };
export type PlayHandler = (
  playback: SavePlayback,
  live: Restored,
  playing?: boolean,
  speed?: number,
) => void;
export function useAutoSaves(
  world: MemoryWorld,
  enabled: boolean,
  initialHead: SaveHead,
  onRestore: (saved: Restored) => void,
  onPlay: PlayHandler,
  initialError = '',
  beforeSave = () => true,
) {
  const head = useRef(initialHead),
    selection = useRef(initialHead),
    pending = useRef<Promise<void>>(),
    active = useRef(true);
  const panel = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [selectedId, setSelectedId] = useState<number>();
  const failed = useRef(!!initialError),
    busy = useRef(false);
  const [error, setError] = useState(initialError),
    [status, setStatus] = useState(''),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [slots, setSlots] = useState<SaveSlot[]>([]);
  const report = (e: unknown) => {
    failed.current = true;
    setError(`Save incomplete: ${(e as Error).message}`);
  };
  const flush = (manual = false) => {
    if (pending.current) return pending.current;
    if (!enabled || (busy.current && !manual)) return Promise.resolve();
    const stats = world.recordingStats(),
      count = stats.eventCount;
    if (!manual && count < 1000 && stats.elapsedMs < 60000 && !world.recordingCapacityReached())
      return Promise.resolve();
    if (!count && world.recordingCapacityReached()) {
      report(new Error('A single event exceeded recording capacity; auto-save skipped. Current progress is kept.'));
      return Promise.resolve();
    }
    const operation = (async () => {
      try {
        const run = world.recording(
          count >= 1000 || world.recordingCapacityReached() ? Math.min(count, 1000) : undefined,
        );
        const next = await saveChunk(run, head.current);
        head.current = next;
        world.releaseRecording(next.sequence);
        failed.current = false;
        if (active.current) {
          setError('');
          setStatus(`Saved ${manual ? 'manually' : 'automatically'} · ${new Date().toLocaleTimeString()}`);
        }
      } catch (e) {
        if (active.current) report(e);
      }
    })();
    pending.current = operation;
    void operation.finally(() => {
      pending.current = undefined;
    });
    return operation;
  };
  useEffect(() => {
    active.current = true;
    if (!enabled) return;
    void navigator.storage?.persist?.().catch(() => false);
    const timer = setInterval(() => {
      const stats = world.recordingStats();
      if (
        !failed.current &&
        !busy.current &&
        (stats.eventCount >= 1000 || stats.elapsedMs >= 60000 || world.recordingCapacityReached())
      )
        void flush();
    }, 1000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [world, enabled]);
  useEffect(() => {
    if (open) {
      if (!panel.current?.open) panel.current?.showModal();
    } else panel.current?.close();
  }, [open]);
  const showSlots = async () => {
    const menu = trigger.current?.closest('details');
    if (menu) menu.open = false;
    setOpen(true);
    setLoading(true);
    busy.current = true;
    try {
      await pending.current;
      const saved = await catalogue(true);
      selection.current = saved.head;
      setSlots(saved.slots);
      setSelectedId(saved.head.slot);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const load = async (id: number) => {
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      await pending.current;
      if (id === 0) {
        const next = await replaceTimeline([], selection.current);
        onRestore({ head: next });
      } else onRestore(await restoreSlot(id, selection.current, setStatus));
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const play = async (id: number, expected = selection.current, playing = true, speed = 1) => {
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      await pending.current;
      onPlay(
        await playSlot(id, expected, setStatus),
        { world, head: head.current },
        playing,
        speed,
      );
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const resume = async (playback: SavePlayback) => {
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      onRestore(await continuePlayback(playback));
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const retry = async () => {
    setOpen(false);
    busy.current = false;
    if (!initialError) {
      try {
        const stats = world.recordingStats();
        if (stats.eventCount || stats.pendingMs) await flush();
        else {
          if ((await catalogue()).head.revision !== head.current.revision)
            throw new Error('Saves were updated; open the save list to load.');
          failed.current = false;
          setError('');
        }
      } catch (e) {
        report(e);
      }
      return;
    }
    setLoading(true);
    busy.current = true;
    try {
      const saved = await catalogue();
      onRestore(
        saved.head.slot
          ? await restoreSlot(saved.head.slot, saved.head, setStatus)
          : { world, head: saved.head },
      );
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const saveNow = async () => {
    if (!enabled || busy.current || initialError) return;
    busy.current = true;
    setLoading(true);
    try {
      await pending.current;
      if (world.recordingCapacityReached()) {
        await flush(true);
        if (failed.current) return;
      }
      if (!beforeSave()) throw new Error('Cannot settle current progress; resolve the recording error first.');
      const stats = world.recordingStats();
      if (!stats.eventCount && !stats.pendingMs) {
        setStatus('No new progress to save');
        return;
      }
      // Drain bounded batches while gameplay is paused; never discard an unsaved suffix.
      while (world.recordingStats().eventCount || world.recordingStats().pendingMs) {
        await flush(true);
        if (failed.current) break;
      }
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const selected = slots.find((slot) => slot.id === selectedId);
  const later = selected ? slots.length - slots.indexOf(selected) - 1 : 0;
  const close = () => {
    if (!loading) {
      busy.current = false;
      setOpen(false);
    }
  };
  return {
    error,
    blocked: open || loading || !!error,
    play,
    resume,
    loading,
    menu: (
      <>
        <button
          disabled={!enabled || loading || open || !!initialError}
          className="px-3 py-2 text-left hover:bg-brown-800 focus-visible:outline"
          onClick={saveNow}
        >
          Save Now
        </button>
        <button
          ref={trigger}
          disabled={loading}
          className="px-3 py-2 text-left hover:bg-brown-800 focus-visible:outline"
          onClick={() => void showSlots()}
          aria-haspopup="dialog"
        >
          Save
        </button>
        {status && (
          <p role="status" className="px-3 py-1 text-xs break-words">
            {status}
          </p>
        )}
        {error && (
          <div role="alert" className="px-3 py-2 text-sm break-words">
            {error}
            <button className="block underline" disabled={loading} onClick={() => void retry()}>
              Retry Auto-Save
            </button>
            <p>Current progress is kept in memory. Open the save list to load an existing save.</p>
          </div>
        )}
      </>
    ),
    window: (
      <dialog
        ref={panel}
        className="goods-panel"
        aria-labelledby="saves-title"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          close();
          trigger.current?.closest('details')?.querySelector('summary')?.focus();
        }}
      >
        <header>
          <div>
            <p>Remaining-Time Relics</p>
            <h2 id="saves-title">Load Save</h2>
          </div>
          <div className="goods-balance">{slots.length}  saves</div>
          <button autoFocus aria-label="Close save window" disabled={loading} onClick={close}>
            ×
          </button>
        </header>
        <p className="my-4 text-sm">
          Progress auto-saves; you can also choose "Save Now" in settings. Refresh to continue from the latest save.
        </p>
        <div className="goods-body">
          <section className="goods-list" aria-label="Save list">
            {[...slots].reverse().map((slot) => (
              <button
                key={slot.id}
                aria-label={`Select save ${slot.id}`}
                aria-pressed={selectedId === slot.id}
                disabled={loading}
                onClick={() => setSelectedId(slot.id)}
              >
                <span>
                  <strong>
                    Save {slot.id}
                    {slot.id === slots.at(-1)?.id ? ' · latest' : ''}
                  </strong>
                  <small>{slot.scene}</small>
                  <small>{new Date(slot.savedAt).toLocaleString()}</small>
                  <small>Active: {slot.tasks?.active.join(', ') || 'none'}</small>
                  <small>Done: {slot.tasks?.completed.join(', ') || 'none'}</small>
                  <small>
                    File size: 
                    {slot.bytes === undefined ? 'unknown' : `${(slot.bytes / 1048576).toFixed(2)} MiB`}
                  </small>
                </span>
              </button>
            ))}
            <button
              aria-label="Select save 0"
              aria-pressed={selectedId === 0}
              disabled={loading}
              onClick={() => setSelectedId(0)}
            >
              <span>
                <strong>Save 0</strong>
                <small>Start New Game</small>
              </span>
            </button>
          </section>
          <section className="goods-detail" aria-label="Save details">
            {selectedId === 0 && (
              <>
                <h3>Start New Game</h3>
                <p>Start a new game from the beginning.</p>
                <div className="goods-order">
                  <button disabled={loading} onClick={() => void load(0)}>
                    Start New Game
                  </button>
                  <small>This will clear all saves and current progress.</small>
                </div>
              </>
            )}
            {selected && (
              <>
                <h3>{selected.scene}</h3>
                <p>Saved {new Date(selected.savedAt).toLocaleString()}</p>
                <p>Life Balance {formatTime(selected.balance)}</p>
                <p>Played {formatTime(Math.floor(selected.time / 1000))}</p>
                <p>Progress: {selected.end}  events</p>
                <div className="goods-order">
                  <button disabled={loading} onClick={() => void play(selected.id)}>
                    Replay save  {selected.id}
                  </button>
                  <button disabled={loading} onClick={() => void load(selected.id)}>
                    Load save  {selected.id}
                    {later ? ` (clears ${later} later saves)` : ''}
                  </button>
                  <small>
                    Replay starts from the beginning of this save. Loading restores the end of this save and clears later saves and unsaved progress.
                  </small>
                </div>
              </>
            )}
            {loading && <p role="status">{status || 'Reading save…'}</p>}
            {error && <p role="alert">{error}</p>}
            <p className="mt-4 text-xs">Saves are stored in this browser. Clearing site data deletes saves.</p>
          </section>
        </div>
      </dialog>
    ),
  };
}
