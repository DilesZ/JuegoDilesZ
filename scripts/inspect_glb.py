#!/usr/bin/env python3
"""Inspector de archivos GLB: lista animaciones, skins, huesos y materiales."""
import json, struct, sys, os

def inspect(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, length = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        print(f"{os.path.basename(path)}: no es GLB")
        return
    clen, ctype = struct.unpack('<II', data[12:20])
    j = json.loads(data[20:20+clen].decode('utf-8'))
    name = os.path.basename(path)
    print(f"\n=== {name} ({os.path.getsize(path)/1e6:.2f} MB) ===")
    nodes = j.get('nodes', [])
    print(f"nodes: {len(nodes)}, meshes: {len(j.get('meshes', []))}, skins: {len(j.get('skins', []))}, materials: {len(j.get('materials', []))}, images: {len(j.get('images', []))}")
    anims = j.get('animations', [])
    print(f"animations ({len(anims)}):")
    for a in anims:
        dur = 0
        for s in a.get('samplers', []):
            inp = s.get('input')
            if inp is not None:
                acc = j['accessors'][inp]
                mx = acc.get('max', [0])[0]
                if mx: dur = max(dur, mx)
        print(f"  - '{a.get('name')}'  {dur:.2f}s  channels={len(a.get('channels', []))}")
    for si, s in enumerate(j.get('skins', [])):
        joints = s.get('joints', [])
        joint_names = [nodes[k].get('name', f'node{k}') for k in joints[:12]]
        print(f"skin[{si}]: {len(joints)} huesos. primeros: {joint_names}")
    scene = j['scenes'][j.get('scene', 0)]
    print("roots:", [nodes[k].get('name', k) for k in scene.get('nodes', [])])
    mats = [m.get('name', '?') for m in j.get('materials', [])]
    print("materials:", mats[:20])

for p in sys.argv[1:]:
    try:
        inspect(p)
    except Exception as e:
        print(f"{p}: ERROR {e}")
