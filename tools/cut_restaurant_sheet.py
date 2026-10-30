#!/usr/bin/env python3
"""Cut the Taiwanese street-food concept sheet (assets/ref/restaurant_sheet.png, 1536x1024) into separate transparent PNGs.

  python3 tools/cut_restaurant_sheet.py            # writes assets/rest/<group>/<name>.png + assets/rest/manifest.json

Needs only Pillow + numpy. Every sprite is a hand-picked box on the sheet (found with a connected-component pass over each panel);
the white/pale-blue panel background is removed by a flood fill from the box border (so whites *inside* an outline survive), then
the image is trimmed to its opaque bounds. Staff variants are the shop-owner sprite with the blue apron hue-shifted per role.
The manifest lists every file (the service worker caches from it) and the size of each sprite. See docs/RESTAURANT_SPRITES.md.
"""
import json, os, sys
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
SHEET = os.path.join(ROOT, 'assets/ref/restaurant_sheet.png')
OUT = os.path.join(ROOT, 'assets/rest')

# group -> name -> (x0, y0, x1, y1) on the sheet
SPRITES = {
  'furniture': {
    'bench_wood':     (374, 488, 459, 527),
    'wall_menu':      (521, 488, 591, 527),
    'stool_rattan':   (381, 543, 406, 573),
    'cushion_red':    (408, 543, 455, 573),
    'wall_shelf':     (529, 539, 610, 584),
    'door_wood':      (623, 539, 649, 584),
    'door_dark':      (661, 539, 687, 584),
    'display_stand':  (699, 539, 740, 580),
    'prep_table':     (374, 589, 441, 633),
    'kitchen_unit':   (455, 594, 513, 692),
    'sink_double':    (528, 593, 611, 637),
    'ice_tub':        (631, 600, 676, 634),
    'glass_fridge':   (691, 594, 740, 682),
    'food_stall':     (374, 651, 443, 742),
    'sink':           (528, 646, 569, 696),
    'chalk_stand':    (582, 646, 622, 706),
    'cart_small':     (636, 644, 675, 686),
    'bench_red':      (460, 712, 514, 742),
    'stool_red':      (590, 718, 620, 753),
    'trash_bin':      (649, 704, 678, 749),
    'table':          (613, 908, 661, 950),
    'counter':        (670, 902, 741, 954),
    'register':       (801, 895, 848, 955),
    'trash_teal':     (756, 904, 784, 948),
    'stool_red2':     (566, 911, 598, 951),
  },
  'kitchen': {
    'steamer':        (891, 811, 932, 863),
    'big_pot':        (954, 814, 1007, 863),
    'gas_stove':      (1022, 817, 1087, 863),
    'menu_board':     (1111, 811, 1161, 866),
    'clean_tools':    (1178, 811, 1232, 864),
    'tableware':      (886, 908, 930, 954),
    'sauce':          (954, 908, 1001, 952),
    'ingredients':    (1026, 907, 1079, 952),
    'carton':         (1102, 910, 1148, 952),
    'fridge':         (1172, 900, 1224, 960),
  },
  'deco': {
    'lantern_a':      (480, 487, 508, 527),
    'lantern_b':      (679, 488, 707, 527),
    'lantern_s1':     (895, 490, 923, 570),
    'lantern_s2':     (923, 490, 955, 570),
    'lantern_s3':     (957, 490, 992, 570),
    'bush':           (612, 490, 661, 529),
    'shrub_pot':      (474, 539, 513, 584),
    'blue_pot':       (534, 709, 563, 741),
    'plant_pot':      (692, 694, 734, 749),
    'plant_big':      (940, 585, 995, 658),
    'sign_taiwan':    (898, 565, 935, 656),
    'sign_vertical':  (1384, 64, 1435, 205),
    'menu_board_big': (760, 512, 892, 688),
    'chalk_big':      (913, 666, 982, 754),
    'awning_a':       (1293, 76, 1363, 114),
    'awning_b':       (1289, 136, 1362, 185),
    'roof_green':     (1031, 67, 1186, 119),
    'roof_blue':      (1199, 71, 1284, 124),
    'tea_cup':        (1478, 267, 1507, 326),
  },
  'icons': {
    'hint_bulb':      (582, 817, 614, 853),
    'speech':         (658, 818, 693, 850),
    'coin':           (732, 817, 766, 850),
  },
  'food': {
    'lurou_rice':     (26, 816, 76, 861),
    'mianxian':       (88, 815, 147, 861),
    'oyster_omelet':  (159, 815, 217, 861),
    'stinky_tofu':    (225, 815, 283, 861),
    'braised_plate':  (293, 816, 350, 861),
    'pearl_tea':      (370, 808, 402, 861),
    'wintermelon_tea': (427, 809, 459, 861),
    'aiyu':           (475, 816, 524, 861),
    'chicken_cutlet': (22, 904, 80, 953),
    'chicken_rice':   (90, 906, 150, 953),
    'meatball':       (164, 906, 218, 953),
    'oyster_soup':    (232, 906, 286, 953),
    'braised_egg':    (303, 909, 355, 953),
    'tofu_dry':       (366, 909, 420, 953),
    'greens':         (423, 909, 473, 953),
    'fruit_tea':      (486, 904, 520, 953),
  },
  'people': {
    'boss_front':     (1039, 512, 1075, 585),
    'boss_fr':        (1094, 512, 1127, 585),
    'boss_fr2':       (1141, 512, 1172, 585),
    'boss_br':        (1189, 510, 1219, 585),
    'boss_br2':       (1232, 512, 1267, 585),
    'boss_back':      (1282, 511, 1318, 584),
    'boss_back_l':    (1336, 511, 1369, 584),
    'cust_girl':      (1037, 633, 1074, 714),
    'cust_boy':       (1087, 633, 1120, 714),
    'cust_elder':     (1134, 633, 1173, 714),
    'cust_green':     (1186, 632, 1220, 707),
    'cust_cap':       (1232, 634, 1270, 714),
    'cust_bag':       (1282, 634, 1316, 714),
    'cust_dress':     (1329, 632, 1368, 707),
  },
}
NO_BG = {'people/portrait'}                      # sprites that keep their own (non-white) background

