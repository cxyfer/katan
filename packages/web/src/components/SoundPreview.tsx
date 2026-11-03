import { useEffect, useState } from 'react';
import { SOUND_CUES, type SoundCue } from '../audio/cues.ts';
import { TB_CUE_DESCRIPTIONS } from '../audio/tb-cues.ts';
import { createAudioEngine, type MusicScene } from '../audio/engine.ts';
import { renderCueOffline, type CueAnalysis } from '../audio/offline.ts';
import { DEFAULT_AUDIO_PREFERENCES } from '../audio/preferences.ts';
import '../styles/sound-preview.css';

/** 展示頁只給開發與審查使用（`?preview=sounds`），因此說明直接寫成雙語。 */
const DESCRIPTIONS: Record<SoundCue, string> = {
  'dice.roll': '擲骰：木杯搖晃後拋出彈跳 · Dice shaken and thrown',
  'dice.land': '骰子落定（點數揭曉）· Dice settle on reveal',
  'production.self': '自己獲得資源 · You collect resources',
  'production.other': '他人獲得資源 · Others collect resources',
  'build.road': '建造道路 · Road placed',
  'build.settlement': '建造村莊 · Settlement built',
  'build.city': '升級城市 · City upgraded',
  'dev.buy': '購買發展卡 · Development card drawn',
  'dev.knight': '打出騎士 · Knight played',
  'dev.monopoly': '壟斷 · Monopoly',
  'dev.yearOfPlenty': '豐收之年 · Year of Plenty',
  'dev.roadBuilding': '道路建設 · Road Building',
  'robber.alert': '擲出七點／必須移動強盜 · Seven rolled, robber due',
  'robber.move': '強盜落在地塊上 · Robber placed',
  'robber.steal': '強盜偷牌 · A card is stolen',
  'robber.stolenFromYou': '你被偷牌 · A card is stolen from you',
  'discard': '棄牌 · Cards discarded',
  'trade.offer': '有人向你提出交易 · Trade offer for you',
  'trade.complete': '交易成交 · Trade completed',
  'trade.bank': '與銀行／港口兌換 · Bank or harbor trade',
  'trade.cancel': '交易撤回或過期 · Trade withdrawn or expired',
  'turn.yours': '輪到你 · Your move',
  'turn.other': '換人行動 · Another player starts',
  'game.victory': '你獲勝 · Victory',
  'game.over': '遊戲結束 · Game over',
  'ui.select': '選擇目標 · Target selected',
  'ui.error': '操作被拒 · Action rejected',
  'chat.message': '收到聊天訊息 · Chat message',
  ...TB_CUE_DESCRIPTIONS,
  'ship.build': '建造船隻 · Ship launched',
  'ship.move': '移動船隻 · Ship sails to a new path',
  'pirate.move': '海盜出航 · Pirate moves',
  'gold.pick': '金礦地選資源 · Gold chosen',
  'island.bonus': '登上新小島 · New island bonus',
  'barbarians.advance': '蠻族船隻前進 · Barbarians sail closer',
  'barbarians.attack': '蠻族來襲 · Barbarian attack',
  'knight.act': '騎士行動 · Knight action',
  'wall.build': '建造城牆 · City wall',
  'city.improve': '城市改良 · City improvement',
  'progress.play': '打出進步卡 · Progress card played',
  'progress.alchemy': '煉金術定下骰點 · Alchemy sets the dice',
  'progress.merchant': '商人登場 · Merchant placed',
  'progress.request': '進步卡要求你回應 · A card asks for your answer',
};

function Waveform({ analysis }: { analysis: CueAnalysis | undefined }) {
  if (!analysis) return <svg className="sound-preview__wave" viewBox="0 0 120 32" aria-hidden="true" />;
  const scale = Math.max(analysis.peak, 0.05);
  const bars = analysis.envelope.map((value, index) => {
    const height = Math.max(0.5, (value / scale) * 15);
    return <rect key={index} x={index} y={16 - height} width={0.7} height={height * 2} />;
  });
  return <svg className="sound-preview__wave" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">{bars}</svg>;
}

// 展示頁是獨立的延遲載入區塊，整頁共用一個引擎；不在 effect 清理時關閉，
// 否則 StrictMode 的重複掛載會把它關掉。
const engine = createAudioEngine();
engine.setPreferences({ ...DEFAULT_AUDIO_PREFERENCES, music: 60 });

export default function SoundPreview() {
  const [analysis, setAnalysis] = useState<Partial<Record<SoundCue, CueAnalysis>>>({});
  const [scene, setScene] = useState<MusicScene | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        for (const cue of SOUND_CUES) {
          const result = await renderCueOffline(cue);
          if (cancelled) return;
          setAnalysis((current) => ({ ...current, [cue]: result }));
        }
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const play = (cue: SoundCue) => {
    engine.unlock();
    engine.play(cue);
  };
  const toggleScene = (next: MusicScene) => {
    engine.unlock();
    const value = scene === next ? null : next;
    setScene(value);
    engine.setScene(value);
  };

  return (
    <main className="sound-preview" data-testid="sound-preview">
      <header className="sound-preview__header">
        <h1>音效展示 · Sound palette</h1>
        <p>全部聲音都以 Web Audio 即時合成，沒有任何音檔。點擊卡片試聽；波形為離線渲染結果。<br />
          Every sound is synthesised live with Web Audio — no audio files. Click a card to listen; waveforms are rendered offline.</p>
        <div className="sound-preview__music" role="group" aria-label="背景音樂 · Music">
          {(['harbor', 'island'] as const).map((value) => (
            <button key={value} type="button" className="button" aria-pressed={scene === value} data-testid={`music-${value}`}
              onClick={() => toggleScene(value)}>
              {value === 'harbor' ? '港口主題（大廳）· Harbor theme' : '島嶼主題（牌桌）· Island theme'}
            </button>
          ))}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </header>
      <ul className="sound-preview__grid">
        {SOUND_CUES.map((cue) => {
          const result = analysis[cue];
          return (
            <li key={cue}>
              <button type="button" className="sound-preview__cue" data-testid={`cue-${cue}`} data-peak={result?.peak.toFixed(3)}
                onClick={() => play(cue)}>
                <code>{cue}</code>
                <span>{DESCRIPTIONS[cue]}</span>
                <Waveform analysis={result} />
                <small>{result ? `${result.seconds.toFixed(1)} s · peak ${(20 * Math.log10(result.peak)).toFixed(1)} dBFS` : '…'}</small>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
