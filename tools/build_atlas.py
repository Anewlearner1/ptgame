#!/usr/bin/env python3
"""Build assets/art/atlas.png + atlas.json + preview.png from the user-supplied
concept sheet (assets/art/source/concept_sheet.png).

Re-runnable:  python3 tools/build_atlas.py [--debug-dir DIR]

Pipeline per crop-table entry
  1. cut the (generous) window out of the sheet
  2. estimate the background colours from the window's border ring (panel
     colour, plus tile colour for sprites that sit on a tile)
  3. flood fill from the ring over those colours (with tolerance and a
     gradient-following rule) -> background mask; enclosed "holes" are removed
     too when the entry asks for it
  4. feather: foreground pixels within 2px of the mask get alpha from their
     colour distance to the background and are un-mixed from it (no halo)
  5. drop faint / tiny leftover components (ground shadow remnants, noise) but
     keep real detached details ('?', sweat drops, notes ...)
  6. trim to bbox + 1px padding, compute the anchor, shelf-pack into the atlas

Only PIL + numpy are used.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'art', 'source', 'concept_sheet.png')
SRC2 = os.path.join(ROOT, 'assets', 'art', 'source', 'concept_sheet2.png')   # speech-language therapist sheet
OUT = os.path.join(ROOT, 'assets', 'art')

# --------------------------------------------------------------------------
# crop table
#   name: (x0, y0, x1, y1, kind, facing, opts)
#   kind  person  - anchor = feet (centre x of lowest pixels, bottom)
#         item    - anchor = bottom-centre
#         icon    - cut out, anchor = (w/2, h)
#         frame   - keep the framed image, only the outside corners go
#         tile    - opaque rounded square (no background removal)
#         scene   - opaque rectangle
#   opts: tol (flood tolerance), holes (remove enclosed bg), keep (min comp area)
# --------------------------------------------------------------------------
P, I, IC, FR, TL, SC = 'person', 'item', 'icon', 'frame', 'tile', 'scene'

CROPS = {
    # --- staff (panel 醫療人員) ------------------------------------------
    'staff.doctor':     (30, 58, 160, 245, P, 'front', {}),
    'staff.nurse':      (162, 58, 285, 245, P, 'front', {}),
    'staff.pt':         (288, 58, 412, 245, P, 'front', {}),
    'staff.ot':         (414, 58, 543, 245, P, 'front', {}),
    'staff.pharmacist': (545, 58, 670, 245, P, 'front', {}),
    'staff.tech':       (672, 58, 795, 245, P, 'front', {}),
    'portrait.doctor':  (804, 62, 992, 242, FR, 'front', {}),
    # --- role icons --------------------------------------------------------
    'role.inquiry':     (1030, 56, 1108, 138, IC, None, {'holes': True}),
    'role.therapy':     (1120, 56, 1200, 138, IC, None, {}),
    'role.assess':      (1218, 56, 1292, 138, IC, None, {'holes': True, 'shadow': False}),
    'role.educate':     (1030, 168, 1108, 250, IC, None, {}),
    'role.equip':       (1120, 168, 1200, 250, IC, None, {}),
    'role.record':      (1218, 168, 1292, 250, IC, None, {}),
    # --- patients ---------------------------------------------------------
    'patient.elder.stand':  (24, 402, 98, 546, P, 'right', {'hole_tol': 30.0, 'hole_band': 34, 'hole_min': 6}),
    'patient.elder.walk':   (98, 402, 165, 546, P, 'right', {'hole_tol': 30.0, 'hole_band': 34, 'hole_min': 6}),
    'patient.elder.cane':   (165, 402, 238, 546, P, 'right', {'hole_tol': 30.0, 'hole_band': 34, 'hole_min': 6}),
    'patient.elder.rehab':  (238, 402, 318, 546, P, 'right', {'holes': False}),
    'patient.office.work':  (334, 402, 405, 546, P, 'right', {'hole_tol': 30.0, 'hole_band': 34, 'hole_min': 6}),
    'patient.office.desk':  (405, 402, 502, 546, P, 'right', {'holes': False, 'keep': 60}),
    'patient.office.backpain': (502, 402, 574, 546, P, 'right', {'holes': False}),
    'patient.office.rehab': (574, 402, 646, 546, P, 'right', {'holes': False}),
    'patient.kid.school':   (662, 402, 733, 546, P, 'right', {'shadow_spread': 0.3}),
    'patient.kid.play':     (733, 402, 817, 546, P, 'right', {'shadow_spread': 0.3, 'holes': False}),
    'patient.kid.rehab':    (817, 402, 882, 546, P, 'right', {'shadow_spread': 0.3}),
    'patient.kid.withparent': (882, 402, 966, 546, P, 'right', {'shadow_spread': 0.3, 'holes': True, 'hole_tol': 24.0, 'hole_band': 34}),
    'patient.sports.run':   (984, 402, 1049, 546, P, 'right', {'shadow_spread': 0.3, 'hole_tol': 18.0}),
    'patient.sports.train': (1049, 402, 1121, 546, P, 'right', {'shadow_spread': 0.3}),
    'patient.sports.stretch': (1121, 402, 1194, 546, P, 'right', {'shadow_spread': 0.3}),
    'patient.sports.injured': (1194, 402, 1288, 546, P, 'front', {'shadow_spread': 0.3, 'holes': False}),
    # --- generic actions (row 1) ----------------------------------------------
    'generic.stand':    (22, 656, 105, 760, P, 'front', {}),
    'generic.walk_r':   (105, 656, 192, 760, P, 'right', {}),
    'generic.walk_l':   (192, 656, 290, 760, P, 'left', {}),
    'generic.run':      (290, 656, 410, 760, P, 'right', {}),
    'generic.crouch':   (410, 656, 505, 760, P, 'right', {'holes': False}),
    'generic.rise':     (505, 656, 600, 760, P, 'right', {}),
    'generic.sit':      (600, 656, 690, 760, P, 'right', {'holes': False}),
    'generic.lie':      (690, 656, 785, 760, P, 'front', {'holes': False}),
    'generic.treat':    (785, 654, 925, 760, P, 'front', {'holes': False}),
    # --- generic actions (row 2) ----------------------------------------------
    'generic.stretch':  (22, 792, 130, 897, P, 'right', {'holes': False}),
    'generic.joint':    (130, 792, 245, 897, P, 'front', {'holes': False}),
    'generic.strength': (245, 792, 365, 897, P, 'right', {'holes': False}),
    'generic.balance':  (365, 792, 450, 897, P, 'front', {}),
    'generic.gait':     (450, 792, 585, 897, P, 'front', {'holes': True}),
    'generic.pain':     (585, 792, 680, 897, P, 'front', {}),
    'generic.done':     (680, 792, 790, 897, P, 'front', {}),
    'generic.talk':     (790, 792, 925, 897, P, 'front', {}),
    # --- equipment ---------------------------------------------------------
    'item.bed':         (22, 983, 118, 1053, I, None, {}),
    'item.traction':    (118, 983, 215, 1053, I, None, {'holes': True}),
    'item.ball':        (215, 983, 305, 1053, I, None, {}),
    'item.parallel':    (305, 983, 410, 1053, I, None, {'holes': True}),
    'item.step':        (410, 983, 492, 1053, I, None, {}),
    'item.yoga':        (492, 983, 578, 1053, I, None, {}),
    'item.band':        (578, 983, 660, 1053, I, None, {'holes': True}),
    'item.dumbbell':    (660, 983, 735, 1053, I, None, {'holes': True}),
    'item.wheelchair':  (22, 1074, 118, 1150, I, None, {'holes': True}),
    'item.walker':      (118, 1074, 215, 1150, I, None, {'holes': True}),
    'item.cane':        (215, 1074, 300, 1150, I, None, {}),
    'item.brace':       (300, 1074, 395, 1150, I, None, {'holes': True}),
    'item.icepack':     (395, 1074, 480, 1150, I, None, {}),
    'item.hotpack':     (480, 1074, 570, 1150, I, None, {}),
    'item.ultrasound':  (570, 1074, 660, 1150, I, None, {}),
    'item.tens':        (660, 1074, 735, 1150, I, None, {}),
    # --- scene (opaque rectangle inside the frame) ------------------------------
    'scene.clinic':     (756, 983, 1157, 1177, SC, None, {}),
}

# expression tiles: 4 rows (elder, office, kid, sports) x 4 columns, opaque rounded
EXPR_X = [1018, 1085, 1152, 1218]
EXPR_Y = [653, 721, 788, 856]
EXPR_S = 63
for _r, _t in enumerate(['elder', 'office', 'kid', 'sports']):
    for _c in range(4):
        CROPS['expr.%s.%d' % (_t, _c)] = (EXPR_X[_c], EXPR_Y[_r], EXPR_X[_c] + EXPR_S, EXPR_Y[_r] + EXPR_S, TL, 'front', {})

# --------------------------------------------------------------------------
# second concept sheet (concept_sheet2.png, 1536x1024): speech-language
# therapist + staff mood busts.  Windows are in SHEET 2 pixels ('sheet': 2).
#   kind  group - person-style cut-out, anchor = bottom-centre of the whole group
#         face  - bust cut-out, anchor = (w/2, h); the three moods of one role
#                 are padded to a common canvas afterwards (equalise_faces)
# --------------------------------------------------------------------------
G, F = 'group', 'face'
S2 = {'sheet': 2}


def _o(**k):
    d = dict(S2, shadow_spread=0.3, peel_shadow=6)   # sheet 2 ground shadow is a saturated blue
    d.update(k)
    return d


CROPS2 = {
    'staff.st': (14, 116, 186, 446, P, 'front', _o()),
}
# walking, 8 directions (screen space): d = toward viewer, u = away
_WALK_X = [(816, 894), (896, 972), (974, 1050), (1052, 1130)]
_WALK = [('d', 0, 0), ('ld', 1, 0), ('l', 2, 0), ('lu', 3, 0),
         ('u', 0, 1), ('ru', 1, 1), ('r', 2, 1), ('rd', 3, 1)]
_WALK_Y = [(152, 261), (298, 412)]
for _d, _c, _r in _WALK:
    CROPS2['staff.st.dir.' + _d] = (_WALK_X[_c][0], _WALK_Y[_r][0], _WALK_X[_c][1], _WALK_Y[_r][1],
                                    P, 'front' if _d == 'd' else _d,
                                    _o(peel_shadow=0, peel_below=True, peel_db=25, peel_lum=215,
                                       fill_shoes=(_d == 'ld')))   # white shoe interior == background colour
# therapy interaction tiles (group with a patient, table and props kept)
CROPS2.update({
    'staff.st.act.speech':    (1156, 150, 1332, 254, G, None, _o(shadow=False, holes=False, strip_floor=True)),
    'staff.st.act.swallow':   (1347, 150, 1519, 254, G, None, _o(shadow=False, holes=False, strip_floor=True)),
    'staff.st.act.cognitive': (1156, 306, 1332, 410, G, None, _o(shadow=False, holes=False, strip_floor=True)),
    'staff.st.act.counsel':   (1347, 306, 1519, 410, G, None, _o(shadow=False, holes=False, strip_floor=True)),
})
# expression busts of the speech therapist (tile interiors)
CROPS2['face.st.tired'] = (503, 202, 630, 362, F, None, _o(tol=18.0, halo_dark=0))   # blue tile
CROPS2['face.st.happy'] = (649, 202, 776, 362, F, None, _o(tol=18.0, halo_dark=0))
# staff mood busts: role -> (x0, x1) window; rows normal / tired / happy
FACE_ROWS = [(592, 703), (703, 811), (812, 930)]
FACE_ROLES = [('doctor', 40, 172), ('nurse', 305, 437), ('pt', 550, 678),
              ('ot', 797, 922), ('pharmacist', 1050, 1172), ('tech', 1295, 1432)]
MOODS = ['normal', 'tired', 'happy']
# flood tolerance per panel: how far the (white) clothes are from the pastel tint
FACE_TOL = {'doctor': 5.5, 'nurse': 10.0, 'pt': 16.0, 'ot': 12.0, 'pharmacist': 8.0, 'tech': 16.0}
for _role, _x0, _x1 in FACE_ROLES:
    for _m, (_y0, _y1) in zip(MOODS, FACE_ROWS):
        CROPS2['face.%s.%s' % (_role, _m)] = (_x0, _y0, _x1, _y1, F, None, _o(tol=FACE_TOL[_role]))
# face.st.normal = bust taken from the top of staff.st (window coords of staff.st
# cut; scaled so the head matches the expression busts)
ST_NORMAL = {'y1': 205, 'scale': 0.71}

CROPS.update(CROPS2)
ORDER = list(CROPS.keys())
ORDER.insert(ORDER.index('face.st.tired'), 'face.st.normal')   # derived, see st_normal()

PAD = 2           # atlas padding between sprites
TOL = 30.0        # default flood tolerance (RGB euclid)
PERSON_TOL = 18.0


# --------------------------------------------------------------------------
def bg_refs(win):
    """Background reference colours from the window's 2px border ring."""
    h, w, _ = win.shape
    ring = np.zeros((h, w), bool)
    ring[:2, :] = ring[-2:, :] = ring[:, :2] = ring[:, -2:] = True
    px = win[ring]
    q = (px // 10).astype(int)
    keys = q[:, 0] * 10000 + q[:, 1] * 100 + q[:, 2]
    uniq, inv, cnt = np.unique(keys, return_inverse=True, return_counts=True)
    order = np.argsort(-cnt)
    refs = []
    total = len(px)
    for i in order:
        if cnt[i] < 0.04 * total:
            break
        c = px[inv == i].mean(0)
        if all(np.linalg.norm(c - r) > 12 for r in refs):
            refs.append(c)
    if not refs:
        refs.append(np.median(px, 0))
    return np.array(refs)


def dmin_map(win, refs):
    d = np.sqrt(((win[:, :, None, :] - refs[None, None, :, :]) ** 2).sum(3))
    return d.min(2), d.argmin(2)


def flood(win, dmin, tol, seed_bottom=True):
    """Background mask: connected to the ring, within tol of a ref colour, or
    (gradient rule) very close to an accepted neighbour and within 1.6*tol."""
    h, w = dmin.shape
    bg = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if y == h - 1 and not seed_bottom:
                continue
            if dmin[y, x] < tol and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if dmin[y, x] < tol and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                dm = dmin[ny, nx]
                ok = dm < tol
                if not ok and dm < tol * 1.6:
                    ok = np.abs(win[ny, nx] - win[y, x]).max() < 5
                if ok:
                    bg[ny, nx] = True
                    dq.append((ny, nx))
    return bg


def grow(bg, cand):
    """Extend bg into cand pixels that are 4-connected to bg."""
    h, w = bg.shape
    bg = bg.copy()
    dq = deque()
    ys, xs = np.where(bg)
    for y, x in zip(ys, xs):
        dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and cand[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))
    return bg


