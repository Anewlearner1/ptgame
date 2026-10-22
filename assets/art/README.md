# Art atlas (clinic sprites)

Credits: two user-supplied concept sheets; extracted by `tools/build_atlas.py`.
* Sheet 1 (1312x1199: staff, portrait, role icons, patients, generic actions, equipment, scene, expression tiles) is kept in `source/concept_sheet.png`.
* Sheet 2 (1536x1024: speech-language therapist 語言治療師 character sheet = main pose, 8-direction walk, four therapy interaction scenes,
  expression busts, plus the bottom row 醫療人員 - 表情變化 with normal / tired / happy busts of six roles) is kept in `source/concept_sheet2.png`.

## Files

| file | what |
|---|---|
| `atlas.png` | RGBA atlas, shelf packed, 2px padding (edge colours extruded into the padding at alpha 0), 1024x2048 (113 sprites) |
| `atlas.json` | manifest, see below |
| `preview.png` | contact sheet: every sprite on dark `#2b3a42` (left) and light `#f3f6f4` (right), red cross = anchor |
| `source/concept_sheet.png` | the untouched original of sheet 1 |
| `source/concept_sheet2.png` | the untouched original of sheet 2 (speech-language therapist + staff mood busts) |

Rebuild: `python3 tools/build_atlas.py` (PIL + numpy only). Add `--debug-dir DIR` to also dump each cut sprite as PNG.

## Manifest

```
{ "image": "atlas.png", "w": 1024, "h": 2048,
  "sprites": { "<name>": {"x","y","w","h","ax","ay"} },
  "meta": { "source", "sheets": [{"file","size","note"}, ...], "padding",
            "facing": {"<people sprite>": "right"|"left"|"front"|"ld"|"l"|"lu"|"u"|"ru"|"r"|"rd"}, "heightPx": {"<sprite>": native height} } }
```

`ax, ay` are in sprite-local pixels. People: `ax` = horizontal centre of the lowest pixels (feet), `ay` = bottom of the feet
(= `h-1`, the shadow contact point; the last row is 1px transparent padding). Items: `ax` = `w/2`, `ay` = `h-1`.
Icons, portrait, expression tiles, scene: `ax = w/2`, `ay = h`.
Atlas coordinates (`x`,`y`) change whenever the atlas is repacked; always address sprites by name. Names of earlier sprites never change
(their pixels are identical to the first build).

Sheet-2 sprites:
* `staff.st` = full-body speech therapist (feet anchor). `staff.st.dir.{d,ld,l,lu,u,ru,r,rd}` = 8-direction walk frames in *screen space*
  (`d` = toward the viewer / screen-down, `u` = away, `l`/`r` = screen left/right, two letters = diagonal); `meta.facing` is `front` for `d`,
  otherwise the letter. All 8 frames share one canvas (68x95): `ax` = torso/leg centre column (the same for all, strides do not move it),
  `ay` = bottom row, so frames can be swapped in place.
* `staff.st.act.{speech,swallow,cognitive,counsel}` = the therapist together with the patient / parent (and table, speech bubble, props).
  Anchor = bottom centre of the whole group (`w/2`, `h-1`); no `meta.facing`.
* `face.<role>.<normal|tired|happy>` for roles `st` (speech therapist), `doctor`, `nurse`, `pt`, `ot`, `pharmacist`, `tech`: head+shoulder busts
  (sweat drop, swirl, sparkles, X-ray plate kept). The three moods of one role have the **same canvas size** and are aligned on the head
  (top of hair + head centre), `ax = w/2`, `ay = h`, so swapping moods never shifts the image. `face.st.normal` is cut from the top of
  `staff.st` and resampled (LANCZOS) to the scale of `face.st.tired/happy`.
`meta.facing` is given for staff, portrait, patients and generic sprites (judged by eye; "front" = frontal / three-quarter
view without a clear side). `meta.heightPx` is the native pixel height of every sprite.
The art is smooth-upscaled pixel art (about 2-3 sheet px per art pixel), so draw it with linear filtering or scale it by
arbitrary factors; nearest-neighbour at integer scales also looks fine.

## Naming convention

`staff.<role>`, `staff.st.dir.<d|ld|l|lu|u|ru|r|rd>`, `staff.st.act.<speech|swallow|cognitive|counsel>`, `face.<role>.<normal|tired|happy>`, `portrait.doctor`, `role.<skill>` (icons), `patient.<elder|office|kid|sports>.<pose>`,
`generic.<action>` (blue-vest generic character), `expr.<type>.<0..3>` (face tiles; 0..3 = the four sheet columns, left to right),
`item.<equipment>`, `scene.clinic`.

## Extraction notes

