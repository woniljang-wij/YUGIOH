/* Boots the downloaded Cocos2d Canvas renderer for the duel field. */
(function (global, document) {
  'use strict';

  const engineModules = [
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
  const DESIGN_WIDTH = 960;
  let designHeight = 240;

  let ready = false;
  let loading = false;
  let sceneLayer = null;
  let fieldDrawing = null;
  let currentState = null;
  let bootError = null;

  function showError(error) {
    bootError = error;
    console.error('[Cocos duel] Engine failed to start:', error);
    const board = document.querySelector('.board');
    if (board) board.classList.add('cocos-fallback');
    const message = document.querySelector('[data-js="cocos-error"]');
    if (message) {
      message.textContent = 'Canvas engine không khởi động được. Bàn đấu sẽ dùng chế độ dự phòng.';
      message.hidden = false;
    }
  }

  function loadScript(filename) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `cocos/${filename}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Không tải được module Cocos: ${filename}`));
      document.head.appendChild(script);
    });
  }

  function render(state) {
    if (state) currentState = state;
    if (!ready || !currentState) return;

    fieldDrawing.clear();
    sceneLayer.removeAllChildren(false);
    sceneLayer.addChild(fieldDrawing, 0);

    const width = cc.winSize.width;
    const height = cc.winSize.height;
    fieldDrawing.drawRect(
      cc.p(12, 12),
      cc.p(width - 12, height - 12),
      cc.color(4, 9, 25, 28),
      1,
      cc.color(79, 227, 255, 85)
    );
    fieldDrawing.drawRect(
      cc.p(36, 38),
      cc.p(width - 36, height / 2 - 8),
      cc.color(7, 16, 43, 26),
      1,
      cc.color(96, 180, 255, 45)
    );
    fieldDrawing.drawRect(
      cc.p(36, height / 2 + 8),
      cc.p(width - 36, height - 38),
      cc.color(7, 16, 43, 26),
      1,
      cc.color(96, 180, 255, 45)
    );
    fieldDrawing.drawSegment(
      cc.p(width * .08, height / 2),
      cc.p(width * .92, height / 2),
      2,
      cc.color(245, 207, 122, 105)
    );
    for (let index = 0; index < 18; index++) {
      const x = (index * 137 + 29) % width;
      const y = (index * 83 + 17) % height;
      fieldDrawing.drawDot(
        cc.p(x, y),
        index % 3 === 0 ? 2 : 1,
        cc.color(133, 203, 255, 38)
      );
    }
  }

  function start() {
    if (loading || ready) return;
    loading = true;

    loadScript('CCBoot.js')
      .then(() => engineModules.reduce(
        (chain, filename) => chain.then(() => loadScript(filename)),
        Promise.resolve()
      ))
      .then(() => {
        const canvas = document.getElementById('cocosDuelCanvas');
        if (!canvas) throw new Error('Không tìm thấy canvas bàn đấu.');
        const board = canvas.closest('.board');
        if (!board || !board.clientWidth || !board.clientHeight) {
          throw new Error('Kích thước bàn đấu chưa sẵn sàng.');
        }
        designHeight = DESIGN_WIDTH * board.clientHeight / board.clientWidth;

        cc.game.run({
          id: canvas.id,
          width: DESIGN_WIDTH,
          height: designHeight,
          renderMode: 1,
          showFPS: false,
          frameRate: 60,
          debugMode: 0,
          registerSystemEvent: false
        }, () => {
          const scene = new cc.Scene();
          sceneLayer = new cc.Layer();
          fieldDrawing = new cc.DrawNode();
          sceneLayer.addChild(fieldDrawing, 0);
          scene.addChild(sceneLayer);
          cc.director.runScene(scene);
          ready = true;
          loading = false;
          render();
        });
      })
      .catch(showError);
  }

  global.CocosDuelEngine = Object.freeze({
    start,
    render,
    getStatus() {
      return { ready, loading, error: bootError };
    }
  });

  start();
})(window, document);
