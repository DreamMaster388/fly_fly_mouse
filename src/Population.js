export default class Population {
  constructor(max) {
    this.max = max;
    this.used = 0;
    this.occupants = new Map();
  }

  canAdd(cost) {
    return this.used + cost <= this.max;
  }

  add(occupant, cost) {
    if (this.occupants.has(occupant) || !this.canAdd(cost)) return false;

    this.occupants.set(occupant, cost);
    this.used += cost;
    return true;
  }

  remove(occupant) {
    const cost = this.occupants.get(occupant);
    if (cost === undefined) return false;

    this.occupants.delete(occupant);
    this.used -= cost;
    return true;
  }

  clear() {
    this.occupants.clear();
    this.used = 0;
  }
}