* Background removal: flood fill from the crop border over the panel / tile colours (tolerance 18 for people, 30 for items and icons),
  gradient-following, bounded 2px halo peel, ratio based removal of the soft ground shadow (so the game draws its own),
  optional enclosed-hole removal (between legs, inside rails, wheels), 1px feathered alpha with colour un-mixing against the
  background (no light halo), small/faint leftovers dropped. Detached details (`?`, sweat drops, notes, motion marks) are kept.
* `portrait.doctor` keeps its blue frame (only the outside corners are transparent); `expr.*` are opaque rounded tiles (r=8);
  `scene.clinic` is an opaque rectangle cropped just inside the picture frame.
* Label strips are excluded by the crop windows.
* Sheet 2 specifics: the ground shadow there is a saturated blue, so persons also use `peel_shadow` / `peel_below` (bluish streaks touching
  transparency at the feet) and a floor line under the action tiles is stripped (`strip_floor`). Busts sit on pastel panels whose
  tint is only ~14 px (RGB distance) from the white coats, so each role has its own tight flood tolerance (`FACE_TOL`: doctor 5.5,
  nurse 10, pharmacist 8, ot 12, pt/tech 16, st tiles 18) together with: no seeding from the flat bottom edge, window ended on the last
  bust row, `halo_dark` (peel the light fringe next to the black outline), `speck_open` (opening of thin light remnants) and
  `drop_light` (small near-white blobs touching the background are dropped).
* Known imperfections: `generic.gait` and `patient.sports.run` keep a few light specks where the original has faint cast
  shadow / background between legs; `patient.office.desk` has two tiny light sparkles near the hair; sprite edges keep the
  source's soft grey anti-alias outline.

## Crop table (sheet pixel windows, x0,y0 - x1,y1)