def shadow_candidates(win, refs, which, spread_max=0.13):
    """Soft ground shadow = the background colour, darkened: every channel
    0.6..0.99 of the nearest background reference and about the same hue."""
    ratio = win / np.maximum(refs[which], 1.0)
    spread = ratio.max(2) - ratio.min(2)
    return (ratio.min(2) > 0.6) & (ratio.max(2) < 0.995) & (spread < spread_max)


def components(mask, conn8=True):
    h, w = mask.shape
    lab = np.zeros((h, w), int)
    n = 0
    nb = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if conn8:
        nb += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not lab[y, x]:
                n += 1
                lab[y, x] = n
                dq = deque([(y, x)])
                while dq:
                    cy, cx = dq.popleft()
                    for dy, dx in nb:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            dq.append((ny, nx))
    return lab, n


def dilate(m, r=1):
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        o[1:, :] |= out[:-1, :]
        o[:-1, :] |= out[1:, :]
        o[:, 1:] |= out[:, :-1]
        o[:, :-1] |= out[:, 1:]
        out = o
    return out


def cut_out(win, opts, kind):
    """win: HxWx3 float. returns HxWx4 uint8 (transparent background)."""
    tol = opts.get('tol', TOL)
    refs = bg_refs(win)
    dmin, which = dmin_map(win, refs)
    bg = flood(win, dmin, tol, not opts.get('noseed_bottom'))
    # peel the light anti-alias halo: up to `halo` px of light, background-ish
    # pixels next to the background (a bounded growth, so enclosed light areas
    # such as a white cap or shoe are not eaten)
    lum = 0.3 * win[:, :, 0] + 0.59 * win[:, :, 1] + 0.11 * win[:, :, 2]
    hcand = (dmin < opts.get('halo_tol', 120.0)) & (lum > opts.get('halo_lum', 115.0))
    for _ in range(opts.get('halo', 2)):
        bg = bg | (dilate(bg, 1) & hcand)
    if opts.get('halo_dark'):
        # light fringe between the black outline and the background: peel light
        # near-background pixels touching the background and sitting within 2px
        # of a dark outline pixel (white coats without outline are left alone)
        dk = lum < 90
        near_dark = dilate(dk, 2)
        h2 = (dmin < opts.get('halo_tol2', 60.0)) & (lum > 150) & near_dark
        for _ in range(opts['halo_dark']):
            bg = bg | (dilate(bg, 1) & h2)
    if opts.get('speck_open'):
        # thin (< 2r+1 px) light remnants of the pastel panel near the background
        # (a very tight tolerance keeps white coats, but leaves panel noise): drop
        # them with a morphological opening; thick white areas survive
        r = opts['speck_open']
        L = (~bg) & (dmin < opts.get('speck_tol', 55.0)) & (lum > 170)
        core = ~dilate(~L, r)
        keepL = dilate(core, r) & L
        bg = bg | (L & ~keepL & dilate(bg, 3))
    if opts.get('shadow'):
        cand = shadow_candidates(win, refs, which, opts.get('shadow_spread', 0.13))
        band = opts.get('band', 26)
        ys = np.where((~bg).any(1))[0]
        yb = ys.max()
        rows = np.zeros(bg.shape, bool)
        rows[max(0, yb - band):, :] = True
        bg = grow(bg, cand & rows)
        # second, looser pass for the faint rim of the shadow
        cand2 = shadow_candidates(win, refs, which, max(opts.get('shadow_spread', 0.13), 0.2))
        cand2 &= (dmin > 0) & (win.min(2) > 120)
        bg = grow(bg, cand2 & rows)
    fg = ~bg
    if opts.get('holes'):
        # enclosed background (between legs, inside rails, wheels...), only in
        # the lowest `hole_band` rows of the sprite when that is given
        ys = np.where(fg.any(1))[0]
        rows = np.zeros(bg.shape, bool)
        rows[max(0, ys.max() - opts.get('hole_band', 999)):, :] = True
        cand = (~bg) & (dmin < opts.get('hole_tol', 10.0))
        if opts.get('shadow'):
            sc = shadow_candidates(win, refs, which, 0.10)
            cand |= (~bg) & sc
        cand &= rows
        lab, n = components(cand, conn8=False)
        for i in range(1, n + 1):
            m = lab == i
            if m.sum() >= opts.get('hole_min', 10):
                bg |= m
    fg = ~bg
    # feather + un-mix on the 1px rim next to the background
    rim = fg & dilate(bg, 1)
    lo, hi = tol * 0.8, tol * 2.2
    alpha = np.where(fg, 1.0, 0.0)
    a_rim = np.clip((dmin - lo) / (hi - lo), 0, 1)
    alpha[rim] = a_rim[rim]
    # rim pixels that would be nearly transparent are dropped
    alpha[alpha < 0.12] = 0
    ref_px = refs[which]
    a = np.maximum(alpha, 1e-3)[:, :, None]
    col = win.copy()
    unmix = rim[:, :, None] & (alpha[:, :, None] < 1)
    col = np.where(unmix, (win - (1 - a) * ref_px) / a, win)
    col = np.clip(col, 0, 255)
    # drop faint / tiny components (shadow remnants, noise)
    keep_min = opts.get('keep', 8)
    lab, n = components(alpha > 0)
    if n:
        sizes = np.bincount(lab.ravel(), minlength=n + 1)
        big = sizes[1:].max()
        for i in range(1, n + 1):
            m = lab == i
            area = sizes[i]
            faint = dmin[m].max() < tol * 2.0
            if (area < keep_min or faint) and area < big:
                alpha[m] = 0
    if opts.get('drop_light'):
        # detached, almost white / grey blobs = panel remnants (sweat drops, sparkles,
        # swirls are all clearly coloured)
        lab, n = components(alpha > 0)
        if n:
            sizes = np.bincount(lab.ravel(), minlength=n + 1)
            big = sizes[1:].max()
            sat = col.max(2) - col.min(2)
            lum3 = 0.3 * col[:, :, 0] + 0.59 * col[:, :, 1] + 0.11 * col[:, :, 2]
            for i in range(1, n + 1):
                m = lab == i
                if sizes[i] < big and sizes[i] < 200 and ((lum3[m] > 190) & (sat[m] < 45)).mean() > 0.9:
                    alpha[m] = 0
    if opts.get('drop_light'):
        # small light blobs that touch the (removed) background: panel remnants glued
        # to an outline.  Big white areas (coats, masks) are far larger than this.
        sat = col.max(2) - col.min(2)
        lum3 = 0.3 * col[:, :, 0] + 0.59 * col[:, :, 1] + 0.11 * col[:, :, 2]
        Lm = (alpha > 0) & (lum3 > 185) & (sat < 50)
        lab, n = components(Lm, conn8=False)
        near = dilate(alpha == 0, 1)
        if n:
            sizes = np.bincount(lab.ravel(), minlength=n + 1)
            for i in range(1, n + 1):
                m = lab == i
                if sizes[i] < opts.get('drop_light_area', 90) and (m & near).any():
                    alpha[m] = 0
    n_peel = opts.get('peel_shadow', 0)
    if n_peel:
        # blue ground-shadow streaks hugging the feet: peel bluish mid-tone pixels
        # that touch transparency, bottom band only (outlines stop the peel)
        r_, g_, b_ = col[:, :, 0], col[:, :, 1], col[:, :, 2]
        lum2 = 0.3 * r_ + 0.59 * g_ + 0.11 * b_
        blu = (b_ > r_ + opts.get('peel_db', 22)) & (lum2 > 95) & (lum2 < opts.get('peel_lum', 232))
        rows_ = np.where((alpha > 0.5).any(1))[0]
        band_ = np.zeros(alpha.shape, bool)
        band_[max(0, rows_.max() - opts.get('peel_band', 26)):, :] = True
        blu &= band_
        for _ in range(n_peel):
            solid = alpha > 0.5
            edge = dilate(~solid, 1) & solid
            kill = edge & blu
            if not kill.any():
                break
            alpha[kill] = 0
    if opts.get('fill_shoes'):
        # white shoe interiors that are the same colour as the panel: refill
        # transparent pixels that have outline on all 4 sides within 6px
        # (bottom 12 rows only)
        solid = alpha > 0.5
        h_, w_ = solid.shape
        rows_ = np.where(solid.any(1))[0]
        y0_ = rows_.max() - 12
        def seen(dy, dx):
            acc = np.zeros_like(solid)
            for k in range(1, 7):
                sh = np.zeros_like(solid)
                ys0, ys1 = max(0, dy * k), h_ + min(0, dy * k)
                xs0, xs1 = max(0, dx * k), w_ + min(0, dx * k)
                sh[ys0:ys1, xs0:xs1] = solid[ys0 - dy * k:ys1 - dy * k, xs0 - dx * k:xs1 - dx * k]
                acc |= sh
            return acc
        fillm = (~solid) & seen(1, 0) & seen(-1, 0) & seen(0, 1) & seen(0, -1)
        fillm[:y0_] = False
        col[fillm] = (246, 246, 252)
        alpha[fillm] = 1.0
    if opts.get('strip_floor'):
        # thin floor line sticking out at the very bottom: drop pixels in the last
        # 3 rows whose column has nothing opaque 2..6px above
        solid = alpha > 0.5
        rows_ = np.where(solid.any(1))[0]
        yb = rows_.max()
        for y in range(max(0, yb - 2), yb + 1):
            for x in range(alpha.shape[1]):
                if alpha[y, x] > 0 and not solid[max(0, y - 6):max(0, y - 1), x].any():
                    alpha[y, x] = 0
    if opts.get('peel_below'):
        # shadow streaks below / beside the soles: bluish pixels under the lowest
        # dark outline pixel of their column (bottom band only)
        r_, g_, b_ = col[:, :, 0], col[:, :, 1], col[:, :, 2]
        lum2 = 0.3 * r_ + 0.59 * g_ + 0.11 * b_
        blu = (b_ > r_ + opts.get('peel_db', 22)) & (lum2 < opts.get('peel_lum', 232))
        dark = (lum2 < 70) & (alpha > 0.5)
        rows_ = np.where((alpha > 0.5).any(1))[0]
        y0_ = max(0, rows_.max() - opts.get('peel_band', 26))
        for x in range(alpha.shape[1]):
            ys_ = np.where(dark[y0_:, x])[0]
            start = (y0_ + ys_.max() + 1) if len(ys_) else y0_
            kill = blu[start:, x] & (alpha[start:, x] > 0)
            alpha[start:, x][kill] = 0
    rgba = np.dstack([col, alpha * 255]).round().astype(np.uint8)
    return rgba


