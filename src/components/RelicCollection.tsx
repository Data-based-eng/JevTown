import { useState } from 'react';
import { RELIC_SLOTS, RelicClue } from '../../prototype/content';
import { MemoryWorld } from '../../prototype/world';
import './RelicCollection.css';

export default function RelicCollection({
  items,
  clues,
}: {
  items: ReturnType<MemoryWorld['inventoryView']>;
  clues: RelicClue[];
}) {
  const [selectedSlot, setSelectedSlot] = useState(1);
  const slots = Array.from({ length: RELIC_SLOTS }, (_, i) => {
    const slot = i + 1,
      item = items.find((item) => item.kind === 'relic' && item.slot === slot);
    return {
      slot,
      item: item && item.quantity > 0 ? item : undefined,
      clues: clues.filter((clue) => clue.slot === slot),
    };
  });
  const selected = slots[selectedSlot - 1];
  return (
    <div className="relic-collection">
      <section className="relic-grid" aria-label="Relic slots">
        {slots.map(({ slot, item, clues }) => (
          <button
            key={slot}
            aria-pressed={slot === selectedSlot}
            aria-label={`${item?.name ?? 'Unknown Relic'}, slot  ${slot}，Clue ${clues.length}  clues`}
            onClick={() => setSelectedSlot(slot)}
          >
            <small className="relic-slot-number">{String(slot).padStart(2, '0')}</small>
            {item ? (
              <img src={import.meta.env.BASE_URL + item.image} alt="" />
            ) : (
              <span className="relic-unknown" aria-hidden="true">
                ?
              </span>
            )}
            {clues.length > 0 && <small className="relic-clue-count">Clue {clues.length}</small>}
          </button>
        ))}
      </section>
      <section className="relic-detail" aria-label="Relic and clue details">
        <small>Collection · {String(selectedSlot).padStart(2, '0')}</small>
        {selected.item ? (
          <>
            <img
              className="relic-portrait"
              src={import.meta.env.BASE_URL + selected.item.image}
              alt={selected.item.name}
            />
            <h3>{selected.item.name}</h3>
            <p>
              {selected.item.category} · {selected.item.quality}
            </p>
            <p>{selected.item.description}</p>
            <section className="relic-effect">
              <h4>Special Effect</h4>
              <p>{selected.item.effectDescription || 'No effect description yet.'}</p>
            </section>
          </>
        ) : (
          <>
            <div className="relic-portrait relic-unknown" aria-hidden="true">
              ?
            </div>
            <h3>Unknown Relic</h3>
            <p>Its appearance, story, and special effect are revealed once obtained.</p>
          </>
        )}
        <section className="relic-clues" aria-label="Clues obtained">
          <h4>Clue · {selected.clues.length}</h4>
          {selected.clues.length ? (
            <ol>
              {selected.clues.map((clue) => (
                <li key={clue.id}>
                  <p>{clue.text}</p>
                  <small>Source: {clue.source}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No clues yet. Talk to residents and examine objects to record discoveries here.</p>
          )}
        </section>
      </section>
    </div>
  );
}