| name | window | kind | facing | size | anchor |
|---|---|---|---|---|---|
| `staff.doctor` | 30,58 - 160,245 | person | front | 101x166 | 45,165 |
| `staff.nurse` | 162,58 - 285,245 | person | front | 91x159 | 47,158 |
| `staff.pt` | 288,58 - 412,245 | person | front | 89x163 | 44,162 |
| `staff.ot` | 414,58 - 543,245 | person | front | 94x157 | 51,156 |
| `staff.pharmacist` | 545,58 - 670,245 | person | front | 97x159 | 46,158 |
| `staff.tech` | 672,58 - 795,245 | person | front | 85x160 | 39,159 |
| `portrait.doctor` | 804,62 - 992,242 | frame | front | 178x170 | 89,170 |
| `role.inquiry` | 1030,56 - 1108,138 | icon | - | 58x61 | 29,61 |
| `role.therapy` | 1120,56 - 1200,138 | icon | - | 54x66 | 27,66 |
| `role.assess` | 1218,56 - 1292,138 | icon | - | 48x61 | 24,61 |
| `role.educate` | 1030,168 - 1108,250 | icon | - | 48x63 | 24,63 |
| `role.equip` | 1120,168 - 1200,250 | icon | - | 82x71 | 41,71 |
| `role.record` | 1218,168 - 1292,250 | icon | - | 57x59 | 28,59 |
| `patient.elder.stand` | 24,402 - 98,546 | person | right | 59x113 | 30,112 |
| `patient.elder.walk` | 98,402 - 165,546 | person | right | 55x101 | 30,100 |
| `patient.elder.cane` | 165,402 - 238,546 | person | right | 58x114 | 26,113 |
| `patient.elder.rehab` | 238,402 - 318,546 | person | right | 62x92 | 36,91 |
| `patient.office.work` | 334,402 - 405,546 | person | right | 58x116 | 28,115 |
| `patient.office.desk` | 405,402 - 502,546 | person | right | 76x109 | 38,108 |
| `patient.office.backpain` | 502,402 - 574,546 | person | right | 58x109 | 28,108 |
| `patient.office.rehab` | 574,402 - 646,546 | person | right | 56x115 | 27,114 |
| `patient.kid.school` | 662,402 - 733,546 | person | right | 60x108 | 30,107 |
| `patient.kid.play` | 733,402 - 817,546 | person | right | 67x82 | 32,81 |
| `patient.kid.rehab` | 817,402 - 882,546 | person | right | 54x93 | 28,92 |
| `patient.kid.withparent` | 882,402 - 966,546 | person | right | 73x121 | 37,120 |
| `patient.sports.run` | 984,402 - 1049,546 | person | right | 57x117 | 22,116 |
| `patient.sports.train` | 1049,402 - 1121,546 | person | right | 67x108 | 45,107 |
| `patient.sports.stretch` | 1121,402 - 1194,546 | person | right | 67x96 | 33,95 |
| `patient.sports.injured` | 1194,402 - 1288,546 | person | front | 81x108 | 39,107 |
| `generic.stand` | 22,656 - 105,760 | person | front | 46x86 | 21,85 |
| `generic.walk_r` | 105,656 - 192,760 | person | right | 47x85 | 23,84 |
| `generic.walk_l` | 192,656 - 290,760 | person | left | 48x85 | 26,84 |
| `generic.run` | 290,656 - 410,760 | person | right | 69x86 | 28,85 |
| `generic.crouch` | 410,656 - 505,760 | person | right | 51x70 | 24,69 |
| `generic.rise` | 505,656 - 600,760 | person | right | 52x87 | 20,86 |
| `generic.sit` | 600,656 - 690,760 | person | right | 61x87 | 23,86 |
| `generic.lie` | 690,656 - 785,760 | person | front | 69x60 | 29,59 |
| `generic.treat` | 785,654 - 925,760 | person | front | 110x99 | 51,98 |
| `generic.stretch` | 22,792 - 130,897 | person | right | 83x82 | 35,81 |
| `generic.joint` | 130,792 - 245,897 | person | front | 82x88 | 41,87 |
| `generic.strength` | 245,792 - 365,897 | person | right | 80x86 | 34,85 |
| `generic.balance` | 365,792 - 450,897 | person | front | 44x90 | 20,89 |
| `generic.gait` | 450,792 - 585,897 | person | front | 89x86 | 45,85 |
| `generic.pain` | 585,792 - 680,897 | person | front | 56x88 | 21,87 |
| `generic.done` | 680,792 - 790,897 | person | front | 62x84 | 30,83 |
| `generic.talk` | 790,792 - 925,897 | person | front | 106x88 | 51,87 |
| `item.bed` | 22,983 - 118,1053 | item | - | 82x56 | 41,55 |
| `item.traction` | 118,983 - 215,1053 | item | - | 63x63 | 32,62 |
| `item.ball` | 215,983 - 305,1053 | item | - | 53x54 | 26,53 |
| `item.parallel` | 305,983 - 410,1053 | item | - | 75x56 | 38,55 |
| `item.step` | 410,983 - 492,1053 | item | - | 63x45 | 32,44 |
| `item.yoga` | 492,983 - 578,1053 | item | - | 70x46 | 35,45 |
| `item.band` | 578,983 - 660,1053 | item | - | 67x52 | 34,51 |
| `item.dumbbell` | 660,983 - 735,1053 | item | - | 60x46 | 30,45 |
| `item.wheelchair` | 22,1074 - 118,1150 | item | - | 67x64 | 34,63 |
| `item.walker` | 118,1074 - 215,1150 | item | - | 62x62 | 31,61 |
| `item.cane` | 215,1074 - 300,1150 | item | - | 35x62 | 18,61 |
| `item.brace` | 300,1074 - 395,1150 | item | - | 43x56 | 22,55 |
| `item.icepack` | 395,1074 - 480,1150 | item | - | 51x44 | 26,43 |
| `item.hotpack` | 480,1074 - 570,1150 | item | - | 55x48 | 28,47 |
| `item.ultrasound` | 570,1074 - 660,1150 | item | - | 45x60 | 22,59 |
| `item.tens` | 660,1074 - 735,1150 | item | - | 47x51 | 24,50 |
| `scene.clinic` | 756,983 - 1157,1177 | scene | - | 401x194 | 200,194 |
| `expr.elder.0` | 1018,653 - 1081,716 | tile | front | 63x63 | 32,63 |
| `expr.elder.1` | 1085,653 - 1148,716 | tile | front | 63x63 | 32,63 |
| `expr.elder.2` | 1152,653 - 1215,716 | tile | front | 63x63 | 32,63 |
| `expr.elder.3` | 1218,653 - 1281,716 | tile | front | 63x63 | 32,63 |
| `expr.office.0` | 1018,721 - 1081,784 | tile | front | 63x63 | 32,63 |
| `expr.office.1` | 1085,721 - 1148,784 | tile | front | 63x63 | 32,63 |
| `expr.office.2` | 1152,721 - 1215,784 | tile | front | 63x63 | 32,63 |
| `expr.office.3` | 1218,721 - 1281,784 | tile | front | 63x63 | 32,63 |
| `expr.kid.0` | 1018,788 - 1081,851 | tile | front | 63x63 | 32,63 |
| `expr.kid.1` | 1085,788 - 1148,851 | tile | front | 63x63 | 32,63 |
| `expr.kid.2` | 1152,788 - 1215,851 | tile | front | 63x63 | 32,63 |
| `expr.kid.3` | 1218,788 - 1281,851 | tile | front | 63x63 | 32,63 |
| `expr.sports.0` | 1018,856 - 1081,919 | tile | front | 63x63 | 32,63 |
| `expr.sports.1` | 1085,856 - 1148,919 | tile | front | 63x63 | 32,63 |
| `expr.sports.2` | 1152,856 - 1215,919 | tile | front | 63x63 | 32,63 |
| `expr.sports.3` | 1218,856 - 1281,919 | tile | front | 63x63 | 32,63 |

