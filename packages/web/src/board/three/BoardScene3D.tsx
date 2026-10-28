import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import type { BoardSceneProps } from '../render-contract.ts';
import { SceneContent } from './SceneContent.tsx';

class SceneErrorBoundary extends Component<{ children: ReactNode; onUnavailable: (reason: string) => void }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onUnavailable('unavailable');
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export default function BoardScene3D(props: BoardSceneProps) {
  const standard = props.quality === 'standard';
  return (
    <SceneErrorBoundary onUnavailable={props.onUnavailable}>
      <div className="board-three" data-testid="board-three" aria-hidden="true"
        style={{ width: '100%', height: '100%', minHeight: 0, pointerEvents: 'none' }}>
        <Canvas
          frameloop="demand"
          orthographic
          shadows={standard ? 'percentage' : false}
          dpr={standard ? [1, 1.5] : [1, 1]}
          gl={{ antialias: standard, alpha: false, powerPreference: 'high-performance' }}
          camera={{ position: [0, 10, 10], zoom: 1, near: 0.1, far: 100,
            left: -10, right: 10, top: 10, bottom: -10 }}
          tabIndex={-1}
          // Canvas renders fallback content as HTML children of the canvas even
          // when WebGL is available. It must stay inert; renderer setup errors
          // escape through SceneErrorBoundary instead.
          fallback={<span>3D rendering unavailable</span>}
          onCreated={({ gl }) => {
            gl.toneMapping = ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
            gl.shadowMap.type = PCFShadowMap;
          }}
        >
          <color attach="background" args={['#529da7']} />
          <SceneContent {...props} />
        </Canvas>
      </div>
    </SceneErrorBoundary>
  );
}

export { BoardScene3D };
