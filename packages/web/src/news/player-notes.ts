/**
 * 首頁公告牌的玩家版發布紀錄。
 *
 * 這份紀錄和 GitHub Release 分開維護：Release 說明寫給部署者（映像、遷移、
 * 環境變數），這裡只寫玩家在牌桌上感受得到的變化——新玩法、規則修正、
 * 操作方式與版面改進。部署、內部重構與測試不寫進來。
 *
 * 維護規則（RELEASING.md「Player notes」一節）：
 * - 每個穩定版本一則，最新的放最前面；`version` 不含 `v`。
 * - 每則的標題與每個條目都要同時提供兩種語系，一句話說完一件事。
 * - 根目錄 `package.json` 為穩定版本時，必須已有同版號的紀錄，測試會擋下遺漏。
 */

import type { Locale } from '@catan/protocol';

export type LocalizedText = Readonly<Record<Locale, string>>;

export interface PlayerNote {
  /** 穩定版號，例如 `0.4.0`。 */
  version: string;
  /** 發布日期，`YYYY-MM-DD`。 */
  date: string;
  title: LocalizedText;
  items: readonly LocalizedText[];
}

export const PLAYER_NOTES: readonly PlayerNote[] = [
  {
    version: '0.4.0',
    date: '2026-11-04',
    title: {
      'zh-Hant': '五套擴充同時登場',
      en: 'Five expansions arrive at once',
    },
    items: [
      {
        'zh-Hant': '建立房間時依序選擇擴充、劇本與人數，牌桌會照你的組合準備好。',
        en: 'When you create a room, pick the expansion, then the scenario, then the player count, and the table is set up for that exact combination.',
      },
      {
        'zh-Hant': '航海家「航向新海岸」：3–6 人，造船出海、海盜封鎖航道、金礦自選資源，小島另有加分，14 分獲勝。',
        en: 'Seafarers — Heading for New Shores: 3–6 players build and sail ships, dodge the pirate, take any resource from gold fields and earn island bonuses on the way to 14 points.',
      },
      {
        'zh-Hant': '城市與騎士：3–6 人，事件骰與野蠻人進攻、騎士、城牆、商品、城市升級、大都市、進展卡與商人，13 分獲勝。',
        en: 'Cities & Knights: 3–6 players face the event die and barbarian attacks with knights, city walls, commodities, city improvements, metropolises, progress cards and the merchant, racing to 13 points.',
      },
      {
        'zh-Hant': '航海家＋城市與騎士：在新海岸地圖上合併兩套規則，騎士可以搭船出航，16 分獲勝。',
        en: 'Seafarers + Cities & Knights: both rule sets on the New Shores maps, with knights travelling by ship, played to 16 points.',
      },
      {
        'zh-Hant': '商人與野蠻人：3–4 人，可加入友善強盜與卡坦港口變體，另有卡坦漁夫、卡坦河流、商隊、野蠻人來襲與商人與野蠻人五個劇本。',
        en: 'Traders & Barbarians: 3–4 players can add the Friendly Robber and Harbors variants or play Fishing on Catan, Rivers of Catan, Merchant Trains, Barbarian Attack and Traders & Barbarians.',
      },
      {
        'zh-Hant': '探險家與海盜：3–4 人，依序挑戰五個任務，未探索的海域會被迷霧覆蓋，要靠船隻揭開。',
        en: 'Explorers & Pirates: 3–4 players work through five missions in order, with fogged sea hexes that only your ships can reveal.',
      },
      {
        'zh-Hant': '道路建設卡只要還有合法位置，就能放滿兩條道路或船；之前存下的對局維持原本規則。',
        en: 'Road Building now grants both roads or ships whenever there is a legal spot; games saved earlier keep their original rules.',
      },
      {
        'zh-Hant': '擲骰演出時棋盤會先維持擲骰前的樣子，不再提前透露結果。',
        en: 'The board holds its pre-roll state during the dice animation, so it no longer spoils the result.',
      },
      {
        'zh-Hant': '新擴充目前只開放真人玩家入座，電腦對手仍可在基本版使用。',
        en: 'The new expansions seat human players only for now; computer opponents remain available in the base game.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-03',
    title: {
      'zh-Hant': '電腦對手加入牌桌',
      en: 'Computer opponents join the table',
    },
    items: [
      {
        'zh-Hant': '房主可以在大廳用「簡單」或「標準」的電腦玩家補滿空位，並替它們命名。',
        en: 'Hosts can fill empty lobby seats with easy or standard computer players and give them names.',
      },
      {
        'zh-Hant': '把發展卡從手牌拖到棋盤上放開就能打出，按 Esc 取消。',
        en: 'Drag a development card from your hand onto the board to play it; press Escape to cancel.',
      },
      {
        'zh-Hant': '道路不能再穿過對手的建築；道路建設與豐收之年在配件或銀行不足時也能順利完成。',
        en: 'Roads no longer pass through an opponent’s building, and Road Building and Year of Plenty finish even when pieces or bank cards run short.',
      },
      {
        'zh-Hant': '新蓋的道路、村莊與城市會從天而降，落在棋盤上。',
        en: 'New roads, settlements and cities drop onto the board from the sky.',
      },
      {
        'zh-Hant': '房主可以沿用進房順序，或每局重新抽出隨機座位順序。',
        en: 'Hosts can keep the join order or draw a fresh random seat order for each game.',
      },
      {
        'zh-Hant': '可以開啟自動拒絕：對方要的資源比你手上多時，交易會自動婉拒。',
        en: 'Turn on auto-decline to refuse offers that ask for more resources than you hold.',
      },
      {
        'zh-Hant': '手機安裝版以橫向開啟，短螢幕上的棋盤可以使用整個高度。',
        en: 'The installed phone app opens in landscape, and short screens give the board their full height.',
      },
      {
        'zh-Hant': '開啟網站時會逐步顯示載入進度，連線較慢時也有提示。',
        en: 'Startup now shows each loading step, with a hint when the connection is slow.',
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-01',
    title: {
      'zh-Hant': '立體島嶼與全新牌桌',
      en: 'A 3D island and a new table',
    },
    items: [
      {
        'zh-Hant': '島嶼變成可以拖曳旋轉、縮放的立體模型，也保留插畫風格的平面棋盤。',
        en: 'The island is now a 3D model you can drag to orbit and zoom, alongside the illustrated flat board.',
      },
      {
        'zh-Hant': '手牌收成扇形並附上資源統計，分數欄精簡成圖示與獎章。',
        en: 'Your hand fans out with a resource tally, and the score rail condenses into icons and medals.',
      },
      {
        'zh-Hant': '對局結束後會先顯示統計畫面，再回到房間。',
        en: 'A statistics screen sums up each finished game before you return to the room.',
      },
      {
        'zh-Hant': '加入音效與音樂，可以在設定中調整或靜音。',
        en: 'Sound effects and music arrive, with a setting to adjust or mute them.',
      },
      {
        'zh-Hant': '房主可以修改房間人數，未坐滿也能開局；擲出 7 時的棄牌與等待提示更清楚。',
        en: 'Hosts can change room capacity and start short-handed, and the discard and waiting prompts after a seven are clearer.',
      },
      {
        'zh-Hant': '修正銀行資源不足時的發放方式，以及交易與擲骰可能搶先操作的問題。',
        en: 'Fixed resource payouts when the bank runs short, and trade or dice actions that could happen out of turn.',
      },
      {
        'zh-Hant': '橫向螢幕可以完整放下牌桌，對局中不必再捲動頁面。',
        en: 'Landscape screens fit the whole table, so you no longer scroll mid-game.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-27',
    title: {
      'zh-Hant': '卡坦桌遊桌開張',
      en: 'The table opens',
    },
    items: [
      {
        'zh-Hant': '打開瀏覽器就能玩 3–4 人基本版，不必安裝，也不用註冊帳號。',
        en: 'Play the 3–4 player base game in your browser, with no install and no account.',
      },
      {
        'zh-Hant': '私人房間用邀請碼加入，也可以在公開房間列表找空位。',
        en: 'Join private rooms with an invite code, or find an open seat in the public room list.',
      },
      {
        'zh-Hant': '支援交易提案與房間聊天。',
        en: 'Trade offers and room chat are built in.',
      },
      {
        'zh-Hant': '中途離開也能回到未完成的對局。',
        en: 'Leave mid-game and come back to the same table later.',
      },
      {
        'zh-Hant': '手機、平板與電腦都能玩，提供繁體中文與英文。',
        en: 'Play on phones, tablets and desktops, in Traditional Chinese or English.',
      },
    ],
  },
];

/** 最新一則公告；紀錄為空時為 `null`。 */
export const LATEST_PLAYER_NOTE: PlayerNote | null = PLAYER_NOTES[0] ?? null;

function parseStableVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** 比較兩個 `X.Y.Z` 版號，回傳正負號；任一方無法解析時回傳 `null`。 */
export function compareStableVersions(a: string, b: string): number | null {
  const [x, y] = [parseStableVersion(a), parseStableVersion(b)];
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/**
 * 公告是否比這個瀏覽器看過的版號更新。
 *
 * 已讀版號只往前推：站台回滾到較舊的版本時，看過更新公告的玩家不會再看到
 * 「新」，也不會把已讀版號寫回舊版，重新部署新版時不會再次標示。
 * 讀不到或無法解析的已讀紀錄視為從未看過。
 */
export function isNoteUnread(note: PlayerNote, seen: string | null): boolean {
  if (seen === null) return true;
  const order = compareStableVersions(note.version, seen);
  return order === null || order > 0;
}
