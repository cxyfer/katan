// Repeatable presentation fixtures; never contacts the running service or database.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const bundle = '/tmp/catan-rich-fixtures.mjs';
const result = spawnSync('pnpm', ['exec', 'esbuild', 'packages/web/src/test/fixtures.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const f = await import(pathToFileURL(bundle).href);
const rulesBundle = '/tmp/catan-rich-rules.mjs';
const rulesBuild = spawnSync('pnpm', ['exec', 'esbuild', 'packages/rules/src/index.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${rulesBundle}`], { cwd: root, encoding: 'utf8' });
if (rulesBuild.status !== 0) throw new Error(rulesBuild.stderr || rulesBuild.stdout);
const rules = await import(pathToFileURL(rulesBundle).href);
const topology = rules.getTopology('hex-r56');
const layout = rules.buildBaseLayout({topology, mode:'fixed', rng:rules.seededRng(7)});
const board = {...layout, harbors:layout.harbors.map(({edge,type})=>({edge,type})), pirate:null,
  buildings:topology.vertices.map((_,i)=>i%13===0 ? {player:`p${Math.floor(i/13)%6+1}`,city:i%26===0} : null),
  roads:topology.edges.map((_,i)=>i%11===0 ? {player:`p${Math.floor(i/11)%6+1}`,ship:false} : null)};
const names = ['Captain Alexandra Longname', '小美航海家與群島探索隊長', 'Bartholomew the Navigator', 'Charlotte of Golden Harbor', 'Éléonore Longue Traversée', '鄭成功與六人島嶼遠征艦隊'];
const colors = ['red', 'blue', 'orange', 'white', 'green', 'brown'];
const held = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint', 'knight'];
const fresh = ['knight', 'monopoly', 'victoryPoint'];
const players = names.map((nickname, seat) => f.makePlayer({
  id: `p${seat + 1}`, nickname, seat, color: colors[seat], publicScore: 2 + seat,
  handSize: seat === 0 ? 19 : 8 + seat, devCardCount: seat === 0 ? held.length : seat,
  newDevCardCount: seat === 0 ? fresh.length : 0, playedKnights: seat, longestRoadLength: seat + 2,
  resources: seat === 0 ? {lumber:7, brick:0, wool:4, grain:6, ore:2} : undefined,
  devCards: seat === 0 ? held : undefined, newDevCards: seat === 0 ? fresh : undefined,
  ownScore: seat === 0 ? 4 : undefined, progressCards: seat === 0 ? [] : undefined,
  newProgressCards: seat === 0 ? [] : undefined,
}));
const view = f.makeView({players,board});
view.profileId = 'base-paired-2025';
view.turn.pairedActor = 2;
view.awards = {longestRoad:'p6', largestArmy:'p5'};
view.turn.dice = [2,5];
const room = f.makeRoom({status:'playing', capacity:6, profileId:view.profileId, gameId:'g1', members: players.map(p => f.makeMember({playerId:p.id,nickname:p.nickname,seat:p.seat,color:p.color,host:p.id==='p1'}))});
const snapshot = f.makeSnapshot(view);
const empty = structuredClone(snapshot);
Object.assign(empty.view.players[0], {resources:{lumber:0,brick:0,wool:0,grain:0,ore:0}, handSize:0, devCards:[],newDevCards:[],devCardCount:0,newDevCardCount:0});
const pending = structuredClone(snapshot);
pending.view.pending = {kind:'yearOfPlenty', actor:'p1', remaining:2};
pending.view.hints.pendingKind = 'yearOfPlenty';
const fixture = {
  identity:f.makeIdentity({nickname:names[0]}), config:f.makeConfig(),
  profiles:[f.makeProfile(), f.makeProfile({id:'base-paired-2025',labelKey:'profile.base-paired-2025',playerCounts:[5,6],paired:true})],
  room, games:[f.makeResumable({status:'playing', profileId:view.profileId,players:players.map(p=>({playerId:p.id,nickname:p.nickname,color:p.color}))})],
  snapshot, empty, pending,
};
const destination = resolve(here, 'table-interactions-fixtures.json');
writeFileSync(destination, JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({destination, players:players.length,held:held.length,fresh:fresh.length}));
