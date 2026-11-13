import Phaser from 'phaser';
import './fonts.css';
import { FONT_FACE } from './fonts.js';
import StartScene from './StartScene.js';
import WorldScene from './WorldScene.js';
import ShopScene from './ShopScene.js';

async function boot() {
  // Phaser renders text into a canvas once, so the face has to be available first.
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`16px "${FONT_FACE}"`),
        document.fonts.load(`bold 16px "${FONT_FACE}"`),
        document.fonts.ready,
      ]),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  } catch {
    // Fall through with the system fallback stack rather than blocking the game.
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: '#ffffff',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
    },
    scene: [StartScene, WorldScene, ShopScene],
  });

  if (import.meta.env.DEV) {
    window.game = game;
  }

  game.events.once('ready', () => {
    game.canvas.tabIndex = 0;
    game.canvas.focus();
  });

  window.addEventListener('click', () => {
    if (game.canvas) game.canvas.focus({ preventScroll: true });
  });
}

boot();
