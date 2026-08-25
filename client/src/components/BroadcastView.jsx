/**
 * BroadcastView — the big screen when the judge spotlights one player.
 *
 * Shown while the display mode is PLAYER_BROADCAST and a player has been
 * selected. Extracted from DisplayPage's inline markup for the same reason
 * RankingView was: the page decides WHICH view to show, the views own their
 * layout. A third and fourth view (round podium, final podium) will sit
 * beside these two.
 *
 * Deliberately sparse. This view exists to put one person on a wall-sized
 * screen in front of a room — name first, everything else secondary. It shows
 * who is in the spotlight, not their score: a live scoreboard next to a
 * player's face turns a competition into a pillory.
 *
 * The grid itself is not here yet. The server sends the player's identity with
 * DISPLAY_PLAYER_BROADCAST; streaming their board is a separate contract
 * (PLAYER_GRID_UPDATE) that this view will consume once it is specced.
 */
import { useLanguage } from '../i18n/LanguageContext';

export default function BroadcastView({ player, lastUpdated }) {
  const { t, lang } = useLanguage();
  if (!player) return null;
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-2 text-blue-400">
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" />
            <span className="text-sm font-medium">LIVE</span>
          </div>
          {lastUpdated && (
            <span className="text-gray-400 text-xs">
              {t('display.updatedAt', { time: lastUpdated.toLocaleTimeString(locale) })}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-500/30 rounded-lg p-8 sm:p-12 w-full max-w-4xl">
          <div className="flex items-center gap-6 sm:gap-10">
            {/* The initial stands in for a photo we do not have. Sized to be
                legible from the back of a room, not to be decorative. */}
            <div className="w-24 h-24 sm:w-32 sm:h-32 flex-shrink-0 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-4xl sm:text-6xl font-bold">
              {player.name?.charAt(0) || '?'}
            </div>
            <div className="min-w-0">
              <div className="text-4xl sm:text-6xl font-bold mb-3 break-words">
                {player.name}
              </div>
              <div className="flex items-center gap-4 flex-wrap text-gray-300">
                {player.school && (
                  <span className="text-base sm:text-xl">{player.school}</span>
                )}
                {player.age != null && (
                  <span className="text-base sm:text-xl">{t('display.age', { n: player.age })}</span>
                )}
                {player.category && (
                  <span className="px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded text-sm sm:text-base">
                    {player.category.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 px-6 py-3 text-center text-gray-600 text-xs">
        {t('display.footerLive')}
      </footer>
    </div>
  );
}