def rounded_mask(w, h, r):
    ss = 4
    m = Image.new('L', (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * ss - 1, h * ss - 1], radius=r * ss, fill=255)
    return np.asarray(m.resize((w, h), Image.LANCZOS))


def trim(rgba, pad=1):
    a = rgba[:, :, 3]
    ys, xs = np.where(a > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = rgba[y0:y1, x0:x1]
    return np.pad(c, ((pad, pad), (pad, pad), (0, 0)))


def anchor(rgba, kind):
    h, w = rgba.shape[:2]
    if kind == 'person':
        a = rgba[:, :, 3]
        rows = np.where((a > 128).any(1))[0]
        bot = rows[-1]
        band = a[max(0, bot - 5):bot + 1] > 128
        xs = np.where(band.any(0))[0]
        # centre of the lowest pixels (feet)
        cols = np.where(band)[1]
        return int(round(cols.mean())), h - 1
    if kind in ('item', 'group'):
        return int(round(w / 2)), h - 1
    return int(round(w / 2)), h


def process(sheet, name, spec, sheet2=None):
    x0, y0, x1, y1, kind, facing, opts = spec
    if opts.get('sheet') == 2:
        sheet = sheet2
    win = sheet[y0:y1, x0:x1].astype(float)
    if kind == 'scene':
        rgba = np.dstack([win, np.full(win.shape[:2], 255)]).astype(np.uint8)
        return rgba, kind, facing
    if kind == 'tile':
        h, w = win.shape[:2]
        m = rounded_mask(w, h, 8)
        rgba = np.dstack([win, m]).astype(np.uint8)
        return rgba, kind, facing
    if kind == 'frame':
        o = dict(opts)
        o.setdefault('tol', 14.0)
        rgba = cut_out(win, o, kind)
        return trim(rgba), kind, facing
    o = dict(opts)
    if kind == 'face':
        # the busts are cut flat at the bottom with a light gap line below: end the
        # window on the last row that still holds the bust, so no background touches
        # (and feathers) the cut edge
        refs = bg_refs(win)
        dm = dmin_map(win, refs)[0]
        sig = (dm > 35).sum(1)
        last = np.where(sig >= 10)[0].max()
        win = win[:last + 1]
    if kind == 'person':
        o.setdefault('tol', PERSON_TOL)
        o.setdefault('shadow', True)       # remove the soft ground shadow
        o.setdefault('holes', True)        # ... also where enclosed between legs/cane
        o.setdefault('hole_band', 12)
        o.setdefault('hole_tol', 12.0)
    if kind in ('group', 'face'):
        o.setdefault('tol', PERSON_TOL if kind == 'group' else 5.5)
        o.setdefault('shadow', kind == 'group')
        o.setdefault('holes', False)
        if kind == 'face':
            o.setdefault('tol', 5.5)    # pure-white coats are only ~14 away from the pastel panel
            o.setdefault('halo', 0)
            o.setdefault('halo_dark', 3)
            o.setdefault('speck_open', 2)
            o.setdefault('drop_light', True)
            o.setdefault('noseed_bottom', True)   # busts are cut flat at the bottom; white coat == panel
    if kind in ('item', 'icon'):
        o.setdefault('shadow', True)
        o.setdefault('band', 999)
        o.setdefault('hole_band', 999)
        o.setdefault('hole_tol', 14.0)
    rgba = cut_out(win, o, kind)
    if opts.get('notrim'):
        return rgba, kind, facing
    return trim(rgba), kind, facing


def st_normal(sheet2):
    """face.st.normal: head+shoulders taken from the top of the staff.st pose,
    resampled (LANCZOS, premultiplied alpha) to the scale of the expression busts."""
    spec = CROPS['staff.st']
    o = dict(spec[6])
    o['notrim'] = True
    rgba, _, _ = process(None, 'staff.st', spec[:6] + (o,), sheet2)
    rgba = rgba[:ST_NORMAL['y1']]
    im = Image.fromarray(rgba, 'RGBA')
    f = ST_NORMAL['scale']
    im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
    a = np.asarray(im).copy()
    a[a[:, :, 3] < 20] = 0
    return trim(a)


def head_ref(rgba):
    """(x, y) of the head reference in a bust: x = mean column of the largest
    component's top 30 % rows, y = its top row."""
    lab, n = components(rgba[:, :, 3] > 0)
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    sizes[0] = 0
    m = lab == sizes.argmax()
    ys, xs = np.where(m)
    top, bot = ys.min(), ys.max()
    sel = ys <= top + 0.3 * (bot - top)
    return int(round(xs[sel].mean())), int(top)


def body_centre_x(rgba):
    """Stable horizontal anchor of a walking frame: mean column of the opaque
    pixels in the lower 55 % of the sprite (torso + legs; the ponytail and the
    swinging feet of a stride do not move it much)."""
    a = rgba[:, :, 3] > 128
    ys = np.where(a.any(1))[0]
    y0 = ys.min() + int(0.45 * (ys.max() - ys.min()))
    return int(round(np.where(a[y0:])[1].mean()))


def equalise_walk(parts, names):
    """Pad the 8 walking frames to one canvas: same body-centre column (ax) and
    same bottom row (ay = h-1), so the renderer can swap frames in place."""
    cx = {n: body_centre_x(parts[n]) for n in names}
    L = max(cx.values())
    R = max(parts[n].shape[1] - cx[n] for n in names)
    H = max(parts[n].shape[0] for n in names)
    for n in names:
        p = parts[n]
        out = np.zeros((H, L + R, 4), np.uint8)
        out[H - p.shape[0]:, L - cx[n]:L - cx[n] + p.shape[1]] = p
        parts[n] = out
    return L, H - 1


def equalise_faces(parts, names):
    """Pad the busts of one role to one common canvas, aligned on the head
    (top of the hair + head centre), so swapping moods never shifts the image."""
    refs = {n: head_ref(parts[n]) for n in names}
    L = max(refs[n][0] for n in names)
    R = max(parts[n].shape[1] - refs[n][0] for n in names)
    U = max(refs[n][1] for n in names)
    D = max(parts[n].shape[0] - refs[n][1] for n in names)
    for n in names:
        p = parts[n]
        hx, ty = refs[n]
        out = np.zeros((U + D, L + R, 4), np.uint8)
        ox, oy = L - hx, U - ty
        out[oy:oy + p.shape[0], ox:ox + p.shape[1]] = p
        parts[n] = out


# --------------------------------------------------------------------------
def shelf_pack(items, pad=PAD):
    """items: list of (name, w, h). Returns (W, H, {name:(x,y)}) with the
    smallest power-of-two-ish atlas <= 2048 that fits."""
    cands = []
    for W in (512, 1024, 2048):
        for H in (512, 1024, 2048):
            cands.append((W * H, W, H))
    cands.sort(key=lambda t: (t[0], abs(t[1] - t[2])))
    order = sorted(items, key=lambda t: (-t[2], -t[1]))
    for _, W, H in cands:
        x = y = pad
        shelf = 0
        pos = {}
        ok = True
        for n, w, h in order:
            if w + 2 * pad > W:
                ok = False
                break
            if x + w + pad > W:
                x = pad
                y += shelf + pad
                shelf = 0
            if y + h + pad > H:
                ok = False
                break
            pos[n] = (x, y)
            x += w + pad
            shelf = max(shelf, h)
        if ok:
            return W, H, pos
    raise SystemExit('does not fit into 2048x2048')


def extrude(rgba):
    """Copy edge RGB into fully transparent pixels next to opaque ones so
    bilinear filtering does not pull in black."""
    a = rgba[:, :, 3] > 0
    out = rgba.copy()
    d = dilate(a, 1) & ~a
    ys, xs = np.where(d)
    h, w = a.shape
    for y, x in zip(ys, xs):
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and a[ny, nx]:
                out[y, x, :3] = rgba[ny, nx, :3]
                break
    return out


def font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_preview(sprites, atlas, path, zoom=1, width=1700):
    """Contact sheet: every sprite on dark #2b3a42 (left) and light #f3f6f4
    (right), labelled, anchor marked with a red cross."""
    f = font(10)
    cells = []
    x, y, rowh = 6, 6, 0
    prev_group = None
    for n, s in sprites.items():
        parts = n.split('.')
        group = '.'.join(parts[:2]) if parts[0] in ('patient', 'expr', 'face') else parts[0]
        if n.startswith('staff.st'):
            group = 'staff.st.' + (parts[2] if len(parts) > 2 else '')
        w, h = s['w'] * zoom, s['h'] * zoom
        cw = max(2 * w + 4, 96) + 6
        ch = h + 18
        if x + cw > width or (prev_group is not None and group != prev_group):
            x = 6
            y += rowh + 8
            rowh = 0
        prev_group = group
        cells.append((n, x, y, cw))
        x += cw
        rowh = max(rowh, ch)
    H = y + rowh + 8
    img = Image.new('RGB', (width, H), (110, 110, 110))
    dr = ImageDraw.Draw(img)
    for n, x, y, cw in cells:
        s = sprites[n]
        spr = atlas.crop((s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h']))
        if zoom != 1:
            spr = spr.resize((spr.width * zoom, spr.height * zoom), Image.NEAREST)
        w, h = spr.size
        for k, bgc in enumerate(((0x2b, 0x3a, 0x42), (0xf3, 0xf6, 0xf4))):
            ox = x + k * (w + 4)
            oy = y + 14
            dr.rectangle([ox, oy, ox + w - 1, oy + h - 1], fill=bgc)
            img.paste(spr, (ox, oy), spr)
            ax = ox + s['ax'] * zoom
            ay = oy + min(s['ay'], s['h'] - 1) * zoom
            dr.line([ax - 3, ay, ax + 3, ay], fill=(255, 0, 80))
            dr.line([ax, ay - 3, ax, ay + 3], fill=(255, 0, 80))
        dr.text((x, y), n, fill=(255, 255, 255), font=f)
    img.save(path)


def main():
    debug = None
    if '--debug-dir' in sys.argv:
        debug = sys.argv[sys.argv.index('--debug-dir') + 1]
        os.makedirs(debug, exist_ok=True)
    sheet = np.asarray(Image.open(SRC).convert('RGB'))
    sheet2 = np.asarray(Image.open(SRC2).convert('RGB'))
    parts = {}
    meta_facing = {}
    kinds = {}
    for name in ORDER:
        if name not in CROPS:
            continue
        rgba, kind, facing = process(sheet, name, CROPS[name], sheet2)
        parts[name] = rgba
        kinds[name] = kind
        if kind == 'person':
            meta_facing[name] = facing
        elif name.startswith('portrait'):
            meta_facing[name] = facing
        if debug:
            Image.fromarray(rgba).save(os.path.join(debug, name + '.png'))
    # speech therapist bust (normal) + per-role mood busts on a common canvas
    parts['face.st.normal'] = st_normal(sheet2)
    kinds['face.st.normal'] = F
    walk_names = [n for n in ORDER if n.startswith('staff.st.dir.')]
    walk_anchor = equalise_walk(parts, walk_names)
    for role in ['st'] + [r[0] for r in FACE_ROLES]:
        equalise_faces(parts, ['face.%s.%s' % (role, m) for m in MOODS])
    for n in list(parts):
        if n.startswith('face.') and debug:
            Image.fromarray(parts[n]).save(os.path.join(debug, n + '.png'))
    W, H, pos = shelf_pack([(n, p.shape[1], p.shape[0]) for n, p in parts.items()])
    atlas = np.zeros((H, W, 4), np.uint8)
    sprites = {}
    heights = {}
    for n in ORDER:
        p = parts[n]
        h, w = p.shape[:2]
        x, y = pos[n]
        atlas[y:y + h, x:x + w] = p
        ax, ay = anchor(p, kinds[n])
        if n in walk_names:
            ax, ay = walk_anchor
        sprites[n] = {'x': x, 'y': y, 'w': w, 'h': h, 'ax': ax, 'ay': ay}
        heights[n] = h
    # extrude edge colours into the transparent padding (filter safety)
    atlas = extrude(atlas)
    im = Image.fromarray(atlas, 'RGBA')
    im.save(os.path.join(OUT, 'atlas.png'), optimize=True)
    manifest = {
        'image': 'atlas.png', 'w': W, 'h': H,
        'sprites': sprites,
        'meta': {
            'source': 'user-supplied concept sheets; extracted by tools/build_atlas.py',
            'sheets': [
                {'file': 'source/concept_sheet.png', 'size': [1312, 1199],
                 'note': 'sheet 1: staff, portrait, role icons, patients, generic actions, items, scene, expression tiles'},
                {'file': 'source/concept_sheet2.png', 'size': [1536, 1024],
                 'note': 'sheet 2: speech-language therapist (staff.st, 8-direction walk, therapy actions) + staff mood busts (face.*)'},
            ],
            'padding': PAD,
            'facing': meta_facing,
            'heightPx': heights,
        },
    }
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    make_preview(sprites, im, os.path.join(OUT, 'preview.png'))
    print('atlas %dx%d, %d sprites' % (W, H, len(sprites)))


if __name__ == '__main__':
    main()
