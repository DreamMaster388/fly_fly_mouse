import Phaser from 'phaser';
import StartScene from './StartScene.js';
import WorldScene from './WorldScene.js';

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
  scene: [StartScene, WorldScene],
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
