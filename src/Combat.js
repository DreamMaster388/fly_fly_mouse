export default class Combat {
  constructor(scene, weaponOrbit, zombieManager) {
    this.scene = scene;
    this.weaponOrbit = weaponOrbit;
    this.zombieManager = zombieManager;
  }

  update() {
    const darts = this.weaponOrbit.getActiveDarts();
    const zombies = this.zombieManager.getLiveZombies();

    for (const dart of darts) {
      const hits = zombies.filter((zombie) => this.overlaps(dart, zombie));
      if (hits.length === 0) continue;

      for (const zombie of hits) {
        zombie.takeDamage(this.weaponOrbit.config.damage);
      }
      this.weaponOrbit.consume(dart);
    }
  }

  overlaps(dart, zombie) {
    const dartBody = dart.body;
    const zombieBody = zombie.body;
    if (!dartBody || !zombieBody) return false;
    if (!dartBody.enable || !zombieBody.enable) return false;

    const dx = dartBody.center.x - zombieBody.center.x;
    const dy = dartBody.center.y - zombieBody.center.y;
    const radius = dartBody.halfWidth + zombieBody.halfWidth;
    return dx * dx + dy * dy <= radius * radius;
  }
}