# staff = boss sprite with the blue overalls shifted to a role colour: (PIL hue 0..255 target, saturation scale)
STAFF_HUE = {'chef': None, 'cook': 85, 'barista': 195, 'server': 8, 'cashier': 125}   # green / purple / red-orange / teal
STAFF_VIEWS = {'front': 'boss_fr2', 'back': 'boss_br'}

def is_bg(a):
    mn = a.min(axis=-1); mx = a.max(axis=-1)
    return (mn >= 200) & ((mx - mn) <= 34)

def remove_bg(img):
    a = np.asarray(img.convert('RGB')).astype(int)
    h, w = a.shape[:2]
    bg = is_bg(a)
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and bg[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    # one more pass: light, low-saturation fringe pixels touching the removed area are anti-alias halo
    for _ in range(2):
        mn = a.min(axis=-1); mx = a.max(axis=-1)
        fringe = (mn >= 175) & ((mx - mn) <= 40) & ~seen
        near = np.zeros_like(seen)
        near[1:] |= seen[:-1]; near[:-1] |= seen[1:]; near[:, 1:] |= seen[:, :-1]; near[:, :-1] |= seen[:, 1:]
        seen |= fringe & near
    out = np.dstack([a.astype(np.uint8), np.where(seen, 0, 255).astype(np.uint8)])
    # drop tiny opaque specks that are not connected to the main body (leftover panel noise)
    keep = largest_component(out[..., 3] > 0)
    out[..., 3] = np.where(keep, out[..., 3], 0)
    return Image.fromarray(out, 'RGBA')

def largest_component(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask)
    best = None; best_n = 0
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and not seen[sy, sx]:
                comp = [(sy, sx)]; seen[sy, sx] = True; i = 0
                while i < len(comp):
                    y, x = comp[i]; i += 1
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True; comp.append((ny, nx))
                if len(comp) > best_n: best_n = len(comp); best = comp
    keep = np.zeros_like(mask)
    if best: 
        ys, xs = zip(*best); keep[list(ys), list(xs)] = True
        # keep other components that are at least 12% of the biggest (separate parts of one item, e.g. mop + bucket)
        seen2 = np.zeros_like(mask)
        for sy in range(h):
            for sx in range(w):
                if mask[sy, sx] and not seen2[sy, sx]:
                    comp = [(sy, sx)]; seen2[sy, sx] = True; i = 0
                    while i < len(comp):
                        y, x = comp[i]; i += 1
                        for dy in (-1, 0, 1):
                            for dx in (-1, 0, 1):
                                ny, nx = y + dy, x + dx
                                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen2[ny, nx]:
                                    seen2[ny, nx] = True; comp.append((ny, nx))
                    if len(comp) >= 0.12 * best_n:
                        ys, xs = zip(*comp); keep[list(ys), list(xs)] = True
    return keep

def trim(img):
    bb = img.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    return img.crop(bb) if bb else img

def hue_shift(img, target, sat=1.0):
    """Shift the blue-ish, saturated pixels (the overalls / apron) to `target` hue; skin, hair, shoes stay."""
    rgba = np.asarray(img).copy()
    hsv = np.asarray(Image.fromarray(rgba[..., :3], 'RGB').convert('HSV')).astype(int).copy()
    blue = (hsv[..., 0] >= 128) & (hsv[..., 0] <= 190) & (hsv[..., 1] >= 60)
    hsv[..., 0] = np.where(blue, target, hsv[..., 0])
    if sat != 1.0: hsv[..., 1] = np.where(blue, np.clip(hsv[..., 1] * sat, 0, 255), hsv[..., 1])
    rgb = np.asarray(Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB'))
    rgba[..., :3] = rgb
    return Image.fromarray(rgba, 'RGBA')

def paste(canvas, im, x, y, scale=1.0):
    if scale != 1.0:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas.alpha_composite(im, (int(x), int(y)))
    return im.size

def composites(cut):
    out = {}
    T, S, C, R = cut['furniture/table'], cut['furniture/stool_red'], cut['furniture/counter'], cut['furniture/register']
    # 點餐結帳櫃檯 (2x1): long counter with the cash register on its left end
    c = Image.new('RGBA', (170, 150), (0, 0, 0, 0))
    cw, ch = paste(c, C, 20, 70, 1.35)
    rw, rh = R.size
    paste(c, R, 28, 70 - 8 + 4 - round(rh * 0.78) + 18, 0.78)
    out['comp/reception_set'] = trim(c)
    # 雙人桌 (1x1): small table, a stool on each open front side
    c = Image.new('RGBA', (170, 150), (0, 0, 0, 0))
    paste(c, T, 30, 14, 1.0)
    paste(c, S, 12, 42, 0.78)
    paste(c, S, 52, 48, 0.78)
    out['comp/table2_set'] = trim(c)
    # 四人桌 (2x1): two tables pushed together, a stool on each side
    c = Image.new('RGBA', (260, 170), (0, 0, 0, 0))
    paste(c, S, 20, 10, 0.78); paste(c, S, 100, 20, 0.78)          # back row
    paste(c, T, 34, 18, 1.0); paste(c, T, 66, 34, 1.0)
    paste(c, S, 20, 54, 0.78); paste(c, S, 86, 66, 0.78)           # front row
    out['comp/table4_set'] = trim(c)
    return out

def main():
    sheet = Image.open(SHEET).convert('RGB')
    manifest = {'version': 1, 'sheet': 'assets/ref/restaurant_sheet.png', 'sprites': {}}
    cut = {}
    for group, items in SPRITES.items():
        for name, box in items.items():
            b = (box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2)
            cut[group + '/' + name] = trim(remove_bg(sheet.crop(b)))
    # portrait keeps its cream background
    cut['people/portrait'] = sheet.crop((1405, 494, 1482, 579)).convert('RGBA')
    # storefront hero (opaque) for the DOM banners (modals, support page)
    cut['scene/storefront'] = sheet.crop((0, 0, 492, 428)).convert('RGBA')
    # composites (several cut parts laid out in one sprite, same native scale as the sheet)
    cut.update(composites(cut))
    # staff variants
    for role, hue in STAFF_HUE.items():
        for view, src in STAFF_VIEWS.items():
            im = cut['people/' + src]
            cut['staff/%s_%s' % (role, view)] = trim(im if hue is None else hue_shift(im, hue))
    for key, im in sorted(cut.items()):
        group, name = key.split('/')
        d = os.path.join(OUT, group); os.makedirs(d, exist_ok=True)
        im.save(os.path.join(d, name + '.png'), optimize=True)
        manifest['sprites'][key] = {'file': 'assets/rest/%s/%s.png' % (group, name), 'w': im.width, 'h': im.height}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    print('wrote %d sprites to %s' % (len(cut), OUT))

if __name__ == '__main__':
    main()
