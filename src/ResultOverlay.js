const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export default class ResultOverlay {
  constructor(scene, { score, survivalTime, onRestart }) {
    const { width, height } = scene.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    const shade = scene.add.rectangle(centerX, centerY, width, height, 0x000000, 0.6);
    const panel = scene.add
      .rectangle(centerX, centerY, 460, 320, 0xffffff)
      .setStrokeStyle(2, 0x111111);
    const title = scene.add
      .text(centerX, centerY - 100, '本局结束', {
        fontFamily: FONT_FAMILY,
        fontSize: '36px',
        fontStyle: 'bold',
        color: '#111111',
      })
      .setOrigin(0.5);
    const scoreText = scene.add
      .text(centerX, centerY - 30, `分数 ${score}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        color: '#222222',
      })
      .setOrigin(0.5);
    const timeText = scene.add
      .text(centerX, centerY + 10, `存活时间 ${survivalTime}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        color: '#222222',
      })
      .setOrigin(0.5);
    const button = scene.add
      .text(centerX, centerY + 90, '再来一局', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        color: '#ffffff',
        backgroundColor: '#111111',
        padding: { x: 28, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => button.setBackgroundColor('#333333'));
    button.on('pointerout', () => button.setBackgroundColor('#111111'));
    button.on('pointerdown', onRestart);

    const children = [shade, panel, title, scoreText, timeText, button];
    for (const child of children) child.setScrollFactor(0);

    this.container = scene.add
      .container(0, 0, children)
      .setScrollFactor(0)
      .setDepth(2000);
  }
}
