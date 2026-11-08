import Phaser from 'phaser';
import { AUDIO } from './config.js';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export default class StartScene extends Phaser.Scene {
  constructor() {
    super('start');
  }

  preload() {
    this.load.audio(AUDIO.chompKey, AUDIO.chompUrl);
    this.load.audio(AUDIO.bgmKey, AUDIO.bgmUrl);
  }

  create() {
    this.cameras.main.setBackgroundColor(0xffffff);

    const { width, height } = this.scale;
    const button = this.add
      .text(width / 2, height / 2, '开始游戏', {
        fontFamily: FONT_FAMILY,
        fontSize: '32px',
        color: '#ffffff',
        backgroundColor: '#111111',
        padding: { x: 36, y: 16 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => button.setBackgroundColor('#333333'));
    button.on('pointerout', () => button.setBackgroundColor('#111111'));
    button.on('pointerdown', () => {
      this.startBgm();
      this.scene.start('world');
    });
  }

  startBgm() {
    const existing = this.sound.get(AUDIO.bgmKey);
    if (existing?.isPlaying) return;

    const bgm =
      existing || this.sound.add(AUDIO.bgmKey, { loop: true, volume: AUDIO.bgmVolume });
    bgm.play();
  }
}