## Crop table, sheet 2 (`concept_sheet2.png`, 1536x1024; x0,y0 - x1,y1)

Face windows list the nominal window; the bottom is cut automatically to the last bust row.

| name | window | kind | facing | size | anchor |
|---|---|---|---|---|---|
| `staff.st` | 14,116 - 186,446 | person | front | 155x301 | 73,300 |
| `staff.st.dir.d` | 816,152 - 894,261 | person | front | 68x95 | 33,94 |
| `staff.st.dir.ld` | 896,152 - 972,261 | person | ld | 68x95 | 33,94 |
| `staff.st.dir.l` | 974,152 - 1050,261 | person | l | 68x95 | 33,94 |
| `staff.st.dir.lu` | 1052,152 - 1130,261 | person | lu | 68x95 | 33,94 |
| `staff.st.dir.u` | 816,298 - 894,412 | person | u | 68x95 | 33,94 |
| `staff.st.dir.ru` | 896,298 - 972,412 | person | ru | 68x95 | 33,94 |
| `staff.st.dir.r` | 974,298 - 1050,412 | person | r | 68x95 | 33,94 |
| `staff.st.dir.rd` | 1052,298 - 1130,412 | person | rd | 68x95 | 33,94 |
| `staff.st.act.speech` | 1156,150 - 1332,254 | group | - | 155x98 | 78,97 |
| `staff.st.act.swallow` | 1347,150 - 1519,254 | group | - | 146x101 | 73,100 |
| `staff.st.act.cognitive` | 1156,306 - 1332,410 | group | - | 155x98 | 78,97 |
| `staff.st.act.counsel` | 1347,306 - 1519,410 | group | - | 149x94 | 74,93 |
| `face.st.normal` | sheet2 staff.st window rows 0-205 x0.71 | face | - | 127x161 | 64,161 |
| `face.st.tired` | 503,202 - 630,362 | face | - | 127x161 | 64,161 |
| `face.st.happy` | 649,202 - 776,362 | face | - | 127x161 | 64,161 |
| `face.doctor.normal` | 40,592 - 172,703 | face | - | 107x111 | 54,111 |
| `face.doctor.tired` | 40,703 - 172,811 | face | - | 107x111 | 54,111 |
| `face.doctor.happy` | 40,812 - 172,930 | face | - | 107x111 | 54,111 |
| `face.nurse.normal` | 305,592 - 437,703 | face | - | 109x108 | 54,108 |
| `face.nurse.tired` | 305,703 - 437,811 | face | - | 109x108 | 54,108 |
| `face.nurse.happy` | 305,812 - 437,930 | face | - | 109x108 | 54,108 |
| `face.pt.normal` | 550,592 - 678,703 | face | - | 103x110 | 52,110 |
| `face.pt.tired` | 550,703 - 678,811 | face | - | 103x110 | 52,110 |
| `face.pt.happy` | 550,812 - 678,930 | face | - | 103x110 | 52,110 |
| `face.ot.normal` | 797,592 - 922,703 | face | - | 107x101 | 54,101 |
| `face.ot.tired` | 797,703 - 922,811 | face | - | 107x101 | 54,101 |
| `face.ot.happy` | 797,812 - 922,930 | face | - | 107x101 | 54,101 |
| `face.pharmacist.normal` | 1050,592 - 1172,703 | face | - | 104x104 | 52,104 |
| `face.pharmacist.tired` | 1050,703 - 1172,811 | face | - | 104x104 | 52,104 |
| `face.pharmacist.happy` | 1050,812 - 1172,930 | face | - | 104x104 | 52,104 |
| `face.tech.normal` | 1295,592 - 1432,703 | face | - | 104x101 | 52,101 |
| `face.tech.tired` | 1295,703 - 1432,811 | face | - | 104x101 | 52,101 |
| `face.tech.happy` | 1295,812 - 1432,930 | face | - | 104x101 | 52,101 |

Sheet-2 caveats: the sheet's row-2 walking frames (`上`, `右上`, `右`, `右下`) are drawn almost the same as row 1 (front / three-quarter, the
head is never seen from behind), so `staff.st.dir.u` and the `u*` diagonals are not true back views; `staff.st.dir.ld` has a hollow
back foot (open outline in the source). `staff.st.dir.*` are tiny (~95 px) compared to `staff.st` (301 px); scale them in the renderer.
