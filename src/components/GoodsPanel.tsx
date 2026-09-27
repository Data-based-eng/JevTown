import RelicCollection from './RelicCollection';
import { RelicClue } from '../../prototype/content';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { formatTime, MemoryWorld } from '../../prototype/world';
import './GoodsPanel.css';

export type GoodsMode = 'buy' | 'sell' | 'bag' | 'relics';
type Props = {
  clues: RelicClue[];
  notifications?: ReactNode;
  mode: GoodsMode | null;
  shop: ReturnType<MemoryWorld['shopView']>;
  items: ReturnType<MemoryWorld['inventoryView']>;
  balance: number;
  feedback: string;
  readOnly: boolean;
  onMode: (mode: GoodsMode | null) => void;
  onTrade: (type: 'buy' | 'sell', item: string, quantity: number) => void;
};
export default function GoodsPanel({
  mode,
  shop,
  items,
  balance,
  feedback,
  readOnly,
  onMode,
  onTrade,
  notifications,
  clues,
}: Props) {
  const panel = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState('1');
  useEffect(() => {
    if (mode) {
      if (!panel.current?.open) panel.current?.showModal();
    } else panel.current?.close();
  }, [mode]);
  const collection = mode === 'relics',
    viewOnly = mode === 'bag' || collection;
  const inventory = items.filter(
    (item) => item.quantity > 0 && (collection ? item.kind === 'relic' : item.kind !== 'relic'),
  );
  const inventoryGroups = [
    {
      id: 'quest',
      title: 'Quest Items',
      items: inventory.filter(
        (item) => item.category === 'Quest Items' || item.category === 'Quest Items',
      ),
    },
    {
      id: 'consumable',
      title: 'Consumables',
      items: inventory.filter(
        (item) => item.category !== 'Quest Items' && item.category !== 'Quest Items',
      ),
    },
  ].filter((group) => group.items.length > 0);
  const choices: (Props['items'][number] | NonNullable<Props['shop']>['offers'][number])[] =
    viewOnly ? inventory : (shop?.offers ?? []).filter((item) => mode === 'buy' || item.owned > 0);
  const selected = choices.find((item) => item.id === selectedId) ?? choices[0];
  const offer = shop?.offers.find((item) => item.id === selected?.id);
  const count = Number(quantity);
  const price = mode === 'buy' ? offer?.buySeconds : offer?.sellSeconds;
  const total = price === undefined ? 0 : price * count;
  const valid = Number.isInteger(count) && count >= 1 && count <= 99;
  const reason = readOnly
    ? 'View only'
    : !offer
      ? 'Please choose an item'
      : !valid
        ? 'Quantity must be 1–99'
        : mode === 'buy' && offer.stock < count
          ? 'Insufficient shop stock'
          : mode === 'sell' && offer.owned < count
            ? 'Not enough in backpack'
            : mode === 'buy' && balance < total
              ? 'Insufficient life balance'
              : '';
  const image = (path: string) => `${import.meta.env.BASE_URL}${path}`;
  const select = (id: string) => {
    setSelectedId(id);
    setQuantity('1');
  };
  return (
    <dialog
      ref={panel}
      className="goods-panel"
      aria-labelledby="goods-title"
      onClose={() => onMode(null)}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {notifications}
      <header>
        <div>
          <p>Remaining-Time Relics</p>
          <h2 id="goods-title">
            {collection ? 'Relic Collection' : mode === 'bag' ? 'Backpack' : (shop?.name ?? 'Shop')}
          </h2>
        </div>
        <div className="goods-balance">
          Life Balance <strong>{formatTime(balance)}</strong>
        </div>
        <button autoFocus aria-label="Close shop panel" onClick={() => onMode(null)}>
          ×
        </button>
      </header>
      <nav aria-label="Shop pages">
        {shop && (
          <>
            <button
              aria-pressed={mode === 'buy'}
              onClick={() => {
                onMode('buy');
                setQuantity('1');
              }}
            >
              Buy
            </button>
            <button
              aria-pressed={mode === 'sell'}
              onClick={() => {
                onMode('sell');
                setQuantity('1');
              }}
            >
              Sell
            </button>
          </>
        )}
        {collection ? (
          <span>
            Collected {inventory.length}  relic types · {clues.length}  clues
          </span>
        ) : (
          <button aria-pressed={mode === 'bag'} onClick={() => onMode('bag')}>
            Backpack ({inventory.reduce((sum, item) => sum + item.quantity, 0)})
          </button>
        )}
      </nav>
      {collection ? (
        <RelicCollection items={items} clues={clues} />
      ) : (
        <div className="goods-body">
          <section
            className={viewOnly ? 'goods-list goods-bag' : 'goods-list'}
            aria-label={collection ? 'Relic list' : mode === 'bag' ? 'Backpack items' : 'Item list'}
          >
            {viewOnly && !collection
              ? inventoryGroups.map((group) => (
                  <div key={group.id} className="goods-group">
                    <h3>{group.title}</h3>
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        aria-pressed={selected?.id === item.id}
                        onClick={() => select(item.id)}
                      >
                        <img src={image(item.image)} alt="" />
                        <span>
                          <strong>{item.name}</strong>
                          <small>Qty {item.quantity}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              : choices.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={selected?.id === item.id}
                    onClick={() => select(item.id)}
                  >
                    <img src={image(item.image)} alt="" />
                    <span>
                      <strong>{item.name}</strong>
                      {'stock' in item ? (
                        <>
                          <small>
                            {formatTime(mode === 'sell' ? item.sellSeconds : item.buySeconds)} / pc
                          </small>
                          <small>
                            Stock  {item.stock} · Owned  {item.owned}
                          </small>
                        </>
                      ) : (
                        <small>Qty {item.quantity}</small>
                      )}
                    </span>
                  </button>
                ))}
            {!choices.length && (
              <p>
                {collection
                  ? 'No relics yet. Relics found while exploring and questing are kept here.'
                  : mode === 'sell'
                    ? 'Nothing to sell to this merchant.'
                    : 'Backpack\'s empty — take a look at Scarlet Moon\'s shop.'}
              </p>
            )}
          </section>
          <section className="goods-detail" aria-label="Item details">
            {selected ? (
              <>
                <div className="goods-hero">
                  <img src={image(selected.image)} alt={selected.name} />
                  <p>
                    {selected.category}
                    <strong>{selected.quality}</strong>
                  </p>
                </div>
                <h3>{selected.name}</h3>
                <p>{selected.description}</p>
                <p>Owned  {items.find((item) => item.id === selected.id)?.quantity ?? 0}  pcs</p>
                {selected.kind === 'relic' && (
                  <section className="relic-effect">
                    <h4>Special Effect</h4>
                    <p>{selected.effectDescription || 'No effect description yet.'}</p>
                  </section>
                )}
                {!viewOnly && (
                  <div className="goods-order">
                    <div className="goods-quantity">
                      <label htmlFor="trade-quantity">
                        {mode === 'buy' ? 'Buy quantity' : 'Sell quantity'} {count}
                      </label>
                      <div>
                        <button
                          aria-label="Decrease quantity"
                          disabled={count <= 1}
                          onClick={() => setQuantity(String(Math.max(1, count - 1)))}
                        >
                          −
                        </button>
                        <span>1</span>
                        <input
                          id="trade-quantity"
                          aria-label="Trade quantity"
                          aria-valuetext={`${count}  pcs`}
                          type="range"
                          min="1"
                          max="99"
                          step="1"
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                        />
                        <span>99</span>
                        <button
                          aria-label="Increase quantity"
                          disabled={count >= 99}
                          onClick={() => setQuantity(String(Math.min(99, count + 1)))}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p>
                      {mode === 'buy' ? 'Pay time ' : 'Gain time '}{' '}
                      <strong>{valid ? formatTime(total) : '—'}</strong>
                    </p>
                    <button
                      disabled={!!reason}
                      onClick={() => {
                        if (!reason) onTrade(mode === 'sell' ? 'sell' : 'buy', selected.id, count);
                      }}
                    >
                      {mode === 'buy' ? 'Confirm Purchase' : 'Confirm Sale'}
                    </button>
                    <small>
                      {reason ||
                        (mode === 'buy'
                          ? 'Settles at current prices; purchases cannot overdraw.'
                          : 'Sold items return to shop stock.')}
                    </small>
                  </div>
                )}
              </>
            ) : (
              <p className="goods-empty">
                {collection
                  ? 'Every relic has its own story.'
                  : mode === 'bag'
                    ? 'Purchased items go here.'
                    : 'Switch to buy and see tonight\'s stock.'}
              </p>
            )}
            <p role="status" className="goods-feedback">
              {feedback}
            </p>
          </section>
        </div>
      )}
    </dialog>
  );
}
