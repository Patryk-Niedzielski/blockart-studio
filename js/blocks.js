// Block palette: averaged texture colours of full, opaque, non-directional blocks.
// `since` = first Minecraft version (minor) the block exists in.
// `gravity` = block falls when updated (sand-like) – risky on vertical walls.

export const CATEGORIES = [
  { id: 'concrete', default: true },
  { id: 'wool', default: true },
  { id: 'terracotta', default: true },
  { id: 'powder', default: false },
  { id: 'planks', default: false },
  { id: 'stone', default: false },
  { id: 'natural', default: false },
  { id: 'nether', default: false },
  { id: 'precious', default: false },
  { id: 'light', default: false },
];

const COLORS16 = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
];

const CONCRETE = [
  [207, 213, 214], [224, 97, 0], [169, 48, 159], [35, 137, 198], [240, 175, 21], [94, 168, 24],
  [213, 101, 142], [54, 57, 61], [125, 125, 115], [21, 119, 136], [100, 31, 156], [44, 46, 143],
  [96, 59, 31], [73, 91, 36], [142, 32, 32], [8, 10, 15],
];
const WOOL = [
  [233, 236, 236], [240, 118, 19], [189, 68, 179], [58, 175, 217], [248, 197, 39], [112, 185, 25],
  [237, 141, 172], [62, 68, 71], [142, 142, 134], [21, 137, 145], [121, 42, 172], [53, 57, 157],
  [114, 71, 40], [84, 109, 27], [160, 39, 34], [20, 21, 25],
];
const TERRACOTTA = [
  [209, 178, 161], [161, 83, 37], [149, 88, 108], [113, 108, 137], [186, 133, 35], [103, 117, 52],
  [161, 78, 78], [57, 42, 35], [135, 106, 97], [86, 91, 91], [118, 70, 86], [74, 59, 91],
  [77, 51, 35], [76, 83, 42], [143, 61, 46], [37, 22, 16],
];
const POWDER = [
  [225, 227, 227], [227, 131, 31], [192, 83, 184], [74, 180, 213], [232, 199, 54], [125, 189, 41],
  [228, 153, 181], [76, 81, 84], [154, 154, 148], [36, 147, 157], [131, 55, 177], [70, 73, 166],
  [125, 84, 53], [97, 119, 44], [168, 54, 50], [25, 26, 31],
];

const list = [];
const add = (id, rgb, category, extra = {}) =>
  list.push({ id: `minecraft:${id}`, name: id, rgb, category, since: 13, ...extra });

COLORS16.forEach((c, i) => {
  add(`${c}_concrete`, CONCRETE[i], 'concrete');
  add(`${c}_wool`, WOOL[i], 'wool');
  add(`${c}_terracotta`, TERRACOTTA[i], 'terracotta');
  add(`${c}_concrete_powder`, POWDER[i], 'powder', { gravity: true });
});
add('terracotta', [152, 94, 67], 'terracotta');

[
  ['oak_planks', [162, 130, 78]], ['spruce_planks', [114, 84, 48]], ['birch_planks', [192, 175, 121]],
  ['jungle_planks', [160, 115, 80]], ['acacia_planks', [168, 90, 50]], ['dark_oak_planks', [66, 43, 20]],
  ['crimson_planks', [101, 48, 70], 16], ['warped_planks', [43, 104, 99], 16],
  ['mangrove_planks', [117, 54, 48], 19], ['cherry_planks', [226, 178, 172], 20],
  ['bamboo_planks', [193, 173, 80], 20],
].forEach(([id, rgb, since]) => add(id, rgb, 'planks', since ? { since } : {}));

