import { useCallback, useMemo, useRef, useState } from 'react';
import { buildGeometry } from '../board/geometry.ts';
import { createIslandPreviewBoard, ISLAND_PREVIEW_PLAYERS } from '../board/island-preview.ts';
import type { ProjectionSnapshot, QualityMode } from '../board/render-contract.ts';
import { sceneBounds } from '../board/three/bounds.ts';
import BoardScene3D from '../board/three/BoardScene3D.tsx';
import { useBoardViewport } from '../board/useBoardViewport.ts';
import '../styles/island-preview.css';

const TERRAINS = [
  { name: '森林', en: 'WOODLAND', color: '#456449', detail: '層疊松林，深綠樹冠間的小徑。' },
  { name: '丘陵', en: 'CLAY HILLS', color: '#b46643', detail: '暖色岩層與紅土，沿坡起伏。' },
  { name: '牧場', en: 'PASTURE', color: '#8da768', detail: '草地、石籬，與悠閒的羊群。' },
  { name: '麥田', en: 'GOLDEN FIELDS', color: '#c9a350', detail: '一畦畦金色麥穗，收穫在望。' },
  { name: '山脈', en: 'HIGHLANDS', color: '#788689', detail: '稜角分明的峰頂與碎石礦脈。' },
  { name: '沙漠', en: 'DUNES', color: '#cfb78a', detail: '沙丘、風化岩，島上的寂靜地帶。' },
];

