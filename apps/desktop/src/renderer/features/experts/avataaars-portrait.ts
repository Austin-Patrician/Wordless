import { createAvatar } from "@dicebear/core";
import * as avataaars from "@dicebear/avataaars";
import type {
  AvataaarsAccessories,
  AvataaarsClothing,
  AvataaarsEyebrows,
  AvataaarsEyes,
  AvataaarsFacialHair,
  AvataaarsMouth,
  AvataaarsPortraitOptions,
  AvataaarsTop,
  ExpertPortrait,
} from "@wordless/domain";

export const AVATAAARS_TOPS = ["hat", "hijab", "turban", "winterHat1", "winterHat02", "winterHat03", "winterHat04", "bob", "bun", "curly", "curvy", "dreads", "frida", "fro", "froBand", "longButNotTooLong", "miaWallace", "shavedSides", "straight02", "straight01", "straightAndStrand", "dreads01", "dreads02", "frizzle", "shaggy", "shaggyMullet", "shortCurly", "shortFlat", "shortRound", "shortWaved", "sides", "theCaesar", "theCaesarAndSidePart", "bigHair"] as const satisfies readonly AvataaarsTop[];
export const AVATAAARS_EYES = ["closed", "cry", "default", "eyeRoll", "happy", "hearts", "side", "squint", "surprised", "winkWacky", "wink", "xDizzy"] as const satisfies readonly AvataaarsEyes[];
export const AVATAAARS_EYEBROWS = ["angryNatural", "defaultNatural", "flatNatural", "frownNatural", "raisedExcitedNatural", "sadConcernedNatural", "unibrowNatural", "upDownNatural", "angry", "default", "raisedExcited", "sadConcerned", "upDown"] as const satisfies readonly AvataaarsEyebrows[];
export const AVATAAARS_MOUTHS = ["concerned", "default", "disbelief", "eating", "grimace", "sad", "screamOpen", "serious", "smile", "tongue", "twinkle", "vomit"] as const satisfies readonly AvataaarsMouth[];
export const AVATAAARS_FACIAL_HAIR = ["none", "beardLight", "beardMajestic", "beardMedium", "moustacheFancy", "moustacheMagnum"] as const satisfies readonly AvataaarsFacialHair[];
export const AVATAAARS_CLOTHING = ["blazerAndShirt", "blazerAndSweater", "collarAndSweater", "graphicShirt", "hoodie", "overall", "shirtCrewNeck", "shirtScoopNeck", "shirtVNeck"] as const satisfies readonly AvataaarsClothing[];
export const AVATAAARS_ACCESSORIES = ["none", "kurt", "prescription01", "prescription02", "round", "sunglasses", "wayfarers", "eyepatch"] as const satisfies readonly AvataaarsAccessories[];

export const AVATAAARS_SKIN_COLORS = ["ffdbb4", "edb98a", "d08b5b", "ae5d29", "614335"] as const;
export const AVATAAARS_HAIR_COLORS = ["2c1b18", "4a312c", "724133", "a55728", "b58143", "d6b370", "e8e1e1", "f59797"] as const;
export const AVATAAARS_CLOTHES_COLORS = ["262e33", "25557c", "5199e4", "3c4f5c", "929598", "e6e6e6", "a7ffc4", "ffafb9", "ff5c5c", "ffffff"] as const;
export const AVATAAARS_BACKGROUND_COLORS = ["dfe9c5", "b6e3f4", "c0aede", "ffd5dc", "ffdfbf", "d1d4f9", "e8e8e4", "ffffff"] as const;

export const DEFAULT_AVATAAARS_OPTIONS: AvataaarsPortraitOptions = {
  backgroundColor: "dfe9c5",
  skinColor: "edb98a",
  top: "shortWaved",
  hairColor: "4a312c",
  hatColor: "25557c",
  eyes: "happy",
  eyebrows: "defaultNatural",
  mouth: "smile",
  facialHair: "none",
  facialHairColor: "4a312c",
  clothing: "blazerAndShirt",
  clothesColor: "25557c",
  accessories: "none",
  accessoriesColor: "262e33",
};

const dataUriCache = new Map<string, string>();

export function avataaarsDataUri(options: AvataaarsPortraitOptions): string {
  const key = JSON.stringify(options);
  const cached = dataUriCache.get(key);
  if (cached) return cached;
  const result = createAvatar(avataaars, {
    seed: "wordless-avataaars-v1",
    style: ["circle"],
    backgroundColor: [options.backgroundColor],
    skinColor: [options.skinColor],
    top: [options.top],
    hairColor: [options.hairColor],
    hatColor: [options.hatColor],
    eyes: [options.eyes],
    eyebrows: [options.eyebrows],
    mouth: [options.mouth],
    facialHair: options.facialHair === "none" ? undefined : [options.facialHair],
    facialHairProbability: options.facialHair === "none" ? 0 : 100,
    facialHairColor: [options.facialHairColor],
    clothing: [options.clothing],
    clothesColor: [options.clothesColor],
    accessories: options.accessories === "none" ? undefined : [options.accessories],
    accessoriesProbability: options.accessories === "none" ? 0 : 100,
    accessoriesColor: [options.accessoriesColor],
  }).toDataUri();
  if (dataUriCache.size >= 256) dataUriCache.delete(dataUriCache.keys().next().value!);
  dataUriCache.set(key, result);
  return result;
}

export function randomAvataaarsOptions(): AvataaarsPortraitOptions {
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)]!;
  return {
    backgroundColor: pick(AVATAAARS_BACKGROUND_COLORS),
    skinColor: pick(AVATAAARS_SKIN_COLORS),
    top: pick(AVATAAARS_TOPS),
    hairColor: pick(AVATAAARS_HAIR_COLORS),
    hatColor: pick(AVATAAARS_CLOTHES_COLORS),
    eyes: pick(AVATAAARS_EYES),
    eyebrows: pick(AVATAAARS_EYEBROWS),
    mouth: pick(AVATAAARS_MOUTHS),
    facialHair: pick(AVATAAARS_FACIAL_HAIR),
    facialHairColor: pick(AVATAAARS_HAIR_COLORS),
    clothing: pick(AVATAAARS_CLOTHING),
    clothesColor: pick(AVATAAARS_CLOTHES_COLORS),
    accessories: pick(AVATAAARS_ACCESSORIES),
    accessoriesColor: pick(AVATAAARS_CLOTHES_COLORS),
  };
}

export function parseExpertPortrait(value: unknown): ExpertPortrait | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const portrait = value as Record<string, unknown>;
  if (portrait.kind === "builtin" && typeof portrait.key === "string")
    return { kind: "builtin", key: portrait.key };
  if (
    portrait.kind !== "avataaars" ||
    portrait.schemaVersion !== 1 ||
    !portrait.options ||
    typeof portrait.options !== "object" ||
    Array.isArray(portrait.options)
  ) return undefined;
  const options = portrait.options as Record<string, unknown>;
  const required = Object.keys(DEFAULT_AVATAAARS_OPTIONS);
  if (required.some((key) => typeof options[key] !== "string")) return undefined;
  return { kind: "avataaars", schemaVersion: 1, options: options as unknown as AvataaarsPortraitOptions };
}
