const DEFAULT_OPTIONS = {
  enterDistance: 44,
  exitDistance: 120,
  fadedAlpha: 0.35,
  fadeMs: 160,
};

function distanceToRegion(x, y, region) {
  const dx = Math.max(region.x - x, 0, x - (region.x + region.width));
  const dy = Math.max(region.y - y, 0, y - (region.y + region.height));
  return Math.hypot(dx, dy);
}

/**
 * Fades fixed-screen UI panels out while the player or a zombie is close to
 * them. A larger exit distance than enter distance keeps the fade from
 * flickering when an actor hovers around the panel edge.
 */
export default class UiFade {
  constructor(scene, { player, zombieManager }, options = {}) {
    this.scene = scene;
    this.player = player;
    this.zombieManager = zombieManager;
    this.config = { ...DEFAULT_OPTIONS, ...options };
    this.panels = [];
  }

  addTarget(id, target) {
    const regions = target.fadeRegions || [target.bounds];
    target.setAlpha(1);
    this.panels.push({
      id,
      regions,
      setAlpha: (alpha) => target.setAlpha(alpha),
      faded: false,
      alpha: 1,
      applied: 1,
    });
  }

  collectActors() {
    const actors = [];
    const push = (object) => {
      if (!object || object.active === false) return;
      actors.push(object);
    };

    if (this.player) push(this.player.gameObject);

    const zombies = this.zombieManager ? this.zombieManager.zombies : null;
    if (zombies) {
      for (const zombie of zombies) {
        if (!zombie || zombie.dead) continue;
        push(zombie.art && zombie.art.container ? zombie.art.container : zombie.gameObject);
      }
    }

    return actors;
  }

  update(delta) {
    const camera = this.scene.cameras.main;
    const view = camera ? camera.worldView : null;
    if (!view || view.width === 0 || view.height === 0) return;

    // Only actors inside the canvas can be hidden behind the fixed UI. Counting
    // off-screen ones would fade the HUD for enemies just past the screen edge
    // (e.g. below the bottom bar) that the player cannot see at all.
    const actors = [];
    for (const object of this.collectActors()) {
      const screenX = ((object.x - view.x) / view.width) * camera.width;
      const screenY = ((object.y - view.y) / view.height) * camera.height;
      if (
        screenX < 0 ||
        screenX > camera.width ||
        screenY < 0 ||
        screenY > camera.height
      ) {
        continue;
      }
      actors.push({ x: screenX, y: screenY });
    }

    const { enterDistance, exitDistance, fadedAlpha, fadeMs } = this.config;
    const step = Math.min(1, Math.max(0, delta) / fadeMs);

    for (const panel of this.panels) {
      let nearest = Infinity;
      for (const region of panel.regions) {
        for (const actor of actors) {
          nearest = Math.min(nearest, distanceToRegion(actor.x, actor.y, region));
        }
      }

      if (panel.faded) {
        if (nearest >= exitDistance) panel.faded = false;
      } else if (nearest <= enterDistance) {
        panel.faded = true;
      }

      const target = panel.faded ? fadedAlpha : 1;
      if (Math.abs(target - panel.alpha) <= 0.004) panel.alpha = target;
      else panel.alpha += (target - panel.alpha) * step;

      if (Math.abs(panel.alpha - panel.applied) > 0.001) {
        panel.applied = panel.alpha;
        panel.setAlpha(panel.alpha);
      }
    }
  }
}
