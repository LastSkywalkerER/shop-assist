import { CITIES } from '../../config/cities'
import { useCity } from '../../config/CityContext'

/** City selector, moved here from the header to free up space there. */
export function CitySection() {
  const { city, setCity } = useCity()

  return (
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          Город
        </span>
      </div>

      <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        {CITIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCity(c)}
            className="w-full flex items-center justify-between px-4 py-3 border-b border-separator/20 last:border-b-0 active:bg-bg-secondary/50 transition-colors text-left"
          >
            <span
              className={`text-[15px] ${
                c.id === city.id ? 'text-primary-text font-semibold' : 'text-text'
              }`}
            >
              {c.name}
            </span>
            {c.id === city.id && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary-text">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </button>
        ))}
      </div>
      <p className="px-5 pt-1.5 text-[12px] text-text-hint">
        Используется для поиска магазинов и товаров поблизости.
      </p>
    </section>
  )
}
