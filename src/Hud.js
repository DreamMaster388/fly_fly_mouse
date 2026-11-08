const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '24px',
  color: '#111111',
};
const DIFFICULTY_STYLE = {
  ...STYLE,
  fontSize: '20px',
};
const MARGIN = 24;
const TOP = 20;

export default class Hud {
  constructor(scene) {
    const { width } = scene.scale;

    this.timeText = scene.add
      .text(MARGIN, TOP, '0:00', STYLE)
      .setScrollFactor(0)
      .setDepth(1000);
    this.difficultyText = scene.add
      .text(MARGIN, TOP + 34, '难度', DIFFICULTY_STYLE)
      .setScrollFactor(0)
      .setDepth(1000);
    this.scoreText = scene.add
      .text(width / 2, TOP, '分数 0', STYLE)
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.hpText = scene.add
      .text(width - MARGIN, TOP, '血量 10/10', STYLE)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);
  }

  setTime(text) {
    this.timeText.setText(text);
  }

  setDifficulty(name, color) {
    this.difficultyText.setText(`难度 ${name}`);
    this.difficultyText.setColor(color);
  }

  setScore(score) {
    this.scoreText.setText(`分数 ${score}`);
  }

  setHp(hp, maxHp) {
    this.hpText.setText(`血量 ${hp}/${maxHp}`);
  }
}
