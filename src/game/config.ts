export const INPUT_CONFIG = {
  MOUSE_SENS_X: 0.0026,
  MOUSE_SENS_Y: 0.0022,
  INVERT_X: false,
  INVERT_Y: false,
} as const;

export const GAME_CONFIG = {
  ARENA_RADIUS: 12.2,
  PLAYER_SPEED: 5.8,
  DASH_SPEED: 15.5,
  DASH_DURATION: 0.24,
  DASH_COOLDOWN: 2.25,
  ROUND_TIME: 60,
  CANDY_TARGET: 12,
  ACTIVE_CANDY: 6,
  MAX_ENEMIES: 12,
  MAX_PARTICLES: 140,
  START_HEARTS: 3,
} as const;

export const QUALITY = {
  PARTICLES_HIGH: GAME_CONFIG.MAX_PARTICLES,
  PARTICLES_LOW: 70,
  DEGRADE_FPS: 45,
} as const;

export const COLORS = {
  background: 0x090716,
  ground: 0x211735,
  mint: 0x91ffd6,
  orange: 0xff7a1a,
  gold: 0xffce55,
  violet: 0x8b5cf6,
} as const;
