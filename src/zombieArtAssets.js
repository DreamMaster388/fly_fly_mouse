import outerlegUpperUrl from '../resource/enemy/zombie-parts/Zombie_outerleg_upper.png';
import outerlegLowerUrl from '../resource/enemy/zombie-parts/Zombie_outerleg_lower.png';
import outerlegFootUrl from '../resource/enemy/zombie-parts/Zombie_outerleg_foot.png';
import innerlegUpperUrl from '../resource/enemy/zombie-parts/Zombie_innerleg_upper.png';
import innerlegLowerUrl from '../resource/enemy/zombie-parts/Zombie_innerleg_lower.png';
import innerlegFootUrl from '../resource/enemy/zombie-parts/Zombie_innerleg_foot.png';
import outerarmUpperUrl from '../resource/enemy/zombie-parts/Zombie_outerarm_upper.png';
import outerarmLowerUrl from '../resource/enemy/zombie-parts/Zombie_outerarm_lower.png';
import outerarmHandUrl from '../resource/enemy/zombie-parts/Zombie_outerarm_hand.png';
import bodyUrl from '../resource/enemy/zombie-parts/Zombie_body.png';
import tieUrl from '../resource/enemy/zombie-parts/Zombie_tie.png';
import neckUrl from '../resource/enemy/zombie-parts/Zombie_neck.png';
import hairUrl from '../resource/enemy/zombie-parts/Zombie_hair.png';
import headUrl from '../resource/enemy/zombie-parts/Zombie_head.png';
import jawUrl from '../resource/enemy/zombie-parts/Zombie_jaw.png';
import tongueUrl from '../resource/enemy/zombie-parts/Zombie_tongue.png';
import mustacheUrl from '../resource/enemy/zombie-parts/Zombie_mustache1.png';
import innerarmUpperUrl from '../resource/enemy/zombie-parts/Zombie_innerarm_upper.png';
import innerarmLowerUrl from '../resource/enemy/zombie-parts/Zombie_innerarm_lower.png';
import innerarmHandUrl from '../resource/enemy/zombie-parts/Zombie_innerarm_hand.png';
import outerarmBoneUrl from '../resource/enemy/zombie-parts/Zombie_outerarm_upper_bone.png';
import { ZOMBIE_REANIM } from './zombieReanimData.js';

const URLS = {
  'zombie-part-outerleg-upper': outerlegUpperUrl,
  'zombie-part-outerleg-lower': outerlegLowerUrl,
  'zombie-part-outerleg-foot': outerlegFootUrl,
  'zombie-part-innerleg-upper': innerlegUpperUrl,
  'zombie-part-innerleg-lower': innerlegLowerUrl,
  'zombie-part-innerleg-foot': innerlegFootUrl,
  'zombie-part-outerarm-upper': outerarmUpperUrl,
  'zombie-part-outerarm-lower': outerarmLowerUrl,
  'zombie-part-outerarm-hand': outerarmHandUrl,
  'zombie-part-body': bodyUrl,
  'zombie-part-tie': tieUrl,
  'zombie-part-neck': neckUrl,
  'zombie-part-hair': hairUrl,
  'zombie-part-head': headUrl,
  'zombie-part-jaw': jawUrl,
  'zombie-part-tongue': tongueUrl,
  'zombie-part-mustache': mustacheUrl,
  'zombie-part-innerarm-upper': innerarmUpperUrl,
  'zombie-part-innerarm-lower': innerarmLowerUrl,
  'zombie-part-innerarm-hand': innerarmHandUrl,
};

export const ZOMBIE_PART_ASSETS = Object.entries(ZOMBIE_REANIM.parts).map(
  ([partKey, part]) => ({ partKey, key: part.key, url: URLS[part.key] }),
);

/** Bone stump left in the shoulder after the outer arm is torn off. */
export const ZOMBIE_ARM_BONE_ASSET = {
  key: 'zombie-part-outerarm-bone',
  url: outerarmBoneUrl,
};
