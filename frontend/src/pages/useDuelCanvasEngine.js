import { useEffect, useRef } from 'react';

const ENGINE_MODULES = [
  'miniFramework.js',
  'CCEventHelper.js',
  'CCClass.js',
  'CCGeometry.js',
  'CCMacro.js',
  'CCConfig.js',
  'CCCommon.js',
  'CCAffineTransform.js',
  'CCPointExtension.js',
  'CCTypesPropertyDefine.js',
  'CCTypes.js',
  'CCVertex.js',
  'CCScreen.js',
  'CCVisibleRect.js',
  'BaseNodesPropertyDefine.js',
  'CCNode.js',
  'CCNodeCanvasRenderCmd.js',
  'CCScene.js',
  'CCLayer.js',
  'CCLayerCanvasRenderCmd.js',
  'CCDirector.js',
  'CCDirectorCanvas.js',
  'CCEGLView.js',
  'CCEvent.js',
  'CCTouch.js',
  'CCEventListener.js',
  'CCEventExtension.js',
  'CCEventManager.js',
  'CCScheduler.js',
  'CCAction.js',
  'CCActionInterval.js',
  'CCActionManager.js',
  'CCActionEase.js',
  'CCActionInstant.js',
  'CCActionTween.js',
  'TexturesPropertyDefine.js',
  'CCTexture2D.js',
  'CCTextureCache.js',
  'CCTextureAtlas.js',
  'CCSpriteFrame.js',
  'CCSpriteFrameCache.js',
  'SpritesPropertyDefine.js',
  'CCSprite.js',
  'CCSpriteCanvasRenderCmd.js',
  'LabelTTFPropertyDefine.js',
  'CCLabelTTF.js',
  'CCLabelTTFCanvasRenderCmd.js',
  'CCDrawNode.js',
  'CCDrawNodeCanvasRenderCmd.js',
  'CCDrawingPrimitivesCanvas.js',
  'RendererCanvas.js',
  'CCConfiguration.js',
  'CCInputManager.js',
  'CCInputExtension.js',
  'CCLoaders.js',
  'CCSAXParser.js',
  'ZipUtils.js',
  'CCPNGReader.js',
  'CCTIFFReader.js',
  'CCTGAlib.js'
];

const vendorScriptLoads = new Map();

function loadVendorScript(filename) {
  const source = new URL(`../../cocos/${filename}`, import.meta.url).href;
  if (vendorScriptLoads.has(source)) return vendorScriptLoads.get(source);
  const loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.onload = resolve;
    script.onerror = () => {
      vendorScriptLoads.delete(source);
      reject(new Error(`Could not load vendored Cocos runtime module: ${filename}`));
    };
    document.head.appendChild(script);
  });
  vendorScriptLoads.set(source, loading);
  return loading;
}

function drawField(state, drawing, layer, cocos) {
  if (!state || !drawing || !layer || !cocos?.winSize) return;
  drawing.clear();
  layer.removeAllChildren(false);
  layer.addChild(drawing, 0);

  const width = cocos.winSize.width;
  const height = cocos.winSize.height;
  drawing.drawRect(
    cocos.p(12, 12),
    cocos.p(width - 12, height - 12),
    cocos.color(4, 9, 25, 28),
    1,
    cocos.color(79, 227, 255, 85)
  );
  drawing.drawRect(
    cocos.p(36, 38),
    cocos.p(width - 36, height / 2 - 8),
    cocos.color(7, 16, 43, 26),
    1,
    cocos.color(96, 180, 255, 45)
  );
  drawing.drawRect(
    cocos.p(36, height / 2 + 8),
    cocos.p(width - 36, height - 38),
    cocos.color(7, 16, 43, 26),
    1,
    cocos.color(96, 180, 255, 45)
  );
  drawing.drawSegment(
    cocos.p(width * 0.08, height / 2),
    cocos.p(width * 0.92, height / 2),
    2,
    cocos.color(245, 207, 122, 105)
  );
  for (let index = 0; index < 18; index += 1) {
    const x = (index * 137 + 29) % width;
    const y = (index * 83 + 17) % height;
    drawing.drawDot(
      cocos.p(x, y),
      index % 3 === 0 ? 2 : 1,
      cocos.color(133, 203, 255, 38)
    );
  }
}

export function useDuelCanvasEngine(canvasRef, game, onError) {
  const currentGame = useRef(game);
  const errorCallback = useRef(onError);
  const engine = useRef(null);
  currentGame.current = game;
  errorCallback.current = onError;

  useEffect(() => {
    let cancelled = false;
    let sceneLayer;
    let fieldDrawing;

    async function start() {
      try {
        await loadVendorScript('CCBoot.js');
        for (const filename of ENGINE_MODULES) await loadVendorScript(filename);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Could not find the duel canvas.');
        const board = canvas.closest('.board');
        if (!board || !board.clientWidth || !board.clientHeight) {
          throw new Error('Duel board dimensions are not ready.');
        }
        const cocos = window.cc;
        if (!cocos?.game || !cocos.Scene || !cocos.Layer || !cocos.DrawNode) {
          throw new Error('Vendored Cocos runtime did not initialize.');
        }

        const designWidth = 960;
        const designHeight = designWidth * board.clientHeight / board.clientWidth;
        cocos.game.run({
          id: canvas.id,
          width: designWidth,
          height: designHeight,
          renderMode: 1,
          showFPS: false,
          frameRate: 60,
          debugMode: 0,
          registerSystemEvent: false
        }, () => {
          if (cancelled) return;
          const scene = new cocos.Scene();
          sceneLayer = new cocos.Layer();
          fieldDrawing = new cocos.DrawNode();
          sceneLayer.addChild(fieldDrawing, 0);
          scene.addChild(sceneLayer);
          cocos.director.runScene(scene);
          engine.current = {
            render(state) {
              drawField(state, fieldDrawing, sceneLayer, cocos);
            }
          };
          engine.current.render(currentGame.current);
        });
      } catch (error) {
        if (cancelled) return;
        console.error('[Cocos duel] Engine failed to start:', error);
        errorCallback.current?.('Canvas engine không khởi động được. Bàn đấu sẽ dùng chế độ dự phòng.');
      }
    }

    start();
    return () => {
      cancelled = true;
      engine.current = null;
    };
  }, [canvasRef]);

  useEffect(() => {
    engine.current?.render(game);
  }, [game]);
}
