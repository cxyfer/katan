import { GameIcon } from './GameArt.tsx';
import { useLocale, useT } from '../i18n/context.tsx';
import type { PlayerNote } from '../news/player-notes.ts';

/**
 * 首頁公告牌：依新到舊列出玩家版發布紀錄（src/news/player-notes.ts）。
 *
 * 只負責呈現；「已讀」由 HomeScreen 在分頁開啟時寫回 storage。
 */
export function NewsBoard({ notes, version }: { notes: readonly PlayerNote[]; version: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <div className="section-heading">
        <span className="section-heading__icon"><GameIcon name="sparkles" size={24} /></span>
        <div className="section-heading__copy">
          <h2 id="news-heading">{t('home.news.heading')}</h2>
          <p className="muted" data-testid="news-version">{t('home.news.current', { version })}</p>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="empty-state">
          <GameIcon name="scroll" size={32} />
          <p className="muted">{t('home.news.empty')}</p>
        </div>
      ) : (
        <ol className="news-list" data-testid="news-list">
          {notes.map((note, index) => (
            <li key={note.version} className={`news-entry${index === 0 ? ' news-entry--latest' : ''}`}>
              <article aria-labelledby={`news-${note.version}`}>
                <header className="news-entry__header">
                  <span className="news-entry__version">v{note.version}</span>
                  <time className="news-entry__date muted" dateTime={note.date}>{formatNoteDate(locale, note.date)}</time>
                  {index === 0 && <span className="news-entry__tag">{t('home.news.latest')}</span>}
                </header>
                <h3 className="news-entry__title" id={`news-${note.version}`}>{note.title[locale]}</h3>
                <ul className="news-entry__items">
                  {note.items.map((item) => (
                    <li key={item.en}>{item[locale]}</li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** 只有日期的 `YYYY-MM-DD` 以 UTC 解讀，避免時區把日期往前推一天。 */
function formatNoteDate(locale: string, date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed);
  } catch {
    return date;
  }
}