/** A persistent local art-review route using the game's renderer and camera owner. */
export default function IslandPreview() {
  const [topologyId, setTopologyId] = useState<'hex-r2' | 'hex-r56'>('hex-r2');
  const [quality, setQuality] = useState<QualityMode>('standard');
  const [projection, setProjection] = useState<ProjectionSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const board = useMemo(() => createIslandPreviewBoard(topologyId), [topologyId]);
  const geometry = useMemo(() => buildGeometry(topologyId), [topologyId]);
  const bounds = useMemo(() => sceneBounds(geometry, board), [geometry, board]);
  const controls = useBoardViewport({ geometry, bounds, surfaceRef, renderer: 'r3f', projection,
    sceneKey: `island-preview:${topologyId}` });
  const unavailable = useCallback((reason: string) => { setFailure(reason); setReady(false); }, []);
  const sceneReady = useCallback(() => setReady(true), []);
  const retry = () => { setFailure(null); setReady(false); setProjection(null); setAttempt((value) => value + 1); };
  const changeTopology = (value: 'hex-r2' | 'hex-r56') => {
    setTopologyId(value); setProjection(null); setReady(false); setFailure(null); setAttempt((current) => current + 1);
  };
  const { zoom } = controls.viewport;

  return <main className="island-preview" data-testid="island-preview"
    data-renderer-status={failure ? 'failed' : ready ? 'ready' : 'loading'}>
    <header className="island-preview__header">
      <a className="island-preview__brand" href="/?renderer=r3f" aria-label="KATAN 返回遊戲">KATAN</a>
      <span className="island-preview__edition">THE EXPLORER’S TABLE</span>
      <span className="island-preview__badge">模型展示</span>
      <a className="island-preview__back" href="/?renderer=r3f">返回遊戲 <span aria-hidden="true">↗</span></a>
    </header>
    <div className="island-preview__layout">
      <section className="island-preview__hero" aria-labelledby="island-title">
        <div className="island-preview__intro">
          <p className="island-preview__eyebrow">A LITTLE WORLD, READY TO EXPLORE</p>
          <h1 id="island-title">一座島嶼，<span>無限可能。</span></h1>
          <p>從林間到海岸，換個角度，細看每一處風景。</p>
        </div>
        <div className="island-preview__surface" ref={surfaceRef} tabIndex={0} role="region"
          aria-label="島嶼模型。拖曳移動，滾輪縮放；左右中括號旋轉，Home 重設。"
          data-testid="island-preview-surface" data-camera-azimuth={controls.viewport.azimuthDeg} data-azimuth={controls.viewport.azimuthDeg}
          data-zoom={zoom} data-center-x={controls.viewport.center.x} data-center-z={controls.viewport.center.z}
          {...controls.surfaceProps} style={{ ...controls.surfaceProps.style, position: 'absolute' }}>
          {!failure && <BoardScene3D key={`${topologyId}:${attempt}`} geometry={geometry} board={board}
            players={ISLAND_PREVIEW_PLAYERS} intent={null} selection={null} active={null}
            viewport={controls.viewport} quality={quality} motionAllowed={false}
            onProjection={setProjection} onReady={sceneReady} onUnavailable={unavailable} />}
          {!ready && !failure && <div className="island-preview__loading" role="status">正在佈置島嶼…</div>}
          {failure && <div className="island-preview__unavailable" role="alert">
            <h2>暫時無法顯示島嶼</h2>
            <p>3D 畫面未能啟動。請重試，或返回遊戲選擇 2D 棋盤。</p>
            <button type="button" onClick={retry}>重新載入模型</button>
            <a href="/?renderer=r3f">返回遊戲</a>
          </div>}
        </div>
        <div className="island-preview__navigation">
          <p className="island-preview__hint">拖曳移動 <span>·</span> 滾輪／雙指縮放 <span>·</span> [ ] 旋轉</p>
          <div className="island-preview__controls" role="group" aria-label="鏡頭控制">
            <button type="button" data-testid="preview-rotate-left" onClick={() => controls.rotate(-30)} disabled={!!failure || controls.gestureActive}
              aria-label="鏡頭向左旋轉 30 度" title="向左旋轉 [">↶</button>
            <button type="button" data-testid="preview-zoom-out" onClick={() => controls.setZoom(zoom / 1.25)} disabled={!!failure}
              aria-label="縮小鏡頭" title="縮小 −">−</button>
            <output aria-label="縮放比例">{Math.round(zoom * 100)}%</output>
            <button type="button" data-testid="preview-zoom-in" onClick={() => controls.setZoom(zoom * 1.25)} disabled={!!failure}
              aria-label="放大鏡頭" title="放大 +">+</button>
            <button type="button" data-testid="preview-rotate-right" onClick={() => controls.rotate(30)} disabled={!!failure || controls.gestureActive}
              aria-label="鏡頭向右旋轉 30 度" title="向右旋轉 ]">↷</button>
            <button type="button" data-testid="preview-fit" className="island-preview__reset" onClick={controls.fit}>重設視角</button>
          </div>
        </div>
      </section>
      <aside className="island-preview__guide" aria-labelledby="guide-title">
        <div className="island-preview__guide-heading">
          <span className="island-preview__eyebrow">THE FIELD GUIDE</span>
          <h2 id="guide-title">島嶼手記</h2>
          <p>六種地貌，一片相連的世界。</p>
        </div>
        <ol className="island-preview__terrains">
          {TERRAINS.map((terrain, index) => <li key={terrain.en}>
            <span className="island-preview__swatch" style={{ backgroundColor: terrain.color }} aria-hidden="true" />
            <div><span className="island-preview__terrain-number">0{index + 1}</span><h3>{terrain.name}</h3>
              <span className="island-preview__terrain-en">{terrain.en}</span><p>{terrain.detail}</p></div>
          </li>)}
        </ol>
        <div className="island-preview__settings">
          <label>島嶼規模<select data-testid="preview-topology" value={topologyId} onChange={(event) => changeTopology(event.target.value as typeof topologyId)}>
            <option value="hex-r2">經典島嶼 · 19 塊</option><option value="hex-r56">延伸島嶼 · 30 塊</option>
          </select></label>
          <label>畫面品質<select data-testid="preview-quality" value={quality} onChange={(event) => setQuality(event.target.value as QualityMode)}>
            <option value="standard">細緻</option><option value="low">輕量</option>
          </select></label>
          <p>模型展示供自由瀏覽；前往遊戲即可建立對局。</p>
        </div>
      </aside>
    </div>
  </main>;
}