[
  ['stone', [125, 125, 125]], ['smooth_stone', [158, 158, 158]], ['cobblestone', [127, 127, 127]],
  ['andesite', [136, 136, 136]], ['polished_andesite', [132, 134, 133]], ['diorite', [188, 188, 188]],
  ['polished_diorite', [192, 193, 194]], ['granite', [149, 103, 85]], ['polished_granite', [154, 106, 89]],
  ['stone_bricks', [122, 121, 122]], ['bricks', [150, 97, 83]], ['quartz_block', [235, 229, 222]],
  ['smooth_sandstone', [223, 214, 170]], ['smooth_red_sandstone', [181, 97, 31]],
  ['prismarine', [99, 156, 151]], ['prismarine_bricks', [99, 171, 158]], ['dark_prismarine', [51, 91, 75]],
  ['end_stone', [219, 222, 158]], ['end_stone_bricks', [218, 224, 162]], ['purpur_block', [169, 125, 169]],
  ['obsidian', [15, 10, 24]],
  ['deepslate', [80, 80, 82], 17], ['polished_deepslate', [72, 72, 73], 17],
  ['deepslate_tiles', [54, 54, 55], 17], ['tuff', [108, 109, 102], 17], ['calcite', [223, 224, 220], 17],
  ['dripstone_block', [134, 107, 92], 17], ['mud_bricks', [137, 103, 79], 19], ['packed_mud', [142, 106, 79], 19],
].forEach(([id, rgb, since]) => add(id, rgb, 'stone', since ? { since } : {}));

[
  ['dirt', [134, 96, 67]], ['coarse_dirt', [119, 85, 59]], ['clay', [160, 166, 179]],
  ['snow_block', [249, 254, 254]], ['packed_ice', [141, 180, 250]], ['blue_ice', [116, 167, 253]],
  ['melon', [111, 145, 30]], ['red_mushroom_block', [200, 46, 45]], ['brown_mushroom_block', [149, 111, 81]],
  ['honeycomb_block', [229, 148, 29], 15], ['moss_block', [89, 109, 45], 17], ['mud', [60, 57, 60], 19],
  ['sculk', [12, 29, 36], 19],
].forEach(([id, rgb, since]) => add(id, rgb, 'natural', since ? { since } : {}));

[
  ['netherrack', [97, 38, 38]], ['nether_bricks', [44, 21, 26]], ['red_nether_bricks', [69, 7, 9]],
  ['nether_wart_block', [115, 3, 2]], ['warped_wart_block', [22, 119, 121], 16],
  ['blackstone', [42, 35, 40], 16], ['polished_blackstone', [53, 48, 56], 16],
  ['crying_obsidian', [32, 10, 60], 16],
].forEach(([id, rgb, since]) => add(id, rgb, 'nether', since ? { since } : {}));

[
  ['gold_block', [246, 208, 61]], ['iron_block', [220, 220, 220]], ['diamond_block', [98, 237, 228]],
  ['emerald_block', [42, 203, 87]], ['lapis_block', [30, 67, 140]], ['redstone_block', [175, 24, 5]],
  ['coal_block', [16, 15, 15]], ['netherite_block', [66, 61, 63], 16],
  ['waxed_copper_block', [192, 107, 79], 17], ['waxed_exposed_copper', [161, 125, 103], 17],
  ['waxed_weathered_copper', [108, 153, 110], 17], ['waxed_oxidized_copper', [82, 162, 132], 17],
  ['amethyst_block', [133, 97, 191], 17], ['raw_iron_block', [166, 135, 107], 17],
  ['raw_gold_block', [221, 169, 46], 17], ['raw_copper_block', [154, 105, 79], 17],
].forEach(([id, rgb, since]) => add(id, rgb, 'precious', since ? { since } : {}));

[
  ['glowstone', [171, 131, 84]], ['sea_lantern', [172, 199, 190]], ['shroomlight', [240, 146, 70], 16],
].forEach(([id, rgb, since]) => add(id, rgb, 'light', since ? { since } : {}));

export const BLOCKS = list;

// Minecraft versions offered in the UI. `minor` filters blocks, `dataVersion` goes into files.
export const VERSIONS = [
  { label: '1.21.x', minor: 21, dataVersion: 3955 },
  { label: '1.20.x', minor: 20, dataVersion: 3465 },
  { label: '1.19.x', minor: 19, dataVersion: 3337 },
  { label: '1.18.x', minor: 18, dataVersion: 2975 },
  { label: '1.17.x', minor: 17, dataVersion: 2730 },
  { label: '1.16.x', minor: 16, dataVersion: 2586 },
  { label: '1.13 – 1.15', minor: 15, dataVersion: 2230 },
];

export const prettyName = (name) =>
  name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
